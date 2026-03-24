import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { spawn, ChildProcess } from 'child_process';

const TERMINAL_NAME = 'VOICE AGENT';

export class CommandHandler {
    private claudeProcess: ChildProcess | undefined;
    private terminal: vscode.Terminal | undefined;
    private writeEmitter = new vscode.EventEmitter<string>();
    private client: BridgeClient | undefined;
    private currentResponse = '';
    private responseTimer: ReturnType<typeof setTimeout> | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            vscode.window.onDidCloseTerminal((closed) => {
                if (closed === this.terminal) {
                    this.terminal = undefined;
                    this.claudeProcess?.kill();
                    this.claudeProcess = undefined;
                }
            })
        );
    }

    async handleCommand(text: string, client: BridgeClient): Promise<void> {
        this.client = client;

        // Start Claude process if not running
        if (!this.claudeProcess || this.claudeProcess.killed) {
            this.startClaude();
        }

        // Show the terminal
        this.terminal?.show(true);

        // Display what the user said
        this.writeEmitter.fire(`\r\n\x1b[35m🎤 You:\x1b[0m ${text}\r\n\r\n`);
        client.sendStatus('Thinking...');

        // Reset response tracking
        this.currentResponse = '';
        if (this.responseTimer) clearTimeout(this.responseTimer);

        // Send the text to Claude's stdin
        if (this.claudeProcess?.stdin?.writable) {
            this.claudeProcess.stdin.write(text + '\n');
        } else {
            client.sendResult('Error: Claude process not ready. Try again.');
        }
    }

    private startClaude(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        const claudePath = process.platform === 'win32'
            ? `${process.env.APPDATA}\\npm\\claude.cmd`
            : 'claude';

        // Spawn claude in interactive mode with dangerously-skip-permissions
        this.claudeProcess = spawn(claudePath, ['--dangerously-skip-permissions'], {
            cwd,
            shell: true,
            env: { ...process.env, FORCE_COLOR: '0' },
        });

        // Create a pseudoterminal that shows Claude's output in VS Code
        const writeEmitter = this.writeEmitter;

        const pty: vscode.Pseudoterminal = {
            onDidWrite: writeEmitter.event,
            open: () => {
                writeEmitter.fire('\x1b[36mMatthews Terminal — Voice Agent\x1b[0m\r\n');
                writeEmitter.fire('Speak from your phone to send commands to Claude.\r\n\r\n');
            },
            close: () => {
                this.claudeProcess?.kill();
                this.claudeProcess = undefined;
            },
            handleInput: (data: string) => {
                // Allow typing directly in the terminal too
                if (data === '\r') {
                    // Enter key — handled by Claude's stdin
                } else if (this.claudeProcess?.stdin?.writable) {
                    this.claudeProcess.stdin.write(data);
                    writeEmitter.fire(data);
                }
            },
        };

        // Close existing terminal
        if (this.terminal) {
            this.terminal.dispose();
        }

        this.terminal = vscode.window.createTerminal({
            name: TERMINAL_NAME,
            pty,
        });
        this.terminal.show(true);

        // Capture stdout — display in terminal AND send to phone
        this.claudeProcess.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            // Show in VS Code terminal (convert \n to \r\n for terminal)
            writeEmitter.fire(text.replace(/\n/g, '\r\n'));

            // Accumulate response for phone
            this.currentResponse += text;

            // Send streaming update to phone
            this.client?.sendStatus(this.cleanAnsi(this.currentResponse));

            // After Claude stops outputting for 1.5s, treat it as the final response
            if (this.responseTimer) clearTimeout(this.responseTimer);
            this.responseTimer = setTimeout(() => {
                if (this.currentResponse.trim()) {
                    this.client?.sendResult(this.cleanAnsi(this.currentResponse.trim()));
                    this.currentResponse = '';
                }
            }, 1500);
        });

        this.claudeProcess.stderr?.on('data', (data: Buffer) => {
            const err = data.toString();
            writeEmitter.fire(`\x1b[31m${err.replace(/\n/g, '\r\n')}\x1b[0m`);
        });

        this.claudeProcess.on('error', (err) => {
            writeEmitter.fire(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n`);
            this.client?.sendResult(`Error: ${err.message}`);
        });

        this.claudeProcess.on('close', (code) => {
            writeEmitter.fire(`\r\n\x1b[33mClaude exited (code ${code})\x1b[0m\r\n`);
        });
    }

    // Strip ANSI escape codes for clean text on phone
    private cleanAnsi(text: string): string {
        return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
    }

    dispose(): void {
        if (this.responseTimer) clearTimeout(this.responseTimer);
        this.claudeProcess?.kill();
        this.terminal?.dispose();
        this.writeEmitter.dispose();
        for (const d of this.disposables) d.dispose();
    }
}
