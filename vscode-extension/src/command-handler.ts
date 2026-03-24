import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { spawn, ChildProcess } from 'child_process';

export class CommandHandler {
    private isProcessing = false;
    private activeProcess: ChildProcess | undefined;

    /**
     * Runs voice command through Claude Code CLI and streams the response
     * back to the phone. Claude can read/write files, run commands, etc.
     * Changes appear in VS Code's explorer in real-time.
     */
    async handleCommand(text: string, client: BridgeClient): Promise<void> {
        if (this.isProcessing) {
            client.sendStatus('Still working on the last command...');
            return;
        }

        this.isProcessing = true;
        client.sendStatus('Thinking...');

        try {
            const response = await this.runClaude(text, client);
            client.sendResult(response);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
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

            // Resolve claude binary path
            const claudePath = process.platform === 'win32'
                ? `${process.env.APPDATA}\\npm\\claude.cmd`
                : 'claude';

            this.activeProcess = spawn(claudePath, ['--print', prompt], {
                cwd,
                shell: true,
                env: { ...process.env },
            });

            let fullOutput = '';
            let lastChunkTime = Date.now();

            // Stream stdout chunks back to phone as status updates
            this.activeProcess.stdout?.on('data', (data: Buffer) => {
                const chunk = data.toString();
                fullOutput += chunk;
                lastChunkTime = Date.now();
                // Send partial response so phone sees it building up
                client.sendStatus(fullOutput);
            });

            this.activeProcess.stderr?.on('data', (data: Buffer) => {
                const err = data.toString();
                // Don't send stderr noise to phone unless it's meaningful
                if (err.trim().length > 0) {
                    console.error('[Matthews Terminal] Claude stderr:', err);
                }
            });

            this.activeProcess.on('error', (err) => {
                if (err.message.includes('ENOENT')) {
                    reject(new Error('Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code'));
                } else {
                    reject(err);
                }
            });

            this.activeProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(fullOutput.trim() || 'Done.');
                } else {
                    reject(new Error(fullOutput.trim() || `Claude exited with code ${code}`));
                }
            });

            // Timeout after 2 minutes
            setTimeout(() => {
                if (this.isProcessing && this.activeProcess) {
                    this.activeProcess.kill();
                    reject(new Error('Claude took too long (2 min timeout).'));
                }
            }, 120_000);
        });
    }

    dispose(): void {
        if (this.activeProcess) {
            this.activeProcess.kill();
        }
    }
}
