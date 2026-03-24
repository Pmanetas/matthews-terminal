import * as vscode from 'vscode';

const TERMINAL_NAME = 'VOICE AGENT';

export class TerminalManager {
    private terminal: vscode.Terminal | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Listen for terminal close events to clean up our reference
        this.disposables.push(
            vscode.window.onDidCloseTerminal((closed) => {
                if (closed === this.terminal) {
                    this.terminal = undefined;
                }
            })
        );
    }

    /**
     * Finds the existing VOICE AGENT terminal or creates a new one.
     */
    getOrCreateTerminal(): vscode.Terminal {
        // Check if our cached terminal is still alive
        if (this.terminal) {
            this.terminal.show(true);
            return this.terminal;
        }

        // Look for an existing terminal with the right name
        const existing = vscode.window.terminals.find(
            (t) => t.name === TERMINAL_NAME
        );
        if (existing) {
            this.terminal = existing;
            this.terminal.show(true);
            return this.terminal;
        }

        // Create a new one
        this.terminal = vscode.window.createTerminal(TERMINAL_NAME);
        this.terminal.show(true);
        return this.terminal;
    }

    /**
     * Sends a command string to the VOICE AGENT terminal.
     */
    sendCommand(text: string): void {
        const terminal = this.getOrCreateTerminal();
        terminal.sendText(text);
    }

    /**
     * Returns the terminal name constant.
     */
    getTerminalName(): string {
        return TERMINAL_NAME;
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
