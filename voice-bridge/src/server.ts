import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Groq Whisper STT ─────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), 'audio.webm');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'en');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Groq error: ${res.status} ${res.statusText} - ${errBody}`);
  }

  const data = await res.json() as { text?: string };
  return data.text || '';
}

// ── OpenAI TTS ────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

function cleanTextForTTS(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '... code block omitted ...')
    .replace(/[*_#`]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 4000);
}

async function generateSpeechOpenAI(text: string): Promise<Buffer | null> {
  if (!OPENAI_API_KEY) return null;

  const ttsText = cleanTextForTTS(text);
  if (!ttsText) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        voice: 'echo',
        input: '...... ' + ttsText,
        response_format: 'mp3',
        speed: 1.12,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[${timestamp()}] OpenAI TTS error: ${res.status} ${res.statusText} - ${errBody}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`[${timestamp()}] OpenAI TTS: ${ttsText.length} chars → ${Math.round(buffer.length / 1024)}KB MP3`);
    return buffer;
  } catch (err: any) {
    console.error(`[${timestamp()}] OpenAI TTS error:`, err.message);
    return null;
  }
}

/** Fallback: Groq TTS (free, uses PlayAI voices) */
async function generateSpeechGroq(text: string): Promise<Buffer | null> {
  if (!GROQ_API_KEY) return null;

  const ttsText = cleanTextForTTS(text);
  if (!ttsText) return null;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'canopylabs/orpheus-v1-english',
        voice: 'daniel',
        input: ttsText,
        response_format: 'wav',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[${timestamp()}] Groq TTS error: ${res.status} ${res.statusText} - ${errBody}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`[${timestamp()}] Groq TTS: ${ttsText.length} chars → ${Math.round(buffer.length / 1024)}KB MP3`);
    return buffer;
  } catch (err: any) {
    console.error(`[${timestamp()}] Groq TTS error:`, err.message);
    return null;
  }
}

/** Try OpenAI first, fall back to Groq (free) */
async function generateSpeech(text: string): Promise<Buffer | null> {
  const openaiResult = await generateSpeechOpenAI(text);
  if (openaiResult) return openaiResult;

  console.log(`[${timestamp()}] OpenAI TTS unavailable, falling back to Groq`);
  return generateSpeechGroq(text);
}

// ── Types ──────────────────────────────────────────────────────────

interface BridgeState {
  activeWorkspace: string | null;
  activeRepo: string | null;
  activeTerminal: string;
  lastCommand: string | null;
  currentTaskStatus: 'idle' | 'running' | 'complete' | 'error';
  lastOutputSummary: string | null;
}

type ClientRole = 'phone' | 'extension';

interface IdentifyMessage { type: 'identify'; client: ClientRole; }
interface CommandMessage { type: 'command'; text: string; images?: Array<{ data: string; mimeType: string; name?: string }>; }
interface StatusMessage { type: 'status'; text: string; }
interface ToolStatusMessage { type: 'tool_status'; text: string; }
interface ResultMessage { type: 'result'; text: string; }
interface SpeakMessage { type: 'speak'; text: string; }
interface WorkspaceMessage { type: 'workspace'; data: { workspace: string; repo: string }; }

type BridgeMessage =
  | IdentifyMessage
  | CommandMessage
  | StatusMessage
  | ToolStatusMessage
  | ResultMessage
  | SpeakMessage
  | WorkspaceMessage;

// ── State ──────────────────────────────────────────────────────────

const state: BridgeState = {
  activeWorkspace: null,
  activeRepo: null,
  activeTerminal: 'VOICE AGENT',
  lastCommand: null,
  currentTaskStatus: 'idle',
  lastOutputSummary: null,
};

// ── Client tracking ────────────────────────────────────────────────

const clients: Map<WebSocket, ClientRole> = new Map();

function getClient(role: ClientRole): WebSocket | undefined {
  let latest: WebSocket | undefined;
  for (const [ws, r] of clients) {
    if (r === role && ws.readyState === WebSocket.OPEN) latest = ws;
  }
  return latest;
}

/** Broadcast to ALL clients with a given role (e.g. multiple phone/browser sessions) */
function broadcastToRole(role: ClientRole, data: unknown): void {
  const json = JSON.stringify(data);
  for (const [ws, r] of clients) {
    if (r === role && ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

function sendJSON(ws: WebSocket, data: unknown): void {
  ws.send(JSON.stringify(data));
}

function timestamp(): string {
  return new Date().toISOString();
}

// ── Express ────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, clients: clients.size });
});

app.get('/state', (_req, res) => {
  res.json(state);
});

// ── Whisper transcription endpoint ──────────────────────────────────
app.post('/transcribe', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '10mb' }), async (req, res) => {
  try {
    const audioBuffer = req.body as Buffer;
    const mimeType = req.headers['content-type'] || 'audio/webm';
    console.log(`[${timestamp()}] Transcribing ${Math.round(audioBuffer.length / 1024)}KB audio (${mimeType})`);
    const text = await transcribeAudio(audioBuffer, mimeType);
    console.log(`[${timestamp()}] Transcription: "${text}"`);
    res.json({ text });
  } catch (err: any) {
    console.error(`[${timestamp()}] Transcription error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Serve web app (built files from ../web-app/dist) ────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppDist = path.join(__dirname, '..', '..', 'web-app', 'dist');
app.use(express.static(webAppDist));
// SPA fallback — serve index.html for any non-API route
app.use((req, res, next) => {
  if (req.path.startsWith('/health') || req.path.startsWith('/state') || req.path.startsWith('/transcribe')) return next();
  res.sendFile(path.join(webAppDist, 'index.html'));
});

// ── HTTP + WebSocket server ────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4800', 10);
const server = createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 10 * 1024 * 1024 });

// Ping/pong to keep connections alive on Render (they timeout idle connections)
const PING_INTERVAL = 30_000;
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, PING_INTERVAL);

wss.on('close', () => clearInterval(pingInterval));

wss.on('connection', (ws) => {
  console.log(`[${timestamp()}] New WebSocket connection (unidentified)`);

  ws.on('message', (raw) => {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.error(`[${timestamp()}] Invalid JSON received`);
      return;
    }

    // ── Identify ───────────────────────────────────────────────
    if (msg.type === 'identify') {
      const role = msg.client;
      // Close stale extension connections (only one extension allowed)
      // But allow multiple phone/browser sessions for cross-device sync
      if (role === 'extension') {
        for (const [existingWs, existingRole] of clients) {
          if (existingRole === 'extension' && existingWs !== ws) {
            console.log(`[${timestamp()}] Closing stale extension connection`);
            clients.delete(existingWs);
            existingWs.close();
          }
        }
      }
      clients.set(ws, role);
      console.log(`[${timestamp()}] Client identified as: ${role} (total: ${clients.size})`);
      // Send workspace info to phone on connect
      if (role === 'phone' && state.activeWorkspace) {
        sendJSON(ws, { type: 'workspace', workspace: state.activeWorkspace, repo: state.activeRepo });
      }
      return;
    }

    const role = clients.get(ws);
    if (!role) {
      console.warn(`[${timestamp()}] Message from unidentified client, ignoring`);
      return;
    }

    console.log(`[${timestamp()}] [${role}] -> ${msg.type}: ${JSON.stringify(msg).slice(0, 200)}`);

    // ── Phone sends a command ──────────────────────────────────
    if (role === 'phone' && msg.type === 'command') {
      state.lastCommand = msg.text;
      state.currentTaskStatus = 'running';

      const ext = getClient('extension');
      if (ext) {
        const payload: Record<string, unknown> = { type: 'command', text: msg.text };
        if (msg.images && msg.images.length > 0) {
          payload.images = msg.images;
          console.log(`[${timestamp()}] Forwarding ${msg.images.length} image(s) to extension`);
        }
        sendJSON(ext, payload);
        sendJSON(ws, { type: 'status', text: 'Command sent...' });
      } else {
        sendJSON(ws, { type: 'status', text: 'Extension not connected — is VS Code open?' });
        state.currentTaskStatus = 'error';
      }
      return;
    }

    // ── Phone sends stop ───────────────────────────────────────
    if (role === 'phone' && msg.type === 'stop') {
      const ext = getClient('extension');
      if (ext) {
        sendJSON(ext, { type: 'stop' });
        console.log(`[${timestamp()}] Stop command forwarded to extension`);
      }
      state.currentTaskStatus = 'idle';
      return;
    }

    // ── Extension sends status ─────────────────────────────────
    if (role === 'extension' && msg.type === 'status') {
      broadcastToRole('phone', { type: 'status', text: msg.text });
      return;
    }

    // ── Extension sends tool status (separate step on phone) ──
    if (role === 'extension' && msg.type === 'tool_status') {
      broadcastToRole('phone', { type: 'tool_status', text: msg.text });
      return;
    }

    // ── Extension sends speak (intermediate TTS) ─────────────
    if (role === 'extension' && msg.type === 'speak') {
      generateSpeech(msg.text).then((audioBuffer) => {
        if (audioBuffer) {
          const base64 = audioBuffer.toString('base64');
          broadcastToRole('phone', { type: 'audio', data: base64, final: false });
          console.log(`[${timestamp()}] Sent intermediate TTS (${Math.round(audioBuffer.length / 1024)}KB)`);
        }
      });
      return;
    }

    // ── Extension sends result ─────────────────────────────────
    if (role === 'extension' && msg.type === 'result') {
      state.currentTaskStatus = 'complete';
      state.lastOutputSummary = msg.text;

      broadcastToRole('phone', { type: 'result', text: msg.text });

      // Generate TTS audio and send to all phone clients
      generateSpeech(msg.text).then((audioBuffer) => {
        if (audioBuffer) {
          const base64 = audioBuffer.toString('base64');
          broadcastToRole('phone', { type: 'audio', data: base64, final: true });
          console.log(`[${timestamp()}] Sent final TTS audio (${Math.round(audioBuffer.length / 1024)}KB)`);
        }
      });
      return;
    }

    // ── Extension sends workspace info ─────────────────────────
    if (role === 'extension' && msg.type === 'workspace') {
      state.activeWorkspace = msg.data.workspace;
      state.activeRepo = msg.data.repo;
      console.log(`[${timestamp()}] Workspace updated: ${msg.data.workspace} (${msg.data.repo})`);
      broadcastToRole('phone', { type: 'workspace', workspace: msg.data.workspace, repo: msg.data.repo });
      return;
    }

    console.warn(`[${timestamp()}] Unhandled message type: ${msg.type} from ${role}`);
  });

  ws.on('close', () => {
    const role = clients.get(ws) ?? 'unidentified';
    clients.delete(ws);
    console.log(`[${timestamp()}] Client disconnected: ${role}`);
  });

  ws.on('error', (err) => {
    console.error(`[${timestamp()}] WebSocket error:`, err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${timestamp()}] Voice Bridge listening on port ${PORT}`);
});
