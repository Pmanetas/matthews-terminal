/**
 * BridgeConnection — WebSocket client connecting daemon to the voice bridge.
 *
 * Identifies as 'daemon' role, routes incoming commands to AgentManager,
 * and provides an AgentSink factory that tags every outbound message with agentId.
 */

import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
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
    private lastClaudeWorkspace: string;
    private isFirstConnect = true;

    constructor(bridgeUrl: string, defaultProjectDir: string) {
        this.bridgeUrl = bridgeUrl;
        this.defaultProjectDir = defaultProjectDir;
        this.lastClaudeWorkspace = defaultProjectDir;
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

                // Only clear phone chat on first connect (daemon restart),
                // not on WebSocket reconnects which are just connection blips
                if (this.isFirstConnect) {
                    this.send({ type: 'new_session' });
                    this.isFirstConnect = false;
                }

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

                // ── Sabrina handoff detection ──
                // Only trigger on very deliberate handoff phrases — must be explicit intent
                // to hand work over, not just casually mentioning Sabrina in conversation.
                const sabrinaPattern = /\b(pass\s+(it\s+)?(to|over\s+to)\s+sabrina|hand\s+(it\s+)?(to|over\s+to)\s+sabrina|send\s+(it\s+)?(to|over\s+to)\s+sabrina|give\s+(it\s+)?to\s+sabrina|sabrina\s+audit\s+this|sabrina\s+review\s+this|sabrina\s+check\s+this)\b/i;
                if (sabrinaPattern.test(text) && this.codexAgentId) {
                    console.log('\x1b[35m[Daemon] Sabrina handoff detected — building audit prompt\x1b[0m');

                    // If Claude switched workspace, respawn Sabrina in the right project
                    const auditDir = this.lastClaudeWorkspace || this.defaultProjectDir;
                    const currentAgent = this.manager.getAgent(this.codexAgentId);
                    if (currentAgent && currentAgent.projectDir !== auditDir) {
                        console.log(`\x1b[35m[Daemon] Respawning Sabrina in ${path.basename(auditDir)} for audit\x1b[0m`);
                        this.manager.killAgent(this.codexAgentId);
                        const newInfo = this.manager.spawnAgent(auditDir, 'codex', 'codex');
                        this.codexAgentId = newInfo.agentId;
                    }

                    const sabrinaSink = this.createSink(this.codexAgentId);
                    sabrinaSink.sendSpeak("I'll get Sabrina to have a look at that.");

                    // Build the audit prompt asynchronously
                    this.buildSabrinaAuditPrompt().then(auditPrompt => {
                        this.manager.sendCommand(this.codexAgentId!, auditPrompt, msg.images).catch(err => {
                            console.error(`[Daemon] Error running Sabrina audit:`, err);
                        });
                    }).catch(err => {
                        console.error('[Daemon] Failed to build Sabrina audit prompt:', err);
                        sabrinaSink.sendResult('Sorry, I had trouble pulling together the context for Sabrina.');
                    });
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
                // Track Claude's current workspace for Sabrina audit context
                if (engine === 'claude') {
                    this.lastClaudeWorkspace = dir;
                }
            },
        };
    }

    /**
     * Build a rich audit prompt for Sabrina by gathering recent conversation
     * history and the latest git diff.
     */
    private async buildSabrinaAuditPrompt(): Promise<string> {
        // Use Claude's current workspace, not the daemon's default project dir
        const auditDir = this.lastClaudeWorkspace || this.defaultProjectDir;
        console.log(`\x1b[35m[Daemon] Building Sabrina audit for: ${path.basename(auditDir)}\x1b[0m`);

        // 1. Read last ~50 lines of conversation history
        let conversationContext = '';
        const convPath = path.join(auditDir, '.matthews', 'claude-conversation.md');
        try {
            const content = fs.readFileSync(convPath, 'utf-8');
            const lines = content.split('\n');
            const last50 = lines.slice(-50).join('\n');
            conversationContext = last50;
        } catch {
            conversationContext = '(No conversation history found)';
        }

        // 2. Get the git diff of the last commit
        let gitDiff = '';
        try {
            gitDiff = await new Promise<string>((resolve, reject) => {
                exec('git diff HEAD~1', { cwd: auditDir, maxBuffer: 1024 * 512 }, (err, stdout) => {
                    if (err) {
                        // Fallback: try staged + unstaged diff
                        exec('git diff', { cwd: auditDir, maxBuffer: 1024 * 512 }, (err2, stdout2) => {
                            resolve(err2 ? '(Could not get git diff)' : stdout2);
                        });
                    } else {
                        resolve(stdout);
                    }
                });
            });
        } catch {
            gitDiff = '(Could not get git diff)';
        }

        // 3. Construct the full audit prompt
        return `You've been asked to do a full code audit of the recent changes in the project at: ${auditDir}

Here's the context:

## Recent Conversation History
${conversationContext}

## Git Diff (Recent Changes)
\`\`\`diff
${gitDiff}
\`\`\`

## Your Task
Do a thorough audit of these changes. Check every file that was modified. Look for:
- Bugs or logic errors
- Missed edge cases
- Typos or incorrect variable names
- Anything that looks off or doesn't match the intent described in the conversation
- Security issues or bad patterns

Read the actual files if you need more context beyond the diff. Be thorough, then give a concise spoken summary of what you found.`;
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
        const TAIL_SIZE = 50 * 1024; // 50KB tail for large files
        try {
            const stat = fs.statSync(filePath);
            if (stat.size > 100 * 1024) {
                // Large file — read just the last 50KB so phone sees most recent content
                const fd = fs.openSync(filePath, 'r');
                const start = stat.size - TAIL_SIZE;
                const buf = Buffer.alloc(TAIL_SIZE);
                fs.readSync(fd, buf, 0, TAIL_SIZE, start);
                // Count newlines in the skipped portion to get accurate line numbers
                const headBuf = Buffer.alloc(start);
                fs.readSync(fd, headBuf, 0, start, 0);
                fs.closeSync(fd);
                let tail = buf.toString('utf-8');
                // Drop the first partial line (we likely landed mid-line)
                const firstNewline = tail.indexOf('\n');
                if (firstNewline > 0) tail = tail.slice(firstNewline + 1);
                // Count lines in skipped portion
                let skippedLines = 1; // start at line 1
                for (let i = 0; i < headBuf.length; i++) {
                    if (headBuf[i] === 0x0a) skippedLines++;
                }
                // Add lines from the dropped partial first line
                if (firstNewline > 0) skippedLines++;
                this.send({ type: 'file_content', path: filePath, content: tail, truncated: true, startLine: skippedLines });
            } else {
                const content = fs.readFileSync(filePath, 'utf-8');
                this.send({ type: 'file_content', path: filePath, content });
            }
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
