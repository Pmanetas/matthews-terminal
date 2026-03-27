import * as vscode from 'vscode';
import * as path from 'path';
import { BridgeClient, ConnectionState } from './bridge-client';

let bridgeClient: BridgeClient | undefined;
let statusBarItem: vscode.StatusBarItem;

function getShortPath(uri: vscode.Uri): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        const rel = path.relative(folders[0].uri.fsPath, uri.fsPath);
        return rel || path.basename(uri.fsPath);
    }
    return path.basename(uri.fsPath);
}

export function activate(context: vscode.ExtensionContext): void {
    console.log('[Matthews Terminal] Extension v0.4.0 activated');
    // Create status bar item (bottom left, high priority to appear leftward)
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    updateStatusBar('disconnected');
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Create bridge client with state-change callback
    bridgeClient = new BridgeClient((state: ConnectionState) => {
        updateStatusBar(state);
    });

    // Register connect command
    context.subscriptions.push(
        vscode.commands.registerCommand('matthewsTerminal.connect', () => {
            bridgeClient?.connect();
        })
    );

    // Register disconnect command
    context.subscriptions.push(
        vscode.commands.registerCommand('matthewsTerminal.disconnect', () => {
            bridgeClient?.disconnect();
            vscode.window.showInformationMessage('Matthews Terminal: Disconnected from voice bridge');
        })
    );

    // Track active file and send to bridge
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                bridgeClient?.sendActiveFile(getShortPath(editor.document.uri));
            } else {
                bridgeClient?.sendActiveFile(null);
            }
        })
    );

    // Send initial active file when connecting
    if (vscode.window.activeTextEditor) {
        setTimeout(() => {
            if (vscode.window.activeTextEditor) {
                bridgeClient?.sendActiveFile(getShortPath(vscode.window.activeTextEditor.document.uri));
            }
        }, 2000);
    }

    // No auto-connect — user picks which window to use via the command
}

function updateStatusBar(state: ConnectionState): void {
    switch (state) {
        case 'connected':
            statusBarItem.text = '$(plug) Matthews: Connected';
            statusBarItem.tooltip = 'Matthews Terminal - Connected to voice bridge';
            statusBarItem.command = 'matthewsTerminal.disconnect';
            break;
        case 'connecting':
            statusBarItem.text = '$(sync~spin) Matthews: Connecting...';
            statusBarItem.tooltip = 'Matthews Terminal - Connecting to voice bridge...';
            statusBarItem.command = 'matthewsTerminal.connect';
            break;
        case 'disconnected':
            statusBarItem.text = '$(debug-disconnect) Matthews: Disconnected';
            statusBarItem.tooltip = 'Matthews Terminal - Click to connect';
            statusBarItem.command = 'matthewsTerminal.connect';
            break;
    }
}

export function deactivate(): void {
    bridgeClient?.dispose();
    bridgeClient = undefined;
}
