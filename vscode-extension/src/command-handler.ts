import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

const TERMINAL_NAME = 'VOICE AGENT';

const SYSTEM_PROMPT = `You are Matthew, a friendly software engineer assistant. Rules:
- Respond conversationally in natural sentences — talk like you're chatting with a mate.
- NEVER use bullet points, numbered lists, dashes, or markdown formatting.
- Keep responses concise — 2-3 sentences when possible.
- When describing code actions, speak naturally: "I just updated the function" not "Modified file.ts line 42".
- You're speaking out loud — your response will be read by text-to-speech, so write how you'd actually talk.`;

export class CommandHandler {
    private terminal: vscode.Terminal | undefined;
    private writeEmitter = new vscode.EventEmitter<string>();
    private isProcessing = false;
    private activeProcess: ChildProcess | undefined;
    private conversationStarted = false;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            vscode.window.onDidCloseTerminal((closed) => {
                if (closed === this.terminal) {
                    this.terminal = undefined;
                }
            })
        );
    }

    async handleCommand(text: string, client: BridgeClient): Promise<void> {
        if (this.isProcessing) {
            client.sendStatus('Still working on the last command...');
            return;
        }

        this.ensureTerminal();
        this.terminal?.show(false);

        this.isProcessing = true;
        this.writeEmitter.fire(`\r\n\x1b[35m🎤 You:\x1b[0m ${text}\r\n`);
        this.writeEmitter.fire(`\x1b[2m⏳ Claude is thinking...\x1b[0m\r\n\r\n`);
        client.sendStatus('Thinking...');

        try {
            const response = await this.runClaude(text, client);
            this.writeEmitter.fire('\r\n');
            client.sendResult(response);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.writeEmitter.fire(`\r\n\x1b[31m❌ Error: ${msg}\x1b[0m\r\n`);
            client.sendResult(`Error: ${msg}`);
        } finally {
            this.isProcessing = false;
            this.activeProcess = undefined;
        }
    }

    private runClaude(prompt: string, client: BridgeClient): Promise<string> {
        return new Promise((resolve, reject) => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

            const claudePath = process.platform === 'win32'
                ? `${process.env.APPDATA}\\npm\\claude.cmd`
                : 'claude';

            const args = ['--print', '--verbose', '--dangerously-skip-permissions', '--output-format', 'stream-json'];
            if (this.conversationStarted) {
                args.push('--continue');
            }

            this.activeProcess = spawn(claudePath, args, {
                cwd,
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
                        this.handleStreamEvent(event, client, (text) => {
                            fullResponseText += text;
                        });
                    } catch {
                        this.writeEmitter.fire(trimmed.replace(/\n/g, '\r\n') + '\r\n');
                    }
                }
            });

            this.activeProcess.stderr?.on('data', (data: Buffer) => {
                const err = data.toString().trim();
                if (err.length > 0) {
                    console.error('[Matthews Terminal] stderr:', err);
                    this.writeEmitter.fire(`\x1b[2m${err.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
                }
            });

            // Pipe system prompt + user prompt via stdin
            const fullPrompt = this.conversationStarted
                ? prompt
                : `${SYSTEM_PROMPT}\n\nUser: ${prompt}`;
            this.activeProcess.stdin?.write(fullPrompt);
            this.activeProcess.stdin?.end();

            this.activeProcess.on('error', (err) => {
                if (err.message.includes('ENOENT')) {
                    reject(new Error('Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code'));
                } else {
                    reject(err);
                }
            });

            this.activeProcess.on('close', (code) => {
                if (lineBuffer.trim()) {
                    try {
                        const event = JSON.parse(lineBuffer.trim());
                        this.handleStreamEvent(event, client, (text) => {
                            fullResponseText += text;
                        });
                    } catch {
                        // ignore
                    }
                }

                this.conversationStarted = true;
                // Resolve if we have response text, even on non-zero exit
                // (stream-json mode can exit non-zero but still have valid output)
                if (fullResponseText.trim()) {
                    resolve(fullResponseText.trim());
                } else if (code === 0) {
                    resolve('Done.');
                } else {
                    reject(new Error(`Claude exited with code ${code}`));
                }
            });

            setTimeout(() => {
                if (this.isProcessing && this.activeProcess) {
                    this.activeProcess.kill();
                    reject(new Error('Timed out after 3 minutes.'));
                }
            }, 180_000);
        });
    }

    private handleStreamEvent(
        event: any,
        client: BridgeClient,
        onText: (text: string) => void,
    ): void {
        if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === 'text') {
                    onText(block.text);
                    this.writeEmitter.fire(`\x1b[36m${block.text.replace(/\n/g, '\r\n')}\x1b[0m`);
                    client.sendStatus(block.text);
                } else if (block.type === 'tool_use') {
                    const msg = this.describeToolCall(block);
                    this.writeEmitter.fire(`\r\n\x1b[33m${msg}\x1b[0m\r\n`);
                    // Send tool status to phone so user hears what's happening
                    client.sendStatus(msg);
                }
            }
        } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
                onText(event.delta.text);
                this.writeEmitter.fire(`\x1b[36m${event.delta.text.replace(/\n/g, '\r\n')}\x1b[0m`);
            }
        } else if (event.type === 'result') {
            // Skip — text already accumulated from streaming, don't duplicate
        } else if (event.type === 'system' && event.subtype === 'tool_use') {
            const msg = this.describeToolCall(event);
            this.writeEmitter.fire(`\r\n\x1b[33m${msg}\x1b[0m\r\n`);
            client.sendStatus(msg);
        } else if (event.type === 'tool_use' || event.tool_name || event.name) {
            const msg = this.describeToolCall(event);
            this.writeEmitter.fire(`\r\n\x1b[33m${msg}\x1b[0m\r\n`);
            client.sendStatus(msg);
        } else if (event.type === 'tool_result') {
            const output = typeof event.output === 'string' ? event.output : JSON.stringify(event.output || '');
            const preview = output.length > 150 ? output.slice(0, 150) + '...' : output;
            this.writeEmitter.fire(`\x1b[2m   ${preview.replace(/\n/g, '\r\n   ')}\x1b[0m\r\n`);
        }
    }

    /**
     * Describe tool calls in natural language — like Matthew is talking
     */
    private describeToolCall(block: any): string {
        const toolName = block.name || block.tool_name || 'tool';
        const input = block.input || {};

        const fileName = input.file_path ? path.basename(input.file_path) : 'a file';

        switch (toolName) {
            case 'Read':
                return `I'm reading ${fileName}...`;
            case 'Edit':
                return `I'm making some changes to ${fileName}...`;
            case 'Write':
                return `I'm creating ${fileName}...`;
            case 'Bash': {
                const cmd = (input.command || '').trim();
                const short = cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
                return `I'm running a command — ${short}`;
            }
            case 'Glob':
                return `I'm searching for files matching ${input.pattern || 'a pattern'}...`;
            case 'Grep':
                return `I'm searching the code for "${input.pattern || 'something'}"...`;
            default:
                return `I'm using ${toolName}...`;
        }
    }

    private ensureTerminal(): void {
        if (this.terminal) return;

        const pty: vscode.Pseudoterminal = {
            onDidWrite: this.writeEmitter.event,
            open: () => {
                this.writeEmitter.fire('\x1b[36mMatthews Terminal — Voice Agent\x1b[0m\r\n');
                this.writeEmitter.fire('\x1b[2mSpeak from your phone to send commands to Claude.\x1b[0m\r\n');
            },
            close: () => {
                this.activeProcess?.kill();
            },
        };

        this.terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, pty });
    }

    dispose(): void {
        this.activeProcess?.kill();
        this.terminal?.dispose();
        this.writeEmitter.dispose();
        for (const d of this.disposables) d.dispose();
    }
}
