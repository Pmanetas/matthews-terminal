import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

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
      if (phone) sendJSON(phone, { type: 'result', text: msg.text });
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
