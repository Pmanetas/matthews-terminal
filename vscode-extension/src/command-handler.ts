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

        // Ensure terminal exists
        this.ensureTerminal();
        this.terminal?.show(false); // false = take focus so user sees output

        this.isProcessing = true;

        // Show user message in terminal
        this.writeEmitter.fire(`\r\n\x1b[35m🎤 You:\x1b[0m ${text}\r\n`);
        this.writeEmitter.fire(`\x1b[2m⏳ Claude is thinking...\x1b[0m\r\n\r\n`);
        client.sendStatus('Thinking...');

        try {
            const response = await this.runClaude(text, client);
            // Show response in terminal
            this.writeEmitter.fire(`\x1b[36m🤖 Claude:\x1b[0m\r\n`);
            this.writeEmitter.fire(response.replace(/\n/g, '\r\n'));
            this.writeEmitter.fire('\r\n');
            // Send final response to phone
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

            const args = ['--print', '--dangerously-skip-permissions'];
            if (this.conversationStarted) {
                args.push('--continue');
            }

            this.activeProcess = spawn(claudePath, args, {
                cwd,
                shell: true,
                env: { ...process.env },
            });

            let fullOutput = '';

            this.activeProcess.stdout?.on('data', (data: Buffer) => {
                const chunk = data.toString();
                fullOutput += chunk;
                // Stream to terminal
                this.writeEmitter.fire(chunk.replace(/\n/g, '\r\n'));
                // Stream to phone
                client.sendStatus(fullOutput);
            });

            this.activeProcess.stderr?.on('data', (data: Buffer) => {
                const err = data.toString().trim();
                if (err.length > 0) {
                    console.error('[Matthews Terminal] stderr:', err);
                    // Show stderr in terminal too so user can see what's happening
                    this.writeEmitter.fire(`\x1b[2m${err.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
                }
            });

            // Write prompt via stdin to avoid shell escaping issues
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
                this.conversationStarted = true;
                if (code === 0) {
                    resolve(fullOutput.trim() || 'Done.');
                } else {
                    reject(new Error(fullOutput.trim() || `Claude exited with code ${code}`));
                }
            });

            // Timeout after 3 minutes
            setTimeout(() => {
                if (this.isProcessing && this.activeProcess) {
                    this.activeProcess.kill();
                    reject(new Error('Timed out after 3 minutes.'));
                }
            }, 180_000);
        });
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
