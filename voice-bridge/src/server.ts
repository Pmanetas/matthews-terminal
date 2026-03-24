import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// ── ElevenLabs TTS ────────────────────────────────────────────────
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // default: Adam

async function generateSpeech(text: string): Promise<Buffer | null> {
  if (!ELEVENLABS_API_KEY) {
    console.log(`[${new Date().toISOString()}] ElevenLabs: No API key, skipping TTS`);
    return null;
  }

  // Trim text for TTS — don't read code blocks aloud
  const ttsText = text
    .replace(/```[\s\S]*?```/g, '... code block omitted ...')
    .slice(0, 2000); // ElevenLabs has char limits

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: ttsText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[${new Date().toISOString()}] ElevenLabs error: ${res.status} ${res.statusText} - ${errBody}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ElevenLabs error:`, err);
    return null;
  }
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
interface CommandMessage { type: 'command'; text: string; }
interface StatusMessage { type: 'status'; text: string; }
interface ResultMessage { type: 'result'; text: string; }
interface WorkspaceMessage { type: 'workspace'; data: { workspace: string; repo: string }; }

type BridgeMessage =
  | IdentifyMessage
  | CommandMessage
  | StatusMessage
  | ResultMessage
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
  for (const [ws, r] of clients) {
    if (r === role && ws.readyState === WebSocket.OPEN) return ws;
  }
  return undefined;
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

// ── Serve web app (built files from ../web-app/dist) ────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppDist = path.join(__dirname, '..', '..', 'web-app', 'dist');
app.use(express.static(webAppDist));
// SPA fallback — serve index.html for any non-API route
app.use((req, res, next) => {
  if (req.path.startsWith('/health') || req.path.startsWith('/state')) return next();
  res.sendFile(path.join(webAppDist, 'index.html'));
});

// ── HTTP + WebSocket server ────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4800', 10);
const server = createServer(app);
const wss = new WebSocketServer({ server });

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
      clients.set(ws, role);
      console.log(`[${timestamp()}] Client identified as: ${role}`);
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
        sendJSON(ext, { type: 'command', text: msg.text });
        sendJSON(ws, { type: 'status', text: 'Command sent...' });
      } else {
        sendJSON(ws, { type: 'status', text: 'Extension not connected — is VS Code open?' });
        state.currentTaskStatus = 'error';
      }
      return;
    }

    // ── Extension sends status ─────────────────────────────────
    if (role === 'extension' && msg.type === 'status') {
      const phone = getClient('phone');
      if (phone) sendJSON(phone, { type: 'status', text: msg.text });
      return;
    }

    // ── Extension sends result ─────────────────────────────────
    if (role === 'extension' && msg.type === 'result') {
      state.currentTaskStatus = 'complete';
      state.lastOutputSummary = msg.text;

      const phone = getClient('phone');
      if (phone) {
        sendJSON(phone, { type: 'result', text: msg.text });

        // Generate TTS audio and send to phone
        generateSpeech(msg.text).then((audioBuffer) => {
          if (audioBuffer && phone.readyState === WebSocket.OPEN) {
            const base64 = audioBuffer.toString('base64');
            sendJSON(phone, { type: 'audio', data: base64 });
            console.log(`[${timestamp()}] Sent TTS audio (${Math.round(audioBuffer.length / 1024)}KB)`);
          }
        });
      }
      return;
    }

    // ── Extension sends workspace info ─────────────────────────
    if (role === 'extension' && msg.type === 'workspace') {
      state.activeWorkspace = msg.data.workspace;
      state.activeRepo = msg.data.repo;
      console.log(`[${timestamp()}] Workspace updated: ${msg.data.workspace} (${msg.data.repo})`);
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
