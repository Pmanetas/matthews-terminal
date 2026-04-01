/**
 * BridgeConnection — WebSocket client connecting daemon to the voice bridge.
 *
 * Identifies as 'daemon' role, routes incoming commands to AgentManager,
 * and provides an AgentSink factory that tags every outbound message with agentId.
 */

import WebSocket from 'ws';
import { AgentManager } from './agent-manager';
import { AgentSink, BridgeCommand, DaemonMessage } from './types';

const RECONNECT_INTERVAL = 5000;

export class BridgeConnection {
    private ws: WebSocket | undefined;
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private shouldReconnect = false;
    private bridgeUrl: string;
    public manager: AgentManager;
    // Dual-agent mode: Claude is the primary, Codex is the reviewer
    private claudeAgentId: string | null = null;
    private codexAgentId: string | null = null;
    private defaultProjectDir: string;

    constructor(bridgeUrl: string, defaultProjectDir: string) {
        this.bridgeUrl = bridgeUrl;
        this.defaultProjectDir = defaultProjectDir;
        this.manager = new AgentManager((agentId) => this.createSink(agentId));
    }

    /** Forward a log line to the bridge for phone terminal viewer */
    sendLog(text: string): void {
        this.send({ type: 'daemon_log', text });
    }

    connect(): void {
        if (this.ws) this.disconnect();
        this.shouldReconnect = true;
        this.doConnect();
    }

    private doConnect(): void {
        try {
            console.log(`[Daemon] Connecting to bridge: ${this.bridgeUrl}`);
            this.ws = new WebSocket(this.bridgeUrl);

            this.ws.on('open', () => {
                // MUST identify first — console.log sends daemon_log messages,
                // and bridge ignores messages from unidentified clients
                this.send({ type: 'identify', client: 'daemon' });

                // Send workspace info like the VS Code extension does
                const path = require('path');
                const workspace = path.basename(this.defaultProjectDir);
                this.send({ type: 'workspace', data: { workspace, repo: this.defaultProjectDir } });

                // Clear old chat history from previous session
                this.send({ type: 'new_session' });

                // Now safe to log (client is identified, daemon_log will be forwarded)
                console.log('\x1b[32m[Daemon] Connected to bridge\x1b[0m');

                // Auto-spawn both Claude and Codex agents
                if (!this.claudeAgentId) {
                    const info = this.manager.spawnAgent(this.defaultProjectDir, 'claude', 'claude');
                    this.claudeAgentId = info.agentId;
                    console.log(`\x1b[36m[Daemon] Claude agent ready: ${info.agentId} in ${this.defaultProjectDir}\x1b[0m`);
                }
                if (!this.codexAgentId) {
                    const info = this.manager.spawnAgent(this.defaultProjectDir, 'codex', 'codex');
                    this.codexAgentId = info.agentId;
                    console.log(`\x1b[36m[Daemon] Codex agent ready: ${info.agentId} in ${this.defaultProjectDir}\x1b[0m`);
                }
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });

            this.ws.on('close', () => {
                this.ws = undefined;
                console.log('[Daemon] Disconnected from bridge');
                this.scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                // Suppress noisy connection-refused during reconnect
                if (err.message?.includes('ECONNREFUSED')) {
                    // Expected when bridge isn't running
                } else {
                    console.error('[Daemon] WebSocket error:', err.message);
                }
            });
        } catch {
            this.scheduleReconnect();
        }
    }

    disconnect(): void {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = undefined;
        }
    }

    private send(payload: Record<string, unknown>): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    private handleMessage(raw: string): void {
        let msg: any;
        try {
            msg = JSON.parse(raw);
        } catch {
            console.error('[Daemon] Failed to parse bridge message:', raw);
            return;
        }

        switch (msg.type) {
            // ── Existing bridge format (single-agent compat) ──
            case 'command': {
                const text = (msg.text || '').trim();
                // Check for "new chat" / "new session" / "start fresh" commands
                if (/^(new\s*(chat|session)|start\s*(fresh|over|new)|reset\s*(chat|session))\s*[.!]?\s*$/i.test(text)) {
                    console.log('\x1b[33m[Daemon] Starting new chat session...\x1b[0m');
                    // Kill both agents and respawn
                    if (this.claudeAgentId) this.manager.killAgent(this.claudeAgentId);
                    if (this.codexAgentId) this.manager.killAgent(this.codexAgentId);
                    const claude = this.manager.spawnAgent(this.defaultProjectDir, 'claude', 'claude');
                    this.claudeAgentId = claude.agentId;
                    const codex = this.manager.spawnAgent(this.defaultProjectDir, 'codex', 'codex');
                    this.codexAgentId = codex.agentId;
                    // Tell bridge to clear phone history
                    this.send({ type: 'new_session' });
                    // Tell user
                    const sink = this.createSink(claude.agentId);
                    sink.sendResult('Fresh session started. What do you need?');
                    sink.sendSpeak('Fresh session started. What do you need?');
                    console.log(`\x1b[32m[Daemon] New session ready: Claude=${claude.agentId}, Codex=${codex.agentId}\x1b[0m`);
                    break;
                }

                // Route to the right agent based on engine field
                const requestedEngine: 'claude' | 'codex' = msg.engine === 'codex' ? 'codex' : 'claude';
                const agentId = requestedEngine === 'codex' ? this.codexAgentId : this.claudeAgentId;

                if (!agentId) {
                    console.error('[Daemon] No agent available for command');
                    return;
                }
                console.log(`\x1b[35m[Daemon] Command → ${agentId} [${requestedEngine}]: "${text.slice(0, 60)}"\x1b[0m`);

                // Immediate contextual acknowledgment — user hears something right away
                const ackSink = this.createSink(agentId);
                const ack = this.getContextualAck(text);
                ackSink.sendSpeak(ack);

                this.manager.sendCommand(agentId, text, msg.images).catch(err => {
                    console.error(`[Daemon] Error running command on ${agentId}:`, err);
                });
                break;
            }

            case 'stop': {
                const stopEngine: 'claude' | 'codex' = msg.engine === 'codex' ? 'codex' : 'claude';
                const agentId = msg.agentId || (stopEngine === 'codex' ? this.codexAgentId : this.claudeAgentId);
                if (agentId) {
                    console.log(`\x1b[33m[Daemon] Stop → ${agentId}\x1b[0m`);
                    this.manager.stopAgent(agentId);
                }
                break;
            }

            // ── Multi-agent messages (for when bridge is updated) ──
            case 'spawn_agent': {
                const info = this.manager.spawnAgent(
                    msg.projectDir,
                    msg.name,
                    msg.engine || 'claude'
                );
                this.send({
                    type: 'agent_spawned',
                    agentId: info.agentId,
                    name: info.name,
                    projectDir: info.projectDir,
                    engine: info.engine,
                });
                break;
            }

            case 'kill_agent': {
                const killed = this.manager.killAgent(msg.agentId);
                if (killed) {
                    this.send({ type: 'agent_killed', agentId: msg.agentId });
                }
                break;
            }

            case 'list_agents': {
                const agents = this.manager.listAgents();
                this.send({ type: 'agent_list', agents });
                break;
            }

            case 'list_files': {
                this.handleListFiles(msg.path || this.defaultProjectDir);
                break;
            }

            case 'read_file': {
                this.handleReadFile(msg.path);
                break;
            }

            default:
                // Silently ignore unknown types (bridge sends pings, etc.)
                break;
        }
    }

    /**
     * Create an AgentSink for sending messages back to the bridge.
     * Includes engine type in speak/result/narration so bridge can pick the right TTS voice.
     */
    private createSink(agentId: string): AgentSink {
        const agentInfo = this.manager.getAgent(agentId);
        const engine = agentInfo?.engine || 'claude';
        return {
            sendStatus: (text) => this.send({ type: 'status', text, engine }),
            sendToolStatus: (text) => this.send({ type: 'tool_status', text, engine }),
            sendResult: (text, skipTts) => this.send({ type: 'result', text, engine, ...(skipTts ? { skipTts: true } : {}) }),
            sendSpeak: (text) => this.send({ type: 'speak', text, engine }),
            sendNarration: (text) => this.send({ type: 'narration', text, engine }),
            sendNewSession: () => this.send({ type: 'new_session' }),
            sendWorkspace: (dir) => {
                const path = require('path');
                const workspace = path.basename(dir);
                this.send({ type: 'workspace', data: { workspace, repo: dir } });
            },
        };
    }

    /** Pick a natural acknowledgment based on what the user said */
    private getContextualAck(text: string): string {
        const t = text.toLowerCase().trim();

        // Questions — user is asking something
        const questionWords = /^(what|where|how|why|when|can|do|is|are|did|does|will|would|should|could|have|has|who)\b/;
        if (t.includes('?') || questionWords.test(t)) return 'Good question, let me have a look.';

        // Navigation — going somewhere
        if (/\b(go to|navigate|switch to|open|head to|check out)\b/.test(t)) return 'Sure thing, heading there now.';

        // Fixing / debugging
        if (/\b(fix|debug|solve|repair|broken|bug|issue|error|wrong|problem)\b/.test(t)) return "Alright, let me dig into that.";

        // Reading / checking
        if (/\b(read|look at|check|show me|what's in|have a look|see what)\b/.test(t)) return 'Let me pull that up for you.';

        // Creating / building
        if (/\b(create|build|make|add|write|set up|install|generate)\b/.test(t)) return "Alright, I'll get that sorted.";

        // Explaining / telling
        if (/\b(explain|tell me|describe|walk me through|what does|what is)\b/.test(t)) return 'Sure, let me walk you through it.';

        // Short acknowledgments / confirmations from user
        if (t.length < 15) return 'Got it, one sec.';

        return 'Alright, give me a moment.';
    }

    private handleReadFile(filePath: string): void {
        const fs = require('fs');
        try {
            const stat = fs.statSync(filePath);
            // Limit to 100KB to avoid sending huge files over WebSocket
            if (stat.size > 100 * 1024) {
                this.send({ type: 'file_content', path: filePath, content: null, error: 'File too large (>100KB)' });
                return;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            this.send({ type: 'file_content', path: filePath, content });
        } catch (err: any) {
            console.error('[Daemon] Failed to read file:', err.message);
            this.send({ type: 'file_content', path: filePath, content: null, error: err.message });
        }
    }

    private handleListFiles(dirPath: string): void {
        const fs = require('fs');
        const path = require('path');
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const files = entries
                .filter((e: any) => (e.name === '.matthews' || !e.name.startsWith('.')) && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '__pycache__')
                .map((e: any) => ({
                    name: e.name,
                    type: e.isDirectory() ? 'dir' : 'file',
                }))
                .sort((a: any, b: any) => {
                    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
            this.send({ type: 'file_list', path: dirPath, files });
        } catch (err: any) {
            console.error('[Daemon] Failed to list files:', err.message);
            this.send({ type: 'file_list', path: dirPath, files: [], error: err.message });
        }
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;
        this.reconnectTimer = setTimeout(() => {
            if (this.shouldReconnect) this.doConnect();
        }, RECONNECT_INTERVAL);
    }

    dispose(): void {
        this.disconnect();
        this.manager.dispose();
    }
}
