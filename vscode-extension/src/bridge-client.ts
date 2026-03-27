import * as vscode from 'vscode';
import WebSocket from 'ws';
import { CommandHandler } from './command-handler';

// Default to local. Set via VS Code setting or env var to point to Render.
function getBridgeUrl(): string {
    const config = vscode.workspace.getConfiguration('matthewsTerminal');
    return config.get<string>('bridgeUrl') || process.env.MT_BRIDGE_URL || 'wss://matthews-terminal.onrender.com';
}

const RECONNECT_INTERVAL = 5000;

export type ConnectionState = 'connected' | 'disconnected' | 'connecting';

export class BridgeClient {
    private ws: WebSocket | undefined;
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private commandHandler: CommandHandler;
    private shouldReconnect = false;
    private _state: ConnectionState = 'disconnected';
    private onStateChange: (state: ConnectionState) => void;

    constructor(onStateChange: (state: ConnectionState) => void) {
        this.commandHandler = new CommandHandler();
        this.onStateChange = onStateChange;
    }

    get state(): ConnectionState {
        return this._state;
    }

    private setState(state: ConnectionState): void {
        this._state = state;
        this.onStateChange(state);
    }

    /**
     * Opens the WebSocket connection to the voice bridge server.
     */
    connect(): void {
        if (this.ws) {
            this.disconnect();
        }

        this.shouldReconnect = true;
        this.setState('connecting');
        this.doConnect();
    }

    private doConnect(): void {
        try {
            this.ws = new WebSocket(getBridgeUrl());

            this.ws.on('open', () => {
                this.setState('connected');
                vscode.window.showInformationMessage('Matthews Terminal: Connected to voice bridge');

                // Identify ourselves
                this.send({ type: 'identify', client: 'extension' });

                // Send workspace info
                const folders = vscode.workspace.workspaceFolders;
                const workspace = folders && folders.length > 0 ? folders[0].name : undefined;
                const repo = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
                this.send({ type: 'workspace', data: { workspace, repo } });
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });

            this.ws.on('close', () => {
                this.ws = undefined;
                this.setState('disconnected');
                this.scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                // Suppress noisy connection-refused errors during reconnect
                if (this._state === 'connecting') {
                    // Expected when bridge isn't running yet — stay quiet
                } else {
                    console.error('[Matthews Terminal] WebSocket error:', err.message);
                }
                // The 'close' event will fire after this, triggering reconnect
            });
        } catch (err) {
            this.setState('disconnected');
            this.scheduleReconnect();
        }
    }

    /**
     * Cleanly closes the connection and stops reconnecting.
     */
    disconnect(): void {
        this.shouldReconnect = false;
        this.clearReconnectTimer();

        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = undefined;
        }

        this.setState('disconnected');
    }

    /**
     * Sends a text-streaming status message back to the bridge.
     */
    sendStatus(text: string): void {
        this.send({ type: 'status', text });
    }

    /**
     * Sends a tool-call status (shows as a separate step on phone).
     */
    sendToolStatus(text: string): void {
        this.send({ type: 'tool_status', text });
    }

    /**
     * Sends text to be spoken via TTS immediately (intermediate speech).
     */
    sendSpeak(text: string): void {
        this.send({ type: 'speak', text });
    }

    /**
     * Sends a result message back to the bridge.
     */
    sendResult(text: string): void {
        this.send({ type: 'result', text });
    }

    /**
     * Signals a new conversation session — bridge clears history, phone clears messages.
     */
    sendNewSession(): void {
        this.send({ type: 'new_session' });
    }

    /**
     * Sends the currently active file to the bridge.
     */
    sendActiveFile(file: string | null): void {
        this.send({ type: 'active_file', file });
    }

    private send(payload: Record<string, unknown>): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    private handleMessage(raw: string): void {
        try {
            const msg = JSON.parse(raw);
            if (msg.type === 'command' && typeof msg.text === 'string') {
                this.commandHandler.handleCommand(msg.text, this, msg.images);
            } else if (msg.type === 'stop') {
                this.commandHandler.abortCommand(this);
            }
        } catch {
            console.error('[Matthews Terminal] Failed to parse message:', raw);
        }
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) {
            return;
        }
        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            if (this.shouldReconnect) {
                this.setState('connecting');
                this.doConnect();
            }
        }, RECONNECT_INTERVAL);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    dispose(): void {
        this.disconnect();
        this.commandHandler.dispose();
    }
}
