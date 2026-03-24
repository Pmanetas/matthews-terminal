import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';

const TERMINAL_NAME = 'VOICE AGENT';

export class CommandHandler {
    private terminal: vscode.Terminal | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Clean up reference if terminal is closed
        this.disposables.push(
            vscode.window.onDidCloseTerminal((closed) => {
                if (closed === this.terminal) {
                    this.terminal = undefined;
                }
            })
        );
    }

    /**
     * Sends voice command text into the Claude Code interactive terminal.
     * User sees everything happening in VS Code — Claude thinking, editing, creating files.
     * Phone is just a voice remote.
     */
    async handleCommand(text: string, client: BridgeClient): Promise<void> {
        try {
            const terminal = this.getOrCreateClaudeTerminal();
            terminal.show(true);

            // Send the voice text directly into the Claude terminal
            terminal.sendText(text);

            client.sendStatus(`Sent to Claude: "${text}"`);
            client.sendResult(`Command sent to Claude Code — check VS Code to see it working.`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            client.sendResult(`Error: ${msg}`);
        }
    }

    /**
     * Gets or creates a terminal running `claude` in interactive mode.
     */
    private getOrCreateClaudeTerminal(): vscode.Terminal {
        // Reuse existing terminal if still alive
        if (this.terminal) {
            return this.terminal;
        }

        // Look for existing VOICE AGENT terminal
        const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME);
        if (existing) {
            this.terminal = existing;
            return this.terminal;
        }

        // Create new terminal running claude in interactive mode
        this.terminal = vscode.window.createTerminal({
            name: TERMINAL_NAME,
            shellPath: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
            shellArgs: process.platform === 'win32' ? ['/c', 'claude'] : ['-c', 'claude'],
        });
        this.terminal.show(true);

        return this.terminal;
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
