import * as vscode from 'vscode';
import { BridgeClient } from './bridge-client';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface ImageData {
    data: string;       // base64
    mimeType: string;
    name?: string;
}

const TERMINAL_NAME = 'VOICE AGENT';

const SYSTEM_PROMPT = `You are Matthew, a friendly software engineer assistant. Your responses are read aloud by text-to-speech. Rules:
- Talk like you're chatting with a mate — natural, conversational sentences.
- NEVER use bullet points, numbered lists, dashes, or markdown formatting.
- CRITICAL: Keep your final summary SHORT — 2 to 3 sentences max, all in ONE paragraph. No line breaks between sentences. Just one flowing block of text.
- CRITICAL: Narrate what you're doing as you go. Before each action, say a short sentence about what you're about to do. For example: "Let me read the file first" then read it, then "Alright I can see the issue, let me fix that up" then edit it, then "Done, here's what I changed". This creates a natural flow between your actions.
- Keep each narration line short — one sentence, like you're thinking out loud.
- After finishing, give a brief 2-3 sentence summary in one paragraph. Don't repeat what you narrated. Just say what the end result is.
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

    // Batch tool call speech — don't speak every tool individually
    private toolSpeechQueue: string[] = [];
    private toolSpeechTimer: ReturnType<typeof setTimeout> | undefined;

    // Only speak one brief update per command when tools start
    private hasSpokenToolUpdate = false;
    private toolCallCount = 0;
    // Skip speech until first tool call (so Claude's initial "Let me look..." isn't spoken)
    private hasSeenFirstTool = false;
    // Abort flag — prevents result from being sent after stop
    private aborted = false;

    constructor() {
        this.disposables.push(
            vscode.window.onDidCloseTerminal((closed) => {
                if (closed === this.terminal) {
                    this.terminal = undefined;
                }
            })
        );
    }

    /** Abort the current command — kills the Claude process tree */
    abortCommand(client: BridgeClient): void {
        if (!this.isProcessing || !this.activeProcess) {
            return;
        }
        console.log('[CommandHandler] Aborting active command');
        this.aborted = true;
        const pid = this.activeProcess.pid;
        if (pid) {
            if (process.platform === 'win32') {
                // Windows: SIGTERM doesn't work, must use taskkill to kill process tree
                spawn('taskkill', ['/F', '/T', '/PID', pid.toString()], { shell: true });
            } else {
                this.activeProcess.kill('SIGTERM');
            }
        }
        this.activeProcess = undefined;
        this.isProcessing = false;
        this.streamingText = '';
        this.lastFlushedLength = 0;
        this.writeEmitter.fire('\r\n\x1b[33m⛔ Stopped\x1b[0m\r\n');
        // Notify phone immediately so it stops the spinner
        client.sendResult('Stopped.');
    }

    async handleCommand(text: string, client: BridgeClient, images?: ImageData[]): Promise<void> {
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
        this.toolSpeechQueue = [];
        this.hasSpokenToolUpdate = false;
        this.toolCallCount = 0;
        this.hasSeenFirstTool = false;
        this.aborted = false;
        // Signal new session on first command (clears phone history)
        if (!this.conversationStarted) {
            client.sendNewSession();
        }

        this.writeEmitter.fire(`\r\n\x1b[35m🎤 You:\x1b[0m ${text}${images?.length ? ` [+${images.length} image(s)]` : ''}\r\n`);
        this.writeEmitter.fire(`\x1b[2m⏳ Claude is thinking...\x1b[0m\r\n\r\n`);
        client.sendStatus('Thinking...');

        // Save images to temp files so Claude can Read them
        const imageFiles: string[] = [];
        if (images && images.length > 0) {
            const tmpDir = path.join(os.tmpdir(), 'matthews-terminal-images');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            for (const img of images) {
                const ext = img.mimeType.includes('png') ? '.png' : '.jpg';
                const filename = `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`;
                const filepath = path.join(tmpDir, filename);
                fs.writeFileSync(filepath, Buffer.from(img.data, 'base64'));
                imageFiles.push(filepath);
                console.log(`[CommandHandler] Saved image to ${filepath}`);
            }
        }

        try {
            await this.runClaude(text, client, imageFiles);
            if (this.aborted) {
                console.log('[CommandHandler] Command was aborted, skipping result');
            } else {
                this.writeEmitter.fire('\r\n');
                const finalText = this.streamingText.trim() || 'Done';
                console.log(`[CommandHandler] Sending RESULT: "${finalText.slice(0, 100)}..."`);
                client.sendResult(finalText);
            }
        } catch (err: unknown) {
            if (this.aborted) {
                console.log('[CommandHandler] Command was aborted (error path), skipping result');
            } else {
                const msg = err instanceof Error ? err.message : String(err);
                this.writeEmitter.fire(`\r\n\x1b[31m❌ Error: ${msg}\x1b[0m\r\n`);
                client.sendResult(`Error: ${msg}`);
            }
        } finally {
            this.isProcessing = false;
            this.activeProcess = undefined;
            if (this.toolSpeechTimer) {
                clearTimeout(this.toolSpeechTimer);
                this.toolSpeechTimer = undefined;
            }
            // Clean up temp image files
            for (const f of imageFiles) {
                try { fs.unlinkSync(f); } catch {}
            }
        }
    }

    private runClaude(prompt: string, client: BridgeClient, imageFiles: string[] = []): Promise<string> {
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
                const stderrLines = text.split('\n');
                for (const line of stderrLines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    this.writeEmitter.fire(`\x1b[2m${trimmed.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);

                    const toolMsg = this.parseStderrToolCall(trimmed);
                    if (toolMsg) {
                        this.flushAndSpeak(client);
                        this.hasSeenFirstTool = true;
                        this.lastToolDescription = toolMsg.split('\n')[0];
                        client.sendToolStatus(toolMsg);
                        this.toolCallCount++;
                    }
                }
            });

            let imageInstructions = '';
            if (imageFiles.length > 0) {
                imageInstructions = imageFiles.map(f =>
                    `\n\n[The user attached an image. Use the Read tool to view it at: ${f}]`
                ).join('');
            }

            const fullPrompt = this.conversationStarted
                ? prompt + imageInstructions
                : `${SYSTEM_PROMPT}\n\nUser: ${prompt}${imageInstructions}`;
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
     * Queue tool descriptions for batched speech.
     * If multiple tools fire within 2s, combine them into one spoken summary.
     */
    private queueToolSpeech(description: string, client: BridgeClient): void {
        this.toolSpeechQueue.push(description);

        if (this.toolSpeechTimer) {
            clearTimeout(this.toolSpeechTimer);
        }

        // Wait 2s for more tools, then speak a summary
        this.toolSpeechTimer = setTimeout(() => {
            this.toolSpeechTimer = undefined;
            const queue = this.toolSpeechQueue;
            this.toolSpeechQueue = [];

            if (queue.length === 0) return;

            let speech: string;
            if (queue.length === 1) {
                speech = queue[0];
            } else if (queue.length <= 3) {
                // "Reading the file, then editing it, then running a command"
                speech = queue.join(', then ');
            } else {
                // "Did a few things — read some files, made 3 edits, and ran a command"
                const summary = this.summarizeToolBatch(queue);
                speech = summary;
            }

            client.sendSpeak(speech);
        }, 2000);
    }

    /**
     * Summarize a batch of tool calls into natural speech
     */
    private summarizeToolBatch(tools: string[]): string {
        const counts: Record<string, number> = {};
        for (const t of tools) {
            const action = t.split(' ')[0].toLowerCase(); // "reading", "editing", etc.
            counts[action] = (counts[action] || 0) + 1;
        }

        const parts: string[] = [];
        for (const [action, count] of Object.entries(counts)) {
            if (count === 1) {
                parts.push(`${action} a file`);
            } else {
                parts.push(`${action} ${count} files`);
            }
        }

        if (parts.length === 1) {
            return `Just ${parts[0]}`;
        }
        const last = parts.pop();
        return `Just ${parts.join(', ')} and ${last}`;
    }

    /**
     * Parse stderr lines from Claude CLI --verbose for tool call info.
     */
    private parseStderrToolCall(line: string): string | null {
        // Pattern: "⏵ ToolName(...)" or "▸ ToolName(...)"
        const arrowMatch = line.match(/^[⏵▸►→>]\s*(\w+)\((.+)\)/);
        if (arrowMatch) {
            return this.describeStderrTool(arrowMatch[1], arrowMatch[2]);
        }

        // Pattern: "⏵ ToolName"
        const arrowSimple = line.match(/^[⏵▸►→>]\s*(\w+)\s*$/);
        if (arrowSimple) {
            return this.describeStderrTool(arrowSimple[1], '');
        }

        // Pattern: "Tool: Read"
        const toolPrefix = line.match(/^[Tt]ool:\s*(\w+)/);
        if (toolPrefix) {
            return this.describeStderrTool(toolPrefix[1], '');
        }

        // Lines starting with known tool names
        const knownTools = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Agent', 'WebSearch', 'WebFetch'];
        for (const tool of knownTools) {
            if (line.startsWith(tool + '(') || line.startsWith(tool + ' ')) {
                return this.describeStderrTool(tool, line.slice(tool.length));
            }
        }

        // Verbose patterns like "Reading file..."
        if (/^(Reading|Editing|Writing|Creating|Searching|Running|Fetching)\s/i.test(line)) {
            return line.length > 100 ? line.slice(0, 100) + '...' : line;
        }

        return null;
    }

    private describeStderrTool(toolName: string, details: string): string {
        const cleanDetails = details.replace(/^\(/, '').replace(/\)$/, '').trim();

        const fileMatch = cleanDetails.match(/file_path:\s*["']?([^"',\)]+)/);
        const fileName = fileMatch ? path.basename(fileMatch[1].trim()) : '';
        const dirName = fileMatch ? path.basename(path.dirname(fileMatch[1].trim())) : '';
        const shortPath = fileName ? (dirName ? `${dirName}/${fileName}` : fileName) : '';

        switch (toolName) {
            case 'Read':
                return `Reading ${shortPath || 'a file'}`;
            case 'Edit': {
                let msg = `Editing ${shortPath || 'a file'}`;
                const oldMatch = cleanDetails.match(/old_string:\s*["']([^"']{0,120})/);
                const newMatch = cleanDetails.match(/new_string:\s*["']([^"']{0,120})/);
                if (oldMatch) msg += `\n  ⊖ ${oldMatch[1]}`;
                if (newMatch) msg += `\n  ⊕ ${newMatch[1]}`;
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
                return `Using ${toolName}`;
        }
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

    /** Flush text to phone, display + speak it (only after first tool call), then reset */
    private flushAndSpeak(client: BridgeClient): void {
        this.flushStreamingText(client);
        const text = this.streamingText.trim();
        if (text.length > 5) {
            if (this.hasSeenFirstTool) {
                console.log(`[CommandHandler] Narration: "${text.slice(0, 80)}..."`);
                // Send as tool_status with marker — works with existing bridge (no deploy needed)
                client.sendToolStatus(`💬 ${text}`);
                client.sendSpeak(text);
            } else {
                console.log(`[CommandHandler] SKIPPED speech (before first tool): "${text.slice(0, 80)}..."`);
            }
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

    /** Send a tool call to the phone */
    private emitToolCall(block: any, client: BridgeClient): void {
        const hadNarration = this.streamingText.trim().length > 5;
        this.flushAndSpeak(client);
        this.hasSeenFirstTool = true;
        const toolName = block.name || block.tool_name || '';
        const input = block.input || {};
        const msg = this.describeToolCall(block);
        this.lastToolDescription = msg.split('\n')[0];
        this.writeEmitter.fire(`\r\n\x1b[33m${msg}\x1b[0m\r\n`);
        client.sendToolStatus(msg);
        this.toolCallCount++;

        // If no narration preceded this tool and it's not the first, queue brief speech
        if (!hadNarration && this.toolCallCount > 1) {
            this.queueToolSpeech(this.lastToolDescription, client);
        }

        // For Read tool: read the actual file and send content preview
        if (toolName === 'Read' && input.file_path) {
            // Skip Claude CLI internal temp files like "tool-results/xxx.txt"
            if (input.file_path.includes('tool-results/') || input.file_path.includes('tool-results\\')) {
                return;
            }
            try {
                // Try absolute path first, then resolve relative to workspace
                let filePath = input.file_path;
                if (!path.isAbsolute(filePath)) {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();
                    filePath = path.join(cwd, filePath);
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                const allLines = content.split('\n');
                const offset = input.offset ? parseInt(input.offset) - 1 : 0;
                const limit = input.limit ? parseInt(input.limit) : 40;
                const lines = allLines.slice(offset, offset + limit);
                let preview = msg;
                lines.forEach((line: string, i: number) => {
                    const lineNum = offset + i + 1;
                    preview += `\n  ${String(lineNum).padStart(4)} │ ${line}`;
                });
                if (allLines.length > offset + limit) {
                    preview += `\n  ... (${allLines.length - offset - limit} more lines)`;
                }
                client.sendToolStatus(preview);
            } catch {
                // File not accessible, just show basic status
            }
        }
    }

    /**
     * Extract a tool name from any event structure — searches nested fields
     */
    private findToolInEvent(event: any): { name: string; input: any } | null {
        // Direct tool_use event
        if (event.tool_name || (event.type === 'tool_use' && event.name)) {
            return { name: event.tool_name || event.name, input: event.input || {} };
        }
        // content_block wrapper
        if (event.content_block?.type === 'tool_use') {
            return { name: event.content_block.name || event.content_block.tool_name, input: event.content_block.input || {} };
        }
        // message.content array
        if (event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === 'tool_use') {
                    return { name: block.name || block.tool_name, input: block.input || {} };
                }
            }
        }
        // subtype pattern
        if (event.subtype === 'tool_use' || event.subtype === 'tool') {
            return { name: event.name || event.tool_name || event.tool || 'tool', input: event.input || {} };
        }
        return null;
    }

    private handleStreamEvent(
        event: any,
        client: BridgeClient,
        onText: (text: string) => void,
    ): void {
        // Don't process events after abort
        if (this.aborted) return;

        // Log event type only (not full JSON) for cleaner terminal
        if (event.type !== 'assistant' && event.type !== 'user' && event.type !== 'rate_limit_event') {
            this.writeEmitter.fire(`\x1b[2m[${event.type}${event.subtype ? ':' + event.subtype : ''}]\x1b[0m\r\n`);
        }

        // ── Assistant message (each content block comes as a separate event) ──
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
                // Skip thinking blocks silently
            }
            return;
        }

        // ── Tool results (come as "user" events in stream-json) ──────
        if (event.type === 'user' && event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === 'tool_result') {
                    const output = typeof block.content === 'string' ? block.content : '';
                    if (output) {
                        const preview = output.length > 200 ? output.slice(0, 200) + '...' : output;
                        this.writeEmitter.fire(`\x1b[2m   ${preview.replace(/\n/g, '\r\n   ')}\x1b[0m\r\n`);
                    }
                    this.streamingText = '';
                    this.lastFlushedLength = 0;
                }
            }
            return;
        }

        // ── Streaming text deltas ───────────────────────────────
        if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
                onText(event.delta.text);
                this.streamingText += event.delta.text;
                this.writeEmitter.fire(`\x1b[36m${event.delta.text.replace(/\n/g, '\r\n')}\x1b[0m`);
                this.scheduleStreamFlush(client);
            }
            else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                this.pendingToolInput += event.delta.partial_json;
            }
            return;
        }

        // ── Tool call start (streaming) ─────────────────────────
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            this.pendingToolName = event.content_block.name || event.content_block.tool_name || null;
            this.pendingToolInput = '';
            if (event.content_block.input && Object.keys(event.content_block.input).length > 0) {
                this.emitToolCall(event.content_block, client);
                this.pendingToolName = null;
            } else if (this.pendingToolName) {
                this.flushAndSpeak(client);
                const preliminary = this.describeToolCall({ name: this.pendingToolName, input: {} });
                this.lastToolDescription = preliminary;
                client.sendToolStatus(preliminary);
                this.writeEmitter.fire(`\r\n\x1b[33m${preliminary}\x1b[0m`);
                this.toolCallCount++;
            }
            return;
        }

        // ── Tool call end (streaming) ───────────────────────────
        if (event.type === 'content_block_stop') {
            if (this.pendingToolName) {
                let input = {};
                try {
                    if (this.pendingToolInput.trim()) {
                        input = JSON.parse(this.pendingToolInput);
                    }
                } catch { /* partial JSON */ }
                // Use emitToolCall for the full detailed output (file content, diffs, etc.)
                this.emitToolCall({ name: this.pendingToolName, input }, client);
                this.pendingToolName = null;
                this.pendingToolInput = '';
            }
            return;
        }

        // ── Result ──────────────────────────────────────────────
        if (event.type === 'result') {
            this.flushStreamingText(client);
            // If streamingText is empty (all text was spoken as narration),
            // use the result text as fallback so we don't just say "Done"
            if (!this.streamingText.trim() && event.result) {
                this.streamingText = event.result;
            }
            return;
        }

        // ── Tool result (try multiple field names) ────────────────
        const toolOutput = event.output || event.content || event.result_text || event.data;
        if (event.type === 'tool_result' || (event.type === 'result' && event.subtype === 'tool_result') || (toolOutput && event.tool_use_id)) {
            const output = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput || '');
            const preview = output.length > 200 ? output.slice(0, 200) + '...' : output;
            this.writeEmitter.fire(`\x1b[2m   ${preview.replace(/\n/g, '\r\n   ')}\x1b[0m\r\n`);
            console.log(`[CommandHandler] Tool result for "${this.lastToolDescription}": ${output.length} chars`);

            // Send file content preview to phone for Read results
            if (this.lastToolDescription.startsWith('Reading') && output.length > 0) {
                const lines = output.split('\n').slice(0, 20);
                let contentPreview = this.lastToolDescription;
                for (const line of lines) {
                    contentPreview += `\n  ${line}`;
                }
                if (output.split('\n').length > 20) {
                    contentPreview += `\n  ... (${output.split('\n').length - 20} more lines)`;
                }
                client.sendToolStatus(contentPreview);
            }

            this.streamingText = '';
            this.lastFlushedLength = 0;
            return;
        }

        // ── Catch-all: try to find tool calls in any event ──────
        const tool = this.findToolInEvent(event);
        if (tool && tool.name) {
            this.emitToolCall(tool, client);
            return;
        }

        // ── Text in other event formats ─────────────────────────
        const text = event.text || event.content || event.delta?.text;
        if (typeof text === 'string' && text.length > 0) {
            onText(text);
            this.streamingText += text;
            this.writeEmitter.fire(`\x1b[36m${text.replace(/\n/g, '\r\n')}\x1b[0m`);
            this.scheduleStreamFlush(client);
        }
    }

    private describeToolCall(block: any): string {
        const toolName = block.name || block.tool_name || 'tool';
        const input = block.input || {};

        const filePath = input.file_path || '';
        const fileName = filePath ? path.basename(filePath) : '';
        const dirName = filePath ? path.basename(path.dirname(filePath)) : '';
        const shortPath = fileName ? (dirName ? `${dirName}/${fileName}` : fileName) : 'a file';

        switch (toolName) {
            case 'Read':
                return `Reading ${shortPath}`;
            case 'Edit': {
                let msg = `Editing ${shortPath}`;
                if (input.old_string) {
                    const oldLines = input.old_string.trim().split('\n');
                    for (const line of oldLines.slice(0, 8)) {
                        msg += `\n  ⊖ ${line}`;
                    }
                    if (oldLines.length > 8) msg += `\n  ⊖ ... (${oldLines.length - 8} more lines)`;
                }
                if (input.new_string) {
                    const newLines = input.new_string.trim().split('\n');
                    for (const line of newLines.slice(0, 8)) {
                        msg += `\n  ⊕ ${line}`;
                    }
                    if (newLines.length > 8) msg += `\n  ⊕ ... (${newLines.length - 8} more lines)`;
                }
                return msg;
            }
            case 'Write': {
                let msg = `Creating ${shortPath}`;
                if (input.content) {
                    const writeLines = input.content.trim().split('\n');
                    const showLines = writeLines.slice(0, 12);
                    for (const line of showLines) {
                        msg += `\n  ⊕ ${line}`;
                    }
                    if (writeLines.length > 12) msg += `\n  ⊕ ... (${writeLines.length - 12} more lines)`;
                }
                return msg;
            }
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
                return `Using ${toolName}`;
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
        if (this.toolSpeechTimer) clearTimeout(this.toolSpeechTimer);
        for (const d of this.disposables) d.dispose();
    }
}
