/**
 * CodexRunner — Spawns OpenAI Codex CLI and parses its JSONL output.
 *
 * Mirrors AgentRunner but for Codex CLI instead of Claude CLI.
 * Uses `codex exec --json` for non-interactive execution with JSONL streaming.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentSink, ImageData } from './types';
import { SessionContext } from './session-context';
import { ConversationLog } from './conversation-log';

const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
};

const CODEX_SYSTEM_PROMPT = `You are a friendly software engineer assistant called via Codex. Your responses are read aloud by text-to-speech. Rules:
- Talk like you're chatting with a mate — natural, conversational sentences.
- NEVER use bullet points, numbered lists, dashes, or markdown formatting.
- CRITICAL: Keep your final summary SHORT — 2 to 3 sentences max, all in ONE paragraph. No line breaks between sentences. Just one flowing block of text.
- CRITICAL: Narrate what you're doing as you go. Before each action, say a short sentence about what you're about to do.
- Keep each narration line short — one sentence, like you're thinking out loud.
- After finishing, give a brief 2-3 sentence summary in one paragraph.
- Speak naturally: "I'll update the background colour" not "Modified file.ts line 42".`;

export class CodexRunner {
    private readonly projectDir: string;
    private readonly agentId: string;
    private isProcessing = false;
    private activeProcess: ChildProcess | undefined;
    private aborted = false;
    private lastUserPrompt = '';

    // Session persistence
    private sessionContext: SessionContext;
    private conversationLog: ConversationLog;

    constructor(agentId: string, projectDir: string) {
        this.agentId = agentId;
        this.projectDir = projectDir;
        this.sessionContext = new SessionContext(projectDir);
        this.conversationLog = new ConversationLog(projectDir);
    }

    get id(): string { return this.agentId; }
    get busy(): boolean { return this.isProcessing; }

    abortCommand(sink: AgentSink): void {
        if (!this.isProcessing || !this.activeProcess) return;

        console.log(`[Codex ${this.agentId}] Aborting active command`);
        this.aborted = true;
        const pid = this.activeProcess.pid;
        if (pid) {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/F', '/T', '/PID', pid.toString()], { shell: true });
            } else {
                this.activeProcess.kill('SIGTERM');
            }
        }
        this.activeProcess = undefined;
        this.isProcessing = false;
        sink.sendResult('Stopped.');
    }

    async handleCommand(text: string, sink: AgentSink, images?: ImageData[]): Promise<void> {
        if (this.isProcessing) {
            sink.sendResult('Still working on something...');
            return;
        }

        this.isProcessing = true;
        this.aborted = false;
        this.lastUserPrompt = text;

        this.conversationLog.logUser(text, images?.length);

        const imgLabel = images?.length ? ` [+${images.length} image(s)]` : '';
        console.log(`\n${C.blue}🤖 You (→Codex):${C.reset} ${text}${imgLabel}`);
        console.log(`${C.dim}⏳ Codex is thinking...${C.reset}\n`);

        sink.sendStatus('Thinking...');

        // Save images to temp files
        const imageFiles: string[] = [];
        if (images && images.length > 0) {
            const tmpDir = path.join(os.tmpdir(), 'matthews-terminal-images');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            for (const img of images) {
                const ext = img.mimeType.includes('png') ? '.png' : '.jpg';
                const filename = `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`;
                const filepath = path.join(tmpDir, filename);
                fs.writeFileSync(filepath, Buffer.from(img.data, 'base64'));
                imageFiles.push(filepath);
            }
        }

        try {
            const result = await this.runCodex(text, sink, imageFiles);
            if (this.aborted) {
                console.log(`[Codex ${this.agentId}] Command was aborted, skipping result`);
            } else {
                const finalText = result.trim() || 'Done';
                console.log(`\n${C.green}✅ Codex Result:${C.reset} ${finalText.slice(0, 200)}${finalText.length > 200 ? '...' : ''}`);
                sink.sendResult(finalText);
                this.sessionContext.saveExchange(this.lastUserPrompt, finalText);
                this.conversationLog.logAssistant(finalText);
            }
        } catch (err: unknown) {
            if (!this.aborted) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`\n${C.red}❌ Codex Error: ${msg}${C.reset}`);
                sink.sendResult(`Error: ${msg}`);
            }
        } finally {
            this.isProcessing = false;
            this.activeProcess = undefined;
            for (const f of imageFiles) {
                try { fs.unlinkSync(f); } catch {}
            }
        }
    }

    dispose(): void {
        const pid = this.activeProcess?.pid;
        if (pid) {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/F', '/T', '/PID', pid.toString()], { shell: true });
            } else {
                this.activeProcess?.kill('SIGTERM');
            }
        }
        this.activeProcess = undefined;
    }

    // ── Codex CLI ──────────────────────────────────────────

    private runCodex(prompt: string, sink: AgentSink, imageFiles: string[] = []): Promise<string> {
        return new Promise((resolve, reject) => {
            // Build the full prompt with system instructions
            let fullPrompt = `${CODEX_SYSTEM_PROMPT}\n\nUser: ${prompt}`;

            // Add image references if any
            if (imageFiles.length > 0) {
                fullPrompt += imageFiles.map(f =>
                    `\n\n[The user attached an image at: ${f}]`
                ).join('');
            }

            const args = [
                'exec',
                '--json',
                '--dangerously-bypass-approvals-and-sandbox',
                '-C', this.projectDir,
            ];

            // Add image flags if Codex supports them
            for (const img of imageFiles) {
                args.push('-i', img);
            }

            // Add the prompt as the final argument
            args.push(fullPrompt);

            console.log(`${C.dim}[Codex] Spawning: codex ${args.slice(0, 3).join(' ')} ...${C.reset}`);

            this.activeProcess = spawn('codex', args, {
                cwd: this.projectDir,
                shell: true,
                env: { ...process.env },
            });

            let fullResponseText = '';
            let lineBuffer = '';

            this.activeProcess.stdout?.on('data', (data: Buffer) => {
                lineBuffer += data.toString();
                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const event = JSON.parse(trimmed);
                        this.handleCodexEvent(event, sink, (text) => {
                            fullResponseText += text;
                        });
                    } catch {
                        console.log(`[Codex ${this.agentId}] ${trimmed}`);
                    }
                }
            });

            this.activeProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString().trim();
                if (text) {
                    console.log(`${C.dim}[Codex stderr] ${text}${C.reset}`);
                }
            });

            this.activeProcess.on('error', (err) => {
                if (err.message.includes('ENOENT')) {
                    reject(new Error('Codex CLI not found. Install: npm i -g @openai/codex'));
                } else {
                    reject(err);
                }
            });

            this.activeProcess.on('close', (code) => {
                // Process any remaining buffered data
                if (lineBuffer.trim()) {
                    try {
                        const event = JSON.parse(lineBuffer.trim());
                        this.handleCodexEvent(event, sink, (text) => {
                            fullResponseText += text;
                        });
                    } catch { /* ignore */ }
                }
                if (fullResponseText.trim()) {
                    resolve(fullResponseText.trim());
                } else if (code === 0) {
                    resolve('Done.');
                } else {
                    reject(new Error(`Codex exited with code ${code}`));
                }
            });
        });
    }

    /**
     * Handle a single JSONL event from Codex CLI.
     *
     * Codex emits these event types:
     * - thread.started: { thread_id }
     * - turn.started: {}
     * - item.started: { item: { id, type, command, status: "in_progress" } }
     * - item.completed: { item: { id, type, text?, command?, aggregated_output?, exit_code? } }
     * - turn.completed: { usage }
     * - turn.failed: { error }
     * - error: { message }
     */
    private handleCodexEvent(
        event: any,
        sink: AgentSink,
        appendText: (text: string) => void,
    ): void {
        switch (event.type) {
            case 'thread.started':
                console.log(`${C.dim}[Codex] Thread: ${event.thread_id}${C.reset}`);
                break;

            case 'turn.started':
                console.log(`${C.dim}[Codex] Turn started${C.reset}`);
                break;

            case 'item.started': {
                const item = event.item;
                if (item?.type === 'command_execution' && item.command) {
                    const shortCmd = item.command.length > 80
                        ? item.command.slice(0, 80) + '...'
                        : item.command;
                    console.log(`${C.yellow}[Codex] Running: ${shortCmd}${C.reset}`);
                    sink.sendToolStatus(`Running command: ${shortCmd}`);
                } else if (item?.type === 'file_edit') {
                    console.log(`${C.yellow}[Codex] Editing file${C.reset}`);
                    sink.sendToolStatus('Editing a file');
                } else if (item?.type === 'file_read') {
                    console.log(`${C.yellow}[Codex] Reading file${C.reset}`);
                    sink.sendToolStatus('Reading a file');
                }
                break;
            }

            case 'item.completed': {
                const item = event.item;
                if (!item) break;

                if (item.type === 'agent_message' && item.text) {
                    console.log(`${C.cyan}[Codex] Message: ${item.text.slice(0, 150)}${C.reset}`);
                    appendText(item.text);

                    // Check if this looks like narration (short, mid-task) vs final result
                    // Codex sends multiple agent_message items — narration + final answer
                    sink.sendNarration(item.text);
                    sink.sendSpeak(item.text);
                }

                if (item.type === 'command_execution') {
                    const shortCmd = (item.command || '').length > 60
                        ? (item.command || '').slice(0, 60) + '...'
                        : (item.command || '');
                    const exitCode = item.exit_code ?? '?';
                    console.log(`${C.yellow}[Codex] Command done (exit ${exitCode}): ${shortCmd}${C.reset}`);
                    sink.sendToolStatus(`Command finished (exit ${exitCode})`);
                }
                break;
            }

            case 'turn.completed':
                if (event.usage) {
                    const u = event.usage;
                    console.log(`${C.dim}[Codex] Tokens: ${u.input_tokens} in, ${u.output_tokens} out (${u.cached_input_tokens || 0} cached)${C.reset}`);
                }
                break;

            case 'turn.failed':
                console.log(`${C.red}[Codex] Turn failed: ${JSON.stringify(event.error)}${C.reset}`);
                break;

            case 'error':
                console.log(`${C.red}[Codex] Error: ${event.message}${C.reset}`);
                break;

            default:
                console.log(`${C.dim}[Codex] Unknown event: ${event.type}${C.reset}`);
                break;
        }
    }
}
