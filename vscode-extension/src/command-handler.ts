import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { spawn, ChildProcess } from 'child_process';

const TERMINAL_NAME = 'VOICE AGENT';

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

                // Process complete JSON lines
                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop() || ''; // keep incomplete line in buffer

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        const event = JSON.parse(trimmed);
                        this.handleStreamEvent(event, client, (text) => {
                            fullResponseText += text;
                        });
                    } catch {
                        // Not JSON — show raw output
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

            this.activeProcess.stdin?.write(prompt);
            this.activeProcess.stdin?.end();

            this.activeProcess.on('error', (err) => {
                if (err.message.includes('ENOENT')) {
                    reject(new Error('Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code'));
                } else {
                    reject(err);
                }
            });

            this.activeProcess.on('close', (code) => {
                // Process any remaining buffer
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
                if (code === 0) {
                    resolve(fullResponseText.trim() || 'Done.');
                } else {
                    reject(new Error(fullResponseText.trim() || `Claude exited with code ${code}`));
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

    /**
     * Parse a stream-json event and display it nicely in the terminal.
     * Also accumulates response text and sends streaming status to phone.
     */
    private handleStreamEvent(
        event: any,
        client: BridgeClient,
        onText: (text: string) => void,
    ): void {
        // Handle different event types from claude --output-format stream-json
        if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === 'text') {
                    onText(block.text);
                    this.writeEmitter.fire(`\x1b[36m${block.text.replace(/\n/g, '\r\n')}\x1b[0m`);
                    client.sendStatus(block.text);
                } else if (block.type === 'tool_use') {
                    this.showToolCall(block);
                }
            }
        } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
                onText(event.delta.text);
                this.writeEmitter.fire(`\x1b[36m${event.delta.text.replace(/\n/g, '\r\n')}\x1b[0m`);
            }
        } else if (event.type === 'result') {
            // Final result — may contain the full text
            if (event.result) {
                // Don't double-add if already accumulated
                if (!event.result.startsWith('{')) {
                    this.writeEmitter.fire(`\r\n\x1b[36m${event.result.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
                }
            }
        } else if (event.type === 'system' && event.subtype === 'tool_use') {
            this.showToolCall(event);
        } else if (event.type === 'tool_use' || event.tool_name || event.name) {
            this.showToolCall(event);
        } else if (event.type === 'tool_result') {
            // Show brief tool result
            const output = typeof event.output === 'string' ? event.output : JSON.stringify(event.output || '');
            const preview = output.length > 200 ? output.slice(0, 200) + '...' : output;
            this.writeEmitter.fire(`\x1b[2m   ↳ ${preview.replace(/\n/g, '\r\n   ')}\x1b[0m\r\n`);
        }
    }

    /**
     * Display a tool call (Read, Edit, Write, Bash, etc.) in the terminal
     */
    private showToolCall(block: any): void {
        const toolName = block.name || block.tool_name || 'tool';
        const input = block.input || {};

        let display = '';
        switch (toolName) {
            case 'Read':
                display = `📖 Reading: ${input.file_path || 'file'}`;
                break;
            case 'Edit':
                display = `✏️  Editing: ${input.file_path || 'file'}`;
                break;
            case 'Write':
                display = `📝 Writing: ${input.file_path || 'file'}`;
                break;
            case 'Bash':
                display = `💻 Running: ${(input.command || '').slice(0, 100)}`;
                break;
            case 'Glob':
                display = `🔍 Searching files: ${input.pattern || ''}`;
                break;
            case 'Grep':
                display = `🔎 Searching code: ${input.pattern || ''}`;
                break;
            default:
                display = `🔧 ${toolName}: ${JSON.stringify(input).slice(0, 100)}`;
        }

        this.writeEmitter.fire(`\r\n\x1b[33m${display}\x1b[0m\r\n`);
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
