import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

const TERMINAL_NAME = 'VOICE AGENT';

const SYSTEM_PROMPT = `You are Matthew, a friendly software engineer assistant. Your responses are read aloud by text-to-speech. Rules:
- Talk like you're chatting with a mate — natural, conversational sentences.
- NEVER use bullet points, numbered lists, dashes, or markdown formatting.
- CRITICAL: Narrate what you're doing as you go. Before each action, say a short sentence about what you're about to do. For example: "Let me read the file first" then read it, then "Alright I can see the issue, let me fix that up" then edit it, then "Done, here's what I changed". This creates a natural flow between your actions.
- Keep each narration line short — one sentence, like you're thinking out loud.
- After finishing all your work, give a brief summary of what you did.
- Speak naturally: "I'll update the background colour" not "Modified file.ts line 42".`;

export class CommandHandler {
    private terminal: vscode.Terminal | undefined;
    private writeEmitter = new vscode.EventEmitter<string>();
    private isProcessing = false;
    private activeProcess: ChildProcess | undefined;
    private conversationStarted = false;
    private disposables: vscode.Disposable[] = [];
    private streamingText = '';
    private streamThrottleTimer: ReturnType<typeof setTimeout> | undefined;
    private lastFlushedLength = 0;
    private lastToolDescription = '';

    // Buffer for streaming tool calls
    private pendingToolName: string | null = null;
    private pendingToolInput = '';

    constructor() {
        this.disposables.push(
            vscode.window.onDidCloseTerminal((closed) => {
                if (closed === this.terminal) {
                    this.terminal = undefined;
                }
            })
        );
    }

    async handleCommand(text: string, client: BridgeClient): Promise<void> {
        if (this.isProcessing) {
            const activity = this.lastToolDescription || 'working';
            client.sendResult(`Still ${activity}...`);
            return;
        }

        this.ensureTerminal();
        this.terminal?.show(false);

        this.isProcessing = true;
        this.streamingText = '';
        this.lastFlushedLength = 0;
        this.lastToolDescription = '';
        this.pendingToolName = null;
        this.pendingToolInput = '';
        this.writeEmitter.fire(`\r\n\x1b[35m🎤 You:\x1b[0m ${text}\r\n`);
        this.writeEmitter.fire(`\x1b[2m⏳ Claude is thinking...\x1b[0m\r\n\r\n`);
        client.sendStatus('Thinking...');

        // Speak a filler phrase so there's no dead air while Claude thinks
        const fillers = [
            "Alright, give me a sec to think about this.",
            "Hang tight, just working this out.",
            "Sure thing, let me have a look.",
            "One moment, just figuring this out.",
            "On it, just give me a second.",
        ];
        client.sendSpeak(fillers[Math.floor(Math.random() * fillers.length)]);

        try {
            await this.runClaude(text, client);
            this.writeEmitter.fire('\r\n');
            const finalText = this.streamingText.trim() || 'Done';
            client.sendResult(finalText);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.writeEmitter.fire(`\r\n\x1b[31m❌ Error: ${msg}\x1b[0m\r\n`);
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

            const args = ['--print', '--verbose', '--dangerously-skip-permissions', '--output-format', 'stream-json'];
            if (this.conversationStarted) {
                args.push('--continue');
            }

            this.activeProcess = spawn(claudePath, args, {
                cwd,
                shell: true,
                env: { ...process.env },
            });

            let fullResponseText = '';
            let lineBuffer = '';

            this.activeProcess.stdout?.on('data', (data: Buffer) => {
                lineBuffer += data.toString();

                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        const event = JSON.parse(trimmed);
                        // Debug: log every event type to terminal
                        const eventType = event.type || 'unknown';
                        const subtype = event.subtype || event.delta?.type || '';
                        this.writeEmitter.fire(`\x1b[2m[event: ${eventType}${subtype ? '/' + subtype : ''}]\x1b[0m\r\n`);

                        this.handleStreamEvent(event, client, (text) => {
                            fullResponseText += text;
                        });
                    } catch {
                        this.writeEmitter.fire(trimmed.replace(/\n/g, '\r\n') + '\r\n');
                    }
                }
            });

            // Parse stderr for tool calls — Claude CLI --verbose outputs tool info here
            this.activeProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                const lines = text.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    this.writeEmitter.fire(`\x1b[2m${trimmed.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);

                    // Try to detect tool calls from verbose stderr output
                    const toolMsg = this.parseStderrToolCall(trimmed);
                    if (toolMsg) {
                        this.flushAndSpeak(client);
                        this.lastToolDescription = toolMsg;
                        client.sendToolStatus(toolMsg);
                        // Speak it so the user hears what's happening
                        const spokenMsg = this.simplifyForSpeech(toolMsg);
                        if (spokenMsg) {
                            client.sendSpeak(spokenMsg);
                        }
                    }
                }
            });

            // Pipe system prompt + user prompt via stdin
            const fullPrompt = this.conversationStarted
                ? prompt
                : `${SYSTEM_PROMPT}\n\nUser: ${prompt}`;
            this.activeProcess.stdin?.write(fullPrompt);
            this.activeProcess.stdin?.end();

            this.activeProcess.on('error', (err) => {
                if (err.message.includes('ENOENT')) {
                    reject(new Error('Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code'));
                } else {
                    reject(err);
                }
            });

            this.activeProcess.on('close', (code) => {
                if (lineBuffer.trim()) {
                    try {
                        const event = JSON.parse(lineBuffer.trim());
                        this.handleStreamEvent(event, client, (text) => {
                            fullResponseText += text;
                        });
                    } catch {
                        // ignore
                    }
                }

                this.conversationStarted = true;
                if (fullResponseText.trim()) {
                    resolve(fullResponseText.trim());
                } else if (code === 0) {
                    resolve('Done.');
                } else {
                    reject(new Error(`Claude exited with code ${code}`));
                }
            });
        });
    }

    /**
     * Parse stderr lines from Claude CLI --verbose for tool call info.
     * Returns a human-friendly description, or null if not a tool line.
     */
    private parseStderrToolCall(line: string): string | null {
        // Claude CLI verbose output patterns — match common tool indicators
        // Examples: "⏵ Read(file_path: src/app.ts)", "⏵ Edit(file_path: ...)", "⏵ Bash(command: npm test)"
        // Or: "tool:Read {", "Tool: Read", etc.

        // Pattern 1: "⏵ ToolName(...)" or "▸ ToolName(...)"
        const arrowMatch = line.match(/^[⏵▸►→>]\s*(\w+)\((.+)\)/);
        if (arrowMatch) {
            return this.describeStderrTool(arrowMatch[1], arrowMatch[2]);
        }

        // Pattern 2: "⏵ ToolName" (no parens)
        const arrowSimple = line.match(/^[⏵▸►→>]\s*(\w+)\s*$/);
        if (arrowSimple) {
            return this.describeStderrTool(arrowSimple[1], '');
        }

        // Pattern 3: "Tool: Read" or "tool: Read"
        const toolPrefix = line.match(/^[Tt]ool:\s*(\w+)/);
        if (toolPrefix) {
            return this.describeStderrTool(toolPrefix[1], '');
        }

        // Pattern 4: Lines that start with known tool names
        const knownTools = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Agent', 'WebSearch', 'WebFetch'];
        for (const tool of knownTools) {
            if (line.startsWith(tool + '(') || line.startsWith(tool + ' ')) {
                return this.describeStderrTool(tool, line.slice(tool.length));
            }
        }

        // Pattern 5: Common verbose patterns like "Reading file..." or "Running command..."
        if (/^(Reading|Editing|Writing|Creating|Searching|Running|Fetching)\s/i.test(line)) {
            // Already a description — use it directly
            return line.length > 100 ? line.slice(0, 100) + '...' : line;
        }

        return null;
    }

    private describeStderrTool(toolName: string, details: string): string {
        const cleanDetails = details.replace(/^\(/, '').replace(/\)$/, '').trim();

        // Try to extract file_path from details
        const fileMatch = cleanDetails.match(/file_path:\s*["']?([^"',\)]+)/);
        const fileName = fileMatch ? path.basename(fileMatch[1].trim()) : '';
        const dirName = fileMatch ? path.basename(path.dirname(fileMatch[1].trim())) : '';
        const shortPath = fileName ? (dirName ? `${dirName}/${fileName}` : fileName) : '';

        switch (toolName) {
            case 'Read':
                return `Reading ${shortPath || 'a file'}`;
            case 'Edit': {
                let msg = `Editing ${shortPath || 'a file'}`;
                // Try to extract old_string/new_string from details
                const oldMatch = cleanDetails.match(/old_string:\s*["']([^"']{0,50})/);
                const newMatch = cleanDetails.match(/new_string:\s*["']([^"']{0,50})/);
                if (oldMatch) msg += `\n  ⊖ ${oldMatch[1]}...`;
                if (newMatch) msg += `\n  ⊕ ${newMatch[1]}...`;
                return msg;
            }
            case 'Write':
                return `Creating ${shortPath || 'a new file'}`;
            case 'Bash': {
                const cmdMatch = cleanDetails.match(/command:\s*["']?([^"']{0,80})/);
                return `Running: ${cmdMatch ? cmdMatch[1] : 'a command'}`;
            }
            case 'Glob':
                return `Searching for files`;
            case 'Grep':
                return `Searching through code`;
            case 'Agent':
                return `Running a subtask`;
            case 'WebSearch':
                return `Searching the web`;
            case 'WebFetch':
                return `Fetching a webpage`;
            case 'TodoWrite':
                return 'Planning next steps...';
            default:
                return `Using ${toolName}...`;
        }
    }

    /**
     * Simplify a tool description for speech (shorter, no code diffs)
     */
    private simplifyForSpeech(msg: string): string | null {
        // Take just the first line (remove code diff lines)
        const firstLine = msg.split('\n')[0].trim();
        if (!firstLine || firstLine.startsWith('Planning') || firstLine.startsWith('Using TodoWrite')) {
            return null;
        }
        return firstLine;
    }

    /** Send accumulated streaming text to phone */
    private flushStreamingText(client: BridgeClient): void {
        if (this.streamThrottleTimer) {
            clearTimeout(this.streamThrottleTimer);
            this.streamThrottleTimer = undefined;
        }
        if (this.streamingText.trim()) {
            client.sendStatus(this.streamingText);
        }
    }

    /** Flush text to phone, speak it with ElevenLabs, then reset */
    private flushAndSpeak(client: BridgeClient): void {
        this.flushStreamingText(client);
        const text = this.streamingText.trim();
        if (text.length > 5) {
            client.sendSpeak(text);
        }
        this.streamingText = '';
        this.lastFlushedLength = 0;
    }

    /** Flush every 80 chars OR after 150ms of quiet */
    private scheduleStreamFlush(client: BridgeClient): void {
        const newChars = this.streamingText.length - this.lastFlushedLength;
        if (newChars >= 80) {
            if (this.streamThrottleTimer) {
                clearTimeout(this.streamThrottleTimer);
                this.streamThrottleTimer = undefined;
            }
            this.lastFlushedLength = this.streamingText.length;
            client.sendStatus(this.streamingText);
            return;
        }
        if (this.streamThrottleTimer) {
            clearTimeout(this.streamThrottleTimer);
        }
        this.streamThrottleTimer = setTimeout(() => {
            this.streamThrottleTimer = undefined;
            if (this.streamingText.trim()) {
                this.lastFlushedLength = this.streamingText.length;
                client.sendStatus(this.streamingText);
            }
        }, 150);
    }

    /** Send a tool call to the phone (visual + spoken) */
    private emitToolCall(block: any, client: BridgeClient): void {
        this.flushAndSpeak(client);
        const msg = this.describeToolCall(block);
        this.lastToolDescription = msg.split('\n')[0];
        this.writeEmitter.fire(`\r\n\x1b[33m${msg}\x1b[0m\r\n`);
        client.sendToolStatus(msg);
        // Speak the tool action
        const spokenMsg = this.describeToolCallForSpeech(block);
        if (spokenMsg) {
            client.sendSpeak(spokenMsg);
        }
    }

    private handleStreamEvent(
        event: any,
        client: BridgeClient,
        onText: (text: string) => void,
    ): void {
        // ── Full assistant message (contains text + tool_use blocks) ──
        if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === 'text') {
                    onText(block.text);
                    this.streamingText += block.text;
                    this.writeEmitter.fire(`\x1b[36m${block.text.replace(/\n/g, '\r\n')}\x1b[0m`);
                    this.flushStreamingText(client);
                } else if (block.type === 'tool_use') {
                    this.emitToolCall(block, client);
                }
            }
        }
        // ── Streaming text deltas ──
        else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
                onText(event.delta.text);
                this.streamingText += event.delta.text;
                this.writeEmitter.fire(`\x1b[36m${event.delta.text.replace(/\n/g, '\r\n')}\x1b[0m`);
                this.scheduleStreamFlush(client);
            }
            else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                this.pendingToolInput += event.delta.partial_json;
            }
        }
        // ── content_block_start: tool_use begins ──
        else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            this.pendingToolName = event.content_block.name || event.content_block.tool_name || null;
            this.pendingToolInput = '';
            if (event.content_block.input && Object.keys(event.content_block.input).length > 0) {
                this.emitToolCall(event.content_block, client);
                this.pendingToolName = null;
            }
        }
        // ── content_block_stop: finalize buffered tool call ──
        else if (event.type === 'content_block_stop') {
            if (this.pendingToolName) {
                let input = {};
                try {
                    if (this.pendingToolInput.trim()) {
                        input = JSON.parse(this.pendingToolInput);
                    }
                } catch {
                    // partial JSON
                }
                this.emitToolCall({ name: this.pendingToolName, input }, client);
                this.pendingToolName = null;
                this.pendingToolInput = '';
            }
        }
        // ── Final result ──
        else if (event.type === 'result') {
            this.flushStreamingText(client);
        }
        // ── System tool_use event ──
        else if (event.type === 'system' && event.subtype === 'tool_use') {
            this.emitToolCall(event, client);
        }
        // ── Standalone tool_use event ──
        else if (event.type === 'tool_use' || event.tool_name) {
            this.emitToolCall(event, client);
        }
        // ── Tool result ──
        else if (event.type === 'tool_result') {
            const output = typeof event.output === 'string' ? event.output : JSON.stringify(event.output || '');
            const preview = output.length > 200 ? output.slice(0, 200) + '...' : output;
            this.writeEmitter.fire(`\x1b[2m   ${preview.replace(/\n/g, '\r\n   ')}\x1b[0m\r\n`);
            this.streamingText = '';
            this.lastFlushedLength = 0;
        }
    }

    /**
     * Describe tool calls for visual display on phone (with code details)
     */
    private describeToolCall(block: any): string {
        const toolName = block.name || block.tool_name || 'tool';
        const input = block.input || {};

        const filePath = input.file_path || '';
        const fileName = filePath ? path.basename(filePath) : '';
        const dirName = filePath ? path.basename(path.dirname(filePath)) : '';
        const shortPath = fileName ? (dirName ? `${dirName}/${fileName}` : fileName) : 'a file';

        switch (toolName) {
            case 'Read': {
                let msg = `Reading ${shortPath}`;
                if (input.offset) msg += ` from line ${input.offset}`;
                if (input.limit) msg += ` (${input.limit} lines)`;
                return msg;
            }
            case 'Edit': {
                let msg = `Editing ${shortPath}`;
                if (input.old_string) {
                    const oldPreview = input.old_string.trim().split('\n')[0];
                    const oldShort = oldPreview.length > 50 ? oldPreview.slice(0, 50) + '...' : oldPreview;
                    msg += `\n  ⊖ ${oldShort}`;
                }
                if (input.new_string) {
                    const newPreview = input.new_string.trim().split('\n')[0];
                    const newShort = newPreview.length > 50 ? newPreview.slice(0, 50) + '...' : newPreview;
                    msg += `\n  ⊕ ${newShort}`;
                }
                return msg;
            }
            case 'Write':
                return `Creating ${shortPath}`;
            case 'Bash': {
                const cmd = (input.command || '').trim();
                const short = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
                return `Running: ${short}`;
            }
            case 'Glob':
                return `Searching for files matching ${input.pattern || 'a pattern'}`;
            case 'Grep':
                return `Searching code for "${input.pattern || 'something'}"`;
            case 'TodoWrite':
                return 'Planning next steps...';
            case 'TodoRead':
                return 'Checking task list...';
            case 'ToolSearch':
                return 'Looking up available tools...';
            case 'Agent':
                return `Running a subtask: ${input.description || input.prompt?.slice(0, 60) || 'working...'}`;
            case 'WebSearch':
                return `Searching the web for "${input.query || 'something'}"`;
            case 'WebFetch':
                return `Fetching ${input.url || 'a webpage'}`;
            case 'NotebookEdit':
                return `Editing notebook ${shortPath}`;
            default:
                return `Using ${toolName}...`;
        }
    }

    /**
     * Short spoken version (no code, just what's happening)
     */
    private describeToolCallForSpeech(block: any): string | null {
        const toolName = block.name || block.tool_name || 'tool';
        const input = block.input || {};
        const filePath = input.file_path || '';
        const fileName = filePath ? path.basename(filePath) : '';

        switch (toolName) {
            case 'Read':
                return fileName ? `Reading ${fileName}` : 'Reading a file';
            case 'Edit':
                return fileName ? `Editing ${fileName}` : 'Making an edit';
            case 'Write':
                return fileName ? `Creating ${fileName}` : 'Creating a new file';
            case 'Bash':
                return 'Running a command';
            case 'Glob':
                return 'Searching for files';
            case 'Grep':
                return 'Searching through the code';
            case 'Agent':
                return 'Working on a subtask';
            case 'WebSearch':
                return 'Searching the web';
            case 'WebFetch':
                return 'Fetching a webpage';
            default:
                return null;
        }
    }

    private ensureTerminal(): void {
        if (this.terminal) return;

        const pty: vscode.Pseudoterminal = {
            onDidWrite: this.writeEmitter.event,
            open: () => {
                this.writeEmitter.fire('\x1b[36mMatthews Terminal — Voice Agent\x1b[0m\r\n');
                this.writeEmitter.fire('\x1b[2mSpeak from your phone to send commands to Claude.\x1b[0m\r\n');
            },
            close: () => {
                this.activeProcess?.kill();
            },
        };

        this.terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, pty });
    }

    dispose(): void {
        this.activeProcess?.kill();
        this.terminal?.dispose();
        this.writeEmitter.dispose();
        for (const d of this.disposables) d.dispose();
    }
}
