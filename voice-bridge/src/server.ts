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

/** Wrap raw PCM (24kHz 16-bit mono) in a WAV container, with optional silence prepended */
function pcmToWav(pcm: Buffer, sampleRate: number, silenceMs = 0): Buffer {
  const silenceSamples = Math.floor(sampleRate * silenceMs / 1000);
  const silenceBytes = silenceSamples * 2; // 16-bit
  const dataSize = silenceBytes + pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);       // chunk size
  header.writeUInt16LE(1, 20);        // PCM
  header.writeUInt16LE(1, 22);        // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);        // block align
  header.writeUInt16LE(16, 34);       // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  const silence = Buffer.alloc(silenceBytes, 0);
  return Buffer.concat([header, silence, pcm]);
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
        model: 'tts-1',
        voice: 'onyx',
        input: ttsText,
        response_format: 'pcm',  // raw 24kHz 16-bit mono
        speed: 1.12,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[${timestamp()}] OpenAI TTS error: ${res.status} ${res.statusText} - ${errBody}`);
      return null;
    }

    const pcmBuffer = Buffer.from(await res.arrayBuffer());
    // Prepend 600ms of silence so iOS audio hardware wakes up before speech starts
    const wavBuffer = pcmToWav(pcmBuffer, 24000, 600);
    console.log(`[${timestamp()}] OpenAI TTS: ${ttsText.length} chars → ${Math.round(wavBuffer.length / 1024)}KB WAV (with 600ms silence)`);
    return wavBuffer;
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
  activeFile: string | null;
  activeTerminal: string;
  lastCommand: string | null;
  currentTaskStatus: 'idle' | 'running' | 'complete' | 'error';
  lastOutputSummary: string | null;
}

type ClientRole = 'phone' | 'extension' | 'daemon';

interface IdentifyMessage { type: 'identify'; client: ClientRole; }
interface CommandMessage { type: 'command'; text: string; images?: Array<{ data: string; mimeType: string; name?: string }>; }
interface StatusMessage { type: 'status'; text: string; }
interface ToolStatusMessage { type: 'tool_status'; text: string; }
interface ResultMessage { type: 'result'; text: string; }
interface SpeakMessage { type: 'speak'; text: string; }
interface WorkspaceMessage { type: 'workspace'; data: { workspace: string; repo: string }; }
interface ActiveFileMessage { type: 'active_file'; file: string | null; }
interface StopMessage { type: 'stop'; }
interface NewSessionMessage { type: 'new_session'; }
interface NarrationMessage { type: 'narration'; text: string; }
interface DaemonLogMessage { type: 'daemon_log'; text: string; }

type BridgeMessage =
  | IdentifyMessage
  | CommandMessage
  | StatusMessage
  | ToolStatusMessage
  | ResultMessage
  | SpeakMessage
  | WorkspaceMessage
  | DaemonLogMessage
  | ActiveFileMessage
  | StopMessage
  | NewSessionMessage
  | NarrationMessage;

// ── State ──────────────────────────────────────────────────────────

const state: BridgeState = {
  activeWorkspace: null,
  activeRepo: null,
  activeFile: null,
  activeTerminal: 'VOICE AGENT',
  lastCommand: null,
  currentTaskStatus: 'idle',
  lastOutputSummary: null,
};

// ── Session message history (replayed to phone on reconnect) ──────
// Stores tool_status, result, and user command messages so reconnecting
// clients see the full terminal session.
interface HistoryEntry { type: string; [key: string]: unknown; }
const messageHistory: HistoryEntry[] = [];
const MAX_HISTORY = 200;

function pushHistory(msg: HistoryEntry): void {
  messageHistory.push(msg);
  if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
}

function replayHistory(ws: WebSocket): void {
  // Send a replay_start marker so the client knows these are historical
  sendJSON(ws, { type: 'replay_start' });
  for (const msg of messageHistory) {
    sendJSON(ws, msg);
  }
  sendJSON(ws, { type: 'replay_end' });
  console.log(`[${timestamp()}] Replayed ${messageHistory.length} messages to reconnecting client`);
}

// ── Daemon log history (replayed to phone terminal viewer) ─────────
const daemonLogHistory: string[] = [];
const MAX_DAEMON_LOGS = 500;

function pushDaemonLog(text: string): void {
  daemonLogHistory.push(text);
  if (daemonLogHistory.length > MAX_DAEMON_LOGS) daemonLogHistory.shift();
}

function replayDaemonLogs(ws: WebSocket): void {
  for (const text of daemonLogHistory) {
    sendJSON(ws, { type: 'daemon_log', text });
  }
}

// ── Client tracking ────────────────────────────────────────────────

const clients: Map<WebSocket, ClientRole> = new Map();

function getClient(role: ClientRole): WebSocket | undefined {
  let latest: WebSocket | undefined;
  for (const [ws, r] of clients) {
    if (r === role && ws.readyState === WebSocket.OPEN) latest = ws;
  }
  // When looking for 'extension', also check for 'daemon' (daemon replaces extension)
  if (!latest && role === 'extension') {
    for (const [ws, r] of clients) {
      if (r === 'daemon' && ws.readyState === WebSocket.OPEN) latest = ws;
    }
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
      // Close stale connections for same role (only one extension/daemon allowed)
      // But allow multiple phone/browser sessions for cross-device sync
      if (role === 'extension' || role === 'daemon') {
        for (const [existingWs, existingRole] of clients) {
          if (existingRole === role && existingWs !== ws) {
            console.log(`[${timestamp()}] Closing stale ${role} connection`);
            clients.delete(existingWs);
            existingWs.close();
          }
        }
        // Don't clear history on reconnect — may just be recovering from a blip
        // History is cleared only when extension/daemon sends explicit 'new_session' message
      }
      clients.set(ws, role);
      console.log(`[${timestamp()}] Client identified as: ${role} (total: ${clients.size})`);

      // Tell phones when daemon/extension connects
      if (role === 'extension' || role === 'daemon') {
        broadcastToRole('phone', { type: 'extension_status', connected: true });
      }

      // Send workspace info, active file, daemon status, and message history to phone on connect
      if (role === 'phone') {
        const extConnected = !!getClient('extension'); // getClient('extension') also checks for 'daemon'
        sendJSON(ws, { type: 'extension_status', connected: extConnected });
        if (state.activeWorkspace) {
          sendJSON(ws, { type: 'workspace', workspace: state.activeWorkspace, repo: state.activeRepo });
        }
        if (state.activeFile) {
          sendJSON(ws, { type: 'active_file', file: state.activeFile });
        }
        replayHistory(ws);
        replayDaemonLogs(ws);
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
      // Store user message in history (without image data to save memory)
      pushHistory({ type: 'user_command', text: msg.text });

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

    // ── Phone requests new chat ─────────────────────────────────
    if (role === 'phone' && msg.type === 'new_chat') {
      console.log(`[${timestamp()}] New chat requested by phone`);
      // Clear bridge history
      messageHistory.length = 0;
      daemonLogHistory.length = 0;
      // Tell all phones to clear
      broadcastToRole('phone', { type: 'clear_history' });
      // Forward to daemon as a command so it restarts the Claude agent
      const ext = getClient('extension');
      if (ext) {
        sendJSON(ext, { type: 'command', text: 'new chat' });
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

    const isExtOrDaemon = role === 'extension' || role === 'daemon';

    // ── Extension/daemon signals new session (clear old history) ──
    if (isExtOrDaemon && msg.type === 'new_session') {
      messageHistory.length = 0;
      broadcastToRole('phone', { type: 'clear_history' });
      console.log(`[${timestamp()}] New session — cleared message history`);
      return;
    }

    // ── Extension/daemon sends status ──────────────────────────
    if (isExtOrDaemon && msg.type === 'status') {
      broadcastToRole('phone', { type: 'status', text: msg.text });
      return;
    }

    // ── Extension/daemon sends tool status (separate step on phone) ──
    if (isExtOrDaemon && msg.type === 'tool_status') {
      const entry = { type: 'tool_status', text: msg.text };
      pushHistory(entry);
      broadcastToRole('phone', entry);

      // Auto-detect workspace changes from tool_status file paths
      // e.g. "Reading bets-and-regrets/CLAUDE.md" or "Editing some-repo/src/file.ts"
      const text = msg.text || '';
      const fileMatch = text.match(/^(?:Reading|Editing|Creating)\s+(.+)/);
      if (fileMatch) {
        const filePath = fileMatch[1].trim();
        // Extract the top-level directory from the path
        const firstSegment = filePath.split(/[/\\]/)[0];
        if (firstSegment && state.activeRepo) {
          const currentRepoName = path.basename(state.activeRepo);
          // If the file's top-level dir doesn't match current repo, it's a workspace switch
          if (firstSegment !== currentRepoName && !firstSegment.includes('.') && firstSegment.length > 1) {
            // Build the new repo path by replacing the last segment of the current repo path
            const parentDir = path.dirname(state.activeRepo);
            const newRepo = path.join(parentDir, firstSegment);
            state.activeWorkspace = firstSegment;
            state.activeRepo = newRepo;
            console.log(`[${timestamp()}] Workspace auto-detected from tool_status: ${firstSegment}`);
            broadcastToRole('phone', { type: 'workspace', workspace: firstSegment, repo: newRepo });
          }
        }
      }
      return;
    }

    // ── Extension/daemon sends narration (display only, TTS comes via separate 'speak') ──
    if (isExtOrDaemon && msg.type === 'narration') {
      console.log(`[${timestamp()}] NARRATION: "${(msg.text || '').slice(0, 100)}"`);
      const narrationEntry = { type: 'narration', text: msg.text };
      pushHistory(narrationEntry);
      broadcastToRole('phone', narrationEntry);
      return;
    }

    // ── Extension/daemon sends speak (TTS only, no display) ───
    if (isExtOrDaemon && msg.type === 'speak') {
      const phoneCount = [...clients].filter(([w, r]) => r === 'phone' && w.readyState === WebSocket.OPEN).length;
      console.log(`[${timestamp()}] SPEAK received (${phoneCount} phone(s) online): "${(msg.text || '').slice(0, 100)}"`);
      generateSpeech(msg.text).then((audioBuffer) => {
        if (audioBuffer) {
          const phoneCountNow = [...clients].filter(([w, r]) => r === 'phone' && w.readyState === WebSocket.OPEN).length;
          const base64 = audioBuffer.toString('base64');
          broadcastToRole('phone', { type: 'audio', data: base64, final: false });
          console.log(`[${timestamp()}] Sent TTS audio (${Math.round(audioBuffer.length / 1024)}KB) to ${phoneCountNow} phone(s)`);
        } else {
          console.error(`[${timestamp()}] SPEAK TTS returned null!`);
        }
      }).catch((err: any) => {
        console.error(`[${timestamp()}] SPEAK TTS error:`, err.message);
      });
      return;
    }

    // ── Extension/daemon sends result ──────────────────────────
    if (isExtOrDaemon && msg.type === 'result') {
      state.currentTaskStatus = 'complete';
      state.lastOutputSummary = msg.text;

      // Send result text IMMEDIATELY so phone shows it right away
      const resultEntry = { type: 'result', text: msg.text };
      pushHistory(resultEntry);
      broadcastToRole('phone', resultEntry);

      // Generate TTS in background — audio arrives after text
      generateSpeech(msg.text).then((audioBuffer) => {
        if (audioBuffer) {
          const base64 = audioBuffer.toString('base64');
          broadcastToRole('phone', { type: 'audio', data: base64, final: true });
          console.log(`[${timestamp()}] Sent TTS audio (${Math.round(audioBuffer.length / 1024)}KB)`);
        }
      }).catch(() => {});
      return;
    }

    // ── Extension/daemon sends log lines for phone terminal viewer ─
    if (isExtOrDaemon && msg.type === 'daemon_log') {
      pushDaemonLog(msg.text);
      broadcastToRole('phone', { type: 'daemon_log', text: msg.text });
      return;
    }

    // ── Extension/daemon sends workspace info ─────────────────
    if (isExtOrDaemon && msg.type === 'workspace') {
      state.activeWorkspace = msg.data.workspace;
      state.activeRepo = msg.data.repo;
      console.log(`[${timestamp()}] Workspace updated: ${msg.data.workspace} (${msg.data.repo})`);
      broadcastToRole('phone', { type: 'workspace', workspace: msg.data.workspace, repo: msg.data.repo });
      return;
    }

    // ── Extension/daemon sends active file ────────────────────
    if (isExtOrDaemon && msg.type === 'active_file') {
      state.activeFile = msg.file || null;
      console.log(`[${timestamp()}] Active file: ${state.activeFile}`);
      broadcastToRole('phone', { type: 'active_file', file: state.activeFile });
      return;
    }

    console.warn(`[${timestamp()}] Unhandled message type: ${msg.type} from ${role}`);
  });

  ws.on('close', () => {
    const role = clients.get(ws) ?? 'unidentified';
    clients.delete(ws);
    console.log(`[${timestamp()}] Client disconnected: ${role}`);
    // Tell phones when daemon/extension disconnects
    if (role === 'extension' || role === 'daemon') {
      broadcastToRole('phone', { type: 'extension_status', connected: false });
    }
  });

  ws.on('error', (err) => {
    console.error(`[${timestamp()}] WebSocket error:`, err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${timestamp()}] Voice Bridge listening on port ${PORT}`);
});
