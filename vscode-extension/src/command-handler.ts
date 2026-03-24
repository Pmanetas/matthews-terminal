import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { TerminalManager } from './terminal-manager';

export class CommandHandler {
    private terminalManager: TerminalManager;

    constructor() {
        this.terminalManager = new TerminalManager();
    }

    /**
     * Routes an incoming command string to the appropriate action.
     */
    async handleCommand(text: string, client: BridgeClient): Promise<void> {
        const trimmed = text.trim().toLowerCase();

        try {
            if (trimmed.startsWith('open ')) {
                await this.handleOpen(text.trim().substring(5), client);
            } else if (trimmed === 'current file' || trimmed === 'what file') {
                this.handleCurrentFile(client);
            } else if (trimmed === 'status' || trimmed === "what's happening") {
                this.handleStatus(client);
            } else {
                this.handleTerminalCommand(text.trim(), client);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            client.sendResult(`Error: ${msg}`);
        }
    }

    /**
     * Opens a file by path in the editor.
     */
    private async handleOpen(filePath: string, client: BridgeClient): Promise<void> {
        client.sendStatus(`Opening ${filePath}...`);

        // Try to resolve the path relative to the workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let uri: vscode.Uri;

        if (filePath.match(/^[a-zA-Z]:\\/) || filePath.startsWith('/')) {
            // Absolute path
            uri = vscode.Uri.file(filePath);
        } else if (workspaceFolders && workspaceFolders.length > 0) {
            // Relative to workspace root
            uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
        } else {
            client.sendResult(`Cannot resolve relative path: no workspace folder open.`);
            return;
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        client.sendResult(`Opened ${filePath}`);
    }

    /**
     * Reports the currently active file.
     */
    private handleCurrentFile(client: BridgeClient): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const name = editor.document.fileName;
            client.sendResult(`Current file: ${name}`);
        } else {
            client.sendResult('No file is currently open.');
        }
    }

    /**
     * Reports current workspace status.
     */
    private handleStatus(client: BridgeClient): void {
        const editor = vscode.window.activeTextEditor;
        const folders = vscode.workspace.workspaceFolders;
        const parts: string[] = [];

        if (folders && folders.length > 0) {
            parts.push(`Workspace: ${folders[0].name}`);
        } else {
            parts.push('No workspace open');
        }

        if (editor) {
            parts.push(`Active file: ${editor.document.fileName}`);
            parts.push(`Language: ${editor.document.languageId}`);
            parts.push(`Line ${editor.selection.active.line + 1}, Col ${editor.selection.active.character + 1}`);
        } else {
            parts.push('No active editor');
        }

        parts.push(`Open terminals: ${vscode.window.terminals.length}`);

        client.sendResult(parts.join(' | '));
    }

    /**
     * Sends an unrecognized command to the VOICE AGENT terminal.
     * v1 limitation: we cannot read terminal output, so we just acknowledge the send.
     */
    private handleTerminalCommand(text: string, client: BridgeClient): void {
        client.sendStatus(`Sending to terminal: ${text}`);
        this.terminalManager.sendCommand(text);
        client.sendResult(`Command sent to terminal: ${text}`);
    }

    dispose(): void {
        this.terminalManager.dispose();
    }
}
