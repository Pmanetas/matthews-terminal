import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { exec, ChildProcess } from 'child_process';

export class CommandHandler {
    private isProcessing = false;
    private activeProcess: ChildProcess | undefined;

    /**
     * Routes an incoming voice command to Claude Code CLI.
     * Claude handles everything — coding, file ops, terminal commands, questions.
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

    /**
     * Runs `claude --print` with the given prompt and returns the response.
     * --print runs Claude non-interactively and outputs the response to stdout.
     */
    private runClaude(prompt: string, client: BridgeClient): Promise<string> {
        return new Promise((resolve, reject) => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

            // Escape the prompt for shell safety
            const escaped = prompt.replace(/"/g, '\\"');
            const command = `claude --print "${escaped}"`;

            this.activeProcess = exec(command, {
                cwd,
                timeout: 120_000, // 2 min timeout
                maxBuffer: 1024 * 1024, // 1MB output buffer
            }, (error, stdout, stderr) => {
                clearInterval(statusTimer);

                if (error) {
                    // If claude CLI not found, give helpful message
                    if (error.message.includes('not recognized') || error.message.includes('not found')) {
                        reject(new Error('Claude CLI not found. Make sure Claude Code is installed globally.'));
                        return;
                    }
                    reject(new Error(stderr || error.message));
                    return;
                }
                const output = stdout.trim();
                resolve(output || 'Done — no output.');
            });

            // Send periodic status updates while Claude is working
            const statusTimer = setInterval(() => {
                if (this.isProcessing) {
                    client.sendStatus('Still thinking...');
                }
            }, 10_000);
        });
    }

    dispose(): void {
        if (this.activeProcess) {
            this.activeProcess.kill();
        }
    }
}
