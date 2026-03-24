import * as vscode from 'vscode';
import { BridgeClient, ConnectionState } from './bridge-client';

let bridgeClient: BridgeClient | undefined;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
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

    // Auto-connect on activation
    bridgeClient.connect();
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
