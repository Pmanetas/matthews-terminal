import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { spawn, ChildProcess } from 'child_process';

export class CommandHandler {
    private isProcessing = false;
    private activeProcess: ChildProcess | undefined;
    private outputChannel: vscode.OutputChannel;
    private conversationStarted = false;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Matthews Terminal');
    }

    async handleCommand(text: string, client: BridgeClient): Promise<void> {
        if (this.isProcessing) {
            client.sendStatus('Still working on the last command...');
            return;
        }

        this.isProcessing = true;
        client.sendStatus('Thinking...');

        // Show in VS Code output panel
        this.outputChannel.show(true);
        this.outputChannel.appendLine(`\n🎤 You: ${text}`);
        this.outputChannel.appendLine('⏳ Claude is thinking...\n');

        try {
            const response = await this.runClaude(text, client);
            this.outputChannel.appendLine(`🤖 Claude: ${response}\n`);
            client.sendResult(response);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(`❌ Error: ${msg}\n`);
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

            // Build args: --print for non-interactive, --continue to keep conversation
            const args = ['--print'];
            if (this.conversationStarted) {
                args.push('--continue');
            }
            // Pass prompt via stdin to avoid shell escaping issues
            args.push('-');

            this.activeProcess = spawn(claudePath, args, {
                cwd,
                shell: true,
                env: { ...process.env },
            });

            let fullOutput = '';

            this.activeProcess.stdout?.on('data', (data: Buffer) => {
                const chunk = data.toString();
                fullOutput += chunk;
                client.sendStatus(fullOutput);
                this.outputChannel.append(chunk);
            });

            this.activeProcess.stderr?.on('data', (data: Buffer) => {
                const err = data.toString().trim();
                if (err.length > 0) {
                    console.error('[Matthews Terminal] stderr:', err);
                }
            });

            // Write the prompt to stdin and close it
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

            // Timeout after 3 minutes for bigger tasks
            setTimeout(() => {
                if (this.isProcessing && this.activeProcess) {
                    this.activeProcess.kill();
                    reject(new Error('Claude took too long (3 min timeout).'));
                }
            }, 180_000);
        });
    }

    dispose(): void {
        if (this.activeProcess) {
            this.activeProcess.kill();
        }
        this.outputChannel.dispose();
    }
}
