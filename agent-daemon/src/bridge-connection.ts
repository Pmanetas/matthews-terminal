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
    // Default agent for single-agent compatibility mode (works with existing bridge)
    private defaultAgentId: string | null = null;
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
                this.send({ type: 'identify', client: 'extension' });

                // Send workspace info like the VS Code extension does
                const path = require('path');
                const workspace = path.basename(this.defaultProjectDir);
                this.send({ type: 'workspace', data: { workspace, repo: this.defaultProjectDir } });

                // Now safe to log (client is identified, daemon_log will be forwarded)
                console.log('\x1b[32m[Daemon] Connected to bridge\x1b[0m');

                // Auto-spawn the default agent if not already running
                if (!this.defaultAgentId) {
                    const info = this.manager.spawnAgent(this.defaultProjectDir, 'default', 'claude');
                    this.defaultAgentId = info.agentId;
                    console.log(`\x1b[36m[Daemon] Default agent ready: ${info.agentId} in ${this.defaultProjectDir}\x1b[0m`);
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
                const agentId = msg.agentId || this.defaultAgentId;
                if (!agentId) {
                    console.error('[Daemon] No agent available for command');
                    return;
                }
                console.log(`\x1b[35m[Daemon] Command → ${agentId}: "${(msg.text || '').slice(0, 60)}"\x1b[0m`);
                this.manager.sendCommand(agentId, msg.text, msg.images).catch(err => {
                    console.error(`[Daemon] Error running command on ${agentId}:`, err);
                });
                break;
            }

            case 'stop': {
                const agentId = msg.agentId || this.defaultAgentId;
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

            default:
                // Silently ignore unknown types (bridge sends pings, etc.)
                break;
        }
    }

    /**
     * Create an AgentSink for sending messages back to the bridge.
     * In compatibility mode (identifying as 'extension'), messages are sent
     * WITHOUT agentId so the existing bridge handles them normally.
     */
    private createSink(agentId: string): AgentSink {
        return {
            sendStatus: (text) => this.send({ type: 'status', text }),
            sendToolStatus: (text) => this.send({ type: 'tool_status', text }),
            sendResult: (text) => this.send({ type: 'result', text }),
            sendSpeak: (text) => this.send({ type: 'speak', text }),
            sendNarration: (text) => this.send({ type: 'narration', text }),
            sendNewSession: () => this.send({ type: 'new_session' }),
        };
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
