/**
 * AgentRunner — extracted from vscode-extension/src/command-handler.ts
 *
 * Pure Node.js — no VS Code dependency.
 * Spawns a Claude CLI process, parses stream-json output, and sends
 * status/results back through an AgentSink.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentSink, ImageData } from './types';
import { SessionContext } from './session-context';
import { ConversationLog } from './conversation-log';
import { ClaudeMdUpdater } from './claude-md-updater';

// ANSI colour helpers for terminal output
const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    green: '\x1b[32m',
};

const SYSTEM_PROMPT = `You are Matthew, a friendly software engineer assistant. Your responses are read aloud by text-to-speech. Rules:
- Talk like you're chatting with a mate — natural, conversational sentences.
- NEVER use bullet points, numbered lists, dashes, or markdown formatting.
- CRITICAL: Keep your final summary SHORT — 2 to 3 sentences max, all in ONE paragraph. No line breaks between sentences. Just one flowing block of text.
- CRITICAL: Narrate what you're doing as you go. Before each action, say a short sentence about what you're about to do. For example: "Let me read the file first" then read it, then "Alright I can see the issue, let me fix that up" then edit it, then "Done, here's what I changed". This creates a natural flow between your actions.
- Keep each narration line short — one sentence, like you're thinking out loud.
- After finishing, give a brief 2-3 sentence summary in one paragraph. Don't repeat what you narrated. Just say what the end result is.
- Speak naturally: "I'll update the background colour" not "Modified file.ts line 42".`;

export class AgentRunner {
    private readonly projectDir: string;
    private readonly agentId: string;
    private isProcessing = false;
    private activeProcess: ChildProcess | undefined;
    private conversationStarted = false;
    private streamingText = '';
    private streamThrottleTimer: ReturnType<typeof setTimeout> | undefined;
    private lastFlushedLength = 0;
    private lastToolDescription = '';

    // Buffer for streaming tool calls
    private pendingToolName: string | null = null;
    private pendingToolInput = '';

    // Batch tool call speech
    private toolSpeechQueue: string[] = [];
    private toolSpeechTimer: ReturnType<typeof setTimeout> | undefined;

    // Speech / tool tracking
    private hasSpokenToolUpdate = false;
    private toolCallCount = 0;
    private stderrToolsSent = new Set<string>();
    private hasSeenFirstTool = false;
    private aborted = false;
    private receivedStreamingEvents = false;

    // Idle timer
    private idleTimer: ReturnType<typeof setTimeout> | undefined;
    private idleDotCount = 0;

    // Session persistence
    private sessionContext: SessionContext;
    private conversationLog: ConversationLog;
    private claudeMdUpdater: ClaudeMdUpdater;
    private lastUserPrompt = '';

    constructor(agentId: string, projectDir: string) {
        this.agentId = agentId;
        this.projectDir = projectDir;
        this.sessionContext = new SessionContext(projectDir);
        this.conversationLog = new ConversationLog(projectDir);
        this.claudeMdUpdater = new ClaudeMdUpdater(projectDir);
    }

    get id(): string { return this.agentId; }
    get busy(): boolean { return this.isProcessing; }

    // ── Public API ──────────────────────────────────────────

    abortCommand(sink: AgentSink): void {
        if (!this.isProcessing || !this.activeProcess) return;

        console.log(`[Agent ${this.agentId}] Aborting active command`);
        this.aborted = true;
        const pid = this.activeProcess.pid;
        if (pid) {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/F', '/T', '/PID', pid.toString()], { shell: true });
            } else {
                this.activeProcess.kill('SIGTERM');
            }
        }
        this.activeProcess = undefined;
        this.isProcessing = false;
        this.streamingText = '';
        this.lastFlushedLength = 0;
        sink.sendResult('Stopped.');
    }

    async handleCommand(text: string, sink: AgentSink, images?: ImageData[]): Promise<void> {
        if (this.isProcessing) {
            const activity = this.lastToolDescription || 'working';
            sink.sendResult(`Still ${activity}...`);
            return;
        }

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
        this.stderrToolsSent.clear();
        this.aborted = false;
        this.receivedStreamingEvents = false;

        this.lastUserPrompt = text;

        if (!this.conversationStarted) {
            sink.sendNewSession();
            this.conversationLog.logSessionStart();
        }

        // Log the user message to conversation history
        this.conversationLog.logUser(text, images?.length);

        // Terminal output — mirrors what the VS Code extension showed
        const imgLabel = images?.length ? ` [+${images.length} image(s)]` : '';
        console.log(`\n${C.magenta}🎤 You:${C.reset} ${text}${imgLabel}`);
        console.log(`${C.dim}⏳ Claude is thinking...${C.reset}\n`);

        sink.sendStatus('Thinking...');
        this.resetIdleTimer(sink);

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
            }
        }

        try {
            await this.runClaude(text, sink, imageFiles);
            if (this.aborted) {
                console.log(`[Agent ${this.agentId}] Command was aborted, skipping result`);
            } else {
                const finalText = this.streamingText.trim() || 'Done';
                console.log(`\n${C.green}✅ Result:${C.reset} ${finalText.slice(0, 200)}${finalText.length > 200 ? '...' : ''}`);
                sink.sendResult(finalText);
                // Persist this exchange for session recovery
                this.sessionContext.saveExchange(this.lastUserPrompt, finalText);
                // Log full conversation and update CLAUDE.md
                this.conversationLog.logAssistant(finalText);
                this.claudeMdUpdater.scheduleUpdate(
                    this.sessionContext.getExchanges()
                );
            }
        } catch (err: unknown) {
            if (this.aborted) {
                console.log(`[Agent ${this.agentId}] Command was aborted (error path), skipping result`);
            } else {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`\n${C.red}❌ Error: ${msg}${C.reset}`);
                sink.sendResult(`Error: ${msg}`);
            }
        } finally {
            this.isProcessing = false;
            this.activeProcess = undefined;
            this.clearIdleTimer();
            if (this.toolSpeechTimer) {
                clearTimeout(this.toolSpeechTimer);
                this.toolSpeechTimer = undefined;
            }
            for (const f of imageFiles) {
                try { fs.unlinkSync(f); } catch {}
            }
        }
    }

    dispose(): void {
        this.activeProcess?.kill();
        if (this.toolSpeechTimer) clearTimeout(this.toolSpeechTimer);
        this.clearIdleTimer();
        // Flush any pending CLAUDE.md update before shutdown
        this.claudeMdUpdater.forceUpdate(this.sessionContext.getExchanges());
        this.claudeMdUpdater.dispose();
    }

    // ── Claude CLI ──────────────────────────────────────────

    private runClaude(prompt: string, sink: AgentSink, imageFiles: string[] = []): Promise<string> {
        return new Promise((resolve, reject) => {
            const claudePath = process.platform === 'win32'
                ? `${process.env.APPDATA}\\npm\\claude.cmd`
                : 'claude';

            const args = ['--print', '--verbose', '--dangerously-skip-permissions', '--output-format', 'stream-json'];
            if (this.conversationStarted) {
                args.push('--continue');
            }

            this.activeProcess = spawn(claudePath, args, {
                cwd: this.projectDir,
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
                        this.handleStreamEvent(event, sink, (text) => {
                            fullResponseText += text;
                        });
                    } catch {
                        // Non-JSON line, log it
                        console.log(`[Agent ${this.agentId}] ${trimmed}`);
                    }
                }
            });

            this.activeProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                const stderrLines = text.split('\n');
                for (const line of stderrLines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    const toolMsg = this.parseStderrToolCall(trimmed);
                    if (toolMsg) {
                        const filePath = toolMsg.match(/(?:Reading|Editing|Creating)\s+(.+)/)?.[1] || '';
                        if (!filePath.includes('tool-results/') && !filePath.includes('tool-results\\')) {
                            const shortDesc = toolMsg.split('\n')[0];
                            this.stderrToolsSent.add(shortDesc);
                            console.log(`${C.yellow}${shortDesc}${C.reset}`);
                            sink.sendToolStatus(toolMsg);
                        }
                    }
                }
            });

            let imageInstructions = '';
            if (imageFiles.length > 0) {
                imageInstructions = imageFiles.map(f =>
                    `\n\n[The user attached an image. Use the Read tool to view it at: ${f}]`
                ).join('');
            }

            // On first message of a new session, include any saved context from previous session
            let sessionPreamble = '';
            if (!this.conversationStarted && this.sessionContext.hasContext()) {
                sessionPreamble = this.sessionContext.getContextPrompt();
                console.log(`${C.dim}[Session] Loaded previous context for continuity${C.reset}`);
            }

            const fullPrompt = this.conversationStarted
                ? prompt + imageInstructions
                : `${SYSTEM_PROMPT}${sessionPreamble}\n\nUser: ${prompt}${imageInstructions}`;
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
                        this.handleStreamEvent(event, sink, (text) => {
                            fullResponseText += text;
                        });
                    } catch { /* ignore */ }
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

    // ── Tool speech batching ────────────────────────────────

    private queueToolSpeech(description: string, sink: AgentSink): void {
        this.toolSpeechQueue.push(description);
        if (this.toolSpeechTimer) clearTimeout(this.toolSpeechTimer);

        this.toolSpeechTimer = setTimeout(() => {
            this.toolSpeechTimer = undefined;
            const queue = this.toolSpeechQueue;
            this.toolSpeechQueue = [];
            if (queue.length === 0) return;

            let speech: string;
            if (queue.length === 1) {
                speech = queue[0];
            } else if (queue.length <= 3) {
                speech = queue.join(', then ');
            } else {
                speech = this.summarizeToolBatch(queue);
            }
            sink.sendSpeak(speech);
        }, 2000);
    }

    private summarizeToolBatch(tools: string[]): string {
        const counts: Record<string, number> = {};
        for (const t of tools) {
            const action = t.split(' ')[0].toLowerCase();
            counts[action] = (counts[action] || 0) + 1;
        }
        const parts: string[] = [];
        for (const [action, count] of Object.entries(counts)) {
            parts.push(count === 1 ? `${action} a file` : `${action} ${count} files`);
        }
        if (parts.length === 1) return `Just ${parts[0]}`;
        const last = parts.pop();
        return `Just ${parts.join(', ')} and ${last}`;
    }

    // ── Stderr tool parsing ─────────────────────────────────

    private parseStderrToolCall(line: string): string | null {
        const arrowMatch = line.match(/^[⏵▸►→>]\s*(\w+)\((.+)\)/);
        if (arrowMatch) return this.describeStderrTool(arrowMatch[1], arrowMatch[2]);

        const arrowSimple = line.match(/^[⏵▸►→>]\s*(\w+)\s*$/);
        if (arrowSimple) return this.describeStderrTool(arrowSimple[1], '');

        const toolPrefix = line.match(/^[Tt]ool:\s*(\w+)/);
        if (toolPrefix) return this.describeStderrTool(toolPrefix[1], '');

        const knownTools = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Agent', 'WebSearch', 'WebFetch'];
        for (const tool of knownTools) {
            if (line.startsWith(tool + '(') || line.startsWith(tool + ' ')) {
                return this.describeStderrTool(tool, line.slice(tool.length));
            }
        }

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
            case 'Read': return `Reading ${shortPath || 'a file'}`;
            case 'Edit': {
                let msg = `Editing ${shortPath || 'a file'}`;
                const oldMatch = cleanDetails.match(/old_string:\s*["']([^"']{0,120})/);
                const newMatch = cleanDetails.match(/new_string:\s*["']([^"']{0,120})/);
                if (oldMatch) msg += `\n  ⊖ ${oldMatch[1]}`;
                if (newMatch) msg += `\n  ⊕ ${newMatch[1]}`;
                return msg;
            }
            case 'Write': return `Creating ${shortPath || 'a new file'}`;
            case 'Bash': {
                const cmdMatch = cleanDetails.match(/command:\s*["']?([^"']{0,80})/);
                return `Running: ${cmdMatch ? cmdMatch[1] : 'a command'}`;
            }
            case 'Glob': return `Searching for files`;
            case 'Grep': return `Searching through code`;
            case 'Agent': return `Running a subtask`;
            case 'WebSearch': return `Searching the web`;
            case 'WebFetch': return `Fetching a webpage`;
            case 'TodoWrite': return 'Planning next steps...';
            default: return `Using ${toolName}`;
        }
    }

    // ── Streaming text helpers ───────────────────────────────

    private flushStreamingText(sink: AgentSink): void {
        if (this.streamThrottleTimer) {
            clearTimeout(this.streamThrottleTimer);
            this.streamThrottleTimer = undefined;
        }
        if (this.streamingText.trim()) {
            sink.sendStatus(this.streamingText);
        }
    }

    private resetIdleTimer(sink: AgentSink): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleDotCount = 0;
        const tick = () => {
            if (this.aborted || !this.isProcessing) return;
            this.idleDotCount++;
            const dots = '.'.repeat((this.idleDotCount % 3) + 1);
            sink.sendStatus(`Working${dots}`);
            this.idleTimer = setTimeout(tick, 1500);
        };
        this.idleTimer = setTimeout(tick, 2000);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }

    private flushAndSpeak(sink: AgentSink): void {
        this.flushStreamingText(sink);
        const text = this.streamingText.trim();
        if (text.length > 5) {
            console.log(`${C.magenta}🔊 Narrating: "${text.slice(0, 80)}"${C.reset}`);
            sink.sendToolStatus(`💬 ${text}`);
            sink.sendSpeak(text);
        }
        this.streamingText = '';
        this.lastFlushedLength = 0;
    }

    private scheduleStreamFlush(sink: AgentSink): void {
        const newChars = this.streamingText.length - this.lastFlushedLength;
        if (newChars >= 80) {
            if (this.streamThrottleTimer) {
                clearTimeout(this.streamThrottleTimer);
                this.streamThrottleTimer = undefined;
            }
            this.lastFlushedLength = this.streamingText.length;
            sink.sendStatus(this.streamingText);
            return;
        }
        if (this.streamThrottleTimer) clearTimeout(this.streamThrottleTimer);
        this.streamThrottleTimer = setTimeout(() => {
            this.streamThrottleTimer = undefined;
            if (this.streamingText.trim()) {
                this.lastFlushedLength = this.streamingText.length;
                sink.sendStatus(this.streamingText);
            }
        }, 150);
    }

    // ── Tool call emission ──────────────────────────────────

    private emitToolCall(block: any, sink: AgentSink): void {
        this.flushAndSpeak(sink);
        this.hasSeenFirstTool = true;
        const toolName = block.name || block.tool_name || '';
        const input = block.input || {};

        // Skip internal temp files
        const filePath = input.file_path || '';
        if (filePath.includes('tool-results/') || filePath.includes('tool-results\\')) {
            this.toolCallCount++;
            return;
        }

        const msg = this.describeToolCall(block);
        this.lastToolDescription = msg.split('\n')[0];
        if (!this.stderrToolsSent.delete(this.lastToolDescription)) {
            console.log(`${C.yellow}${this.lastToolDescription}${C.reset}`);
            sink.sendToolStatus(msg);
        }
        this.toolCallCount++;

        // For Read tool: send file content preview
        if (toolName === 'Read' && input.file_path) {
            try {
                let resolvedPath = input.file_path;
                if (!path.isAbsolute(resolvedPath)) {
                    resolvedPath = path.join(this.projectDir, resolvedPath);
                }
                const content = fs.readFileSync(resolvedPath, 'utf-8');
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
                sink.sendToolStatus(preview);
            } catch { /* file not accessible */ }
        }
    }

    private findToolInEvent(event: any): { name: string; input: any } | null {
        if (event.tool_name || (event.type === 'tool_use' && event.name)) {
            return { name: event.tool_name || event.name, input: event.input || {} };
        }
        if (event.content_block?.type === 'tool_use') {
            return { name: event.content_block.name || event.content_block.tool_name, input: event.content_block.input || {} };
        }
        if (event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === 'tool_use') {
                    return { name: block.name || block.tool_name, input: block.input || {} };
                }
            }
        }
        if (event.subtype === 'tool_use' || event.subtype === 'tool') {
            return { name: event.name || event.tool_name || event.tool || 'tool', input: event.input || {} };
        }
        return null;
    }

    // ── Stream event handler ────────────────────────────────

    private handleStreamEvent(
        event: any,
        sink: AgentSink,
        onText: (text: string) => void,
    ): void {
        if (this.aborted) return;

        // Suppress noisy system events
        if (event.type === 'system' && (event.subtype === 'task_progress' || event.subtype === 'init')) {
            sink.sendStatus('Working...');
            return;
        }

        this.resetIdleTimer(sink);

        // ── Assistant message ──
        if (event.type === 'assistant' && event.message?.content) {
            if (this.receivedStreamingEvents) return;

            let hasToolsInThisEvent = false;
            for (const block of event.message.content) {
                if (block.type === 'text') {
                    onText(block.text);
                    this.streamingText += block.text;
                    process.stdout.write(`${C.cyan}${block.text}${C.reset}`);
                    this.flushStreamingText(sink);
                } else if (block.type === 'tool_use') {
                    hasToolsInThisEvent = true;
                    this.emitToolCall(block, sink);
                }
            }
            if (hasToolsInThisEvent && this.streamingText.trim().length > 5) {
                this.flushAndSpeak(sink);
            }
            return;
        }

        // ── Tool results ──
        if (event.type === 'user' && event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === 'tool_result') {
                    if (this.streamingText.trim().length > 5) {
                        this.flushAndSpeak(sink);
                    }
                    this.streamingText = '';
                    this.lastFlushedLength = 0;
                }
            }
            this.receivedStreamingEvents = false;
            return;
        }

        // ── Streaming deltas ──
        if (event.type === 'content_block_delta' || event.type === 'content_block_start' || event.type === 'content_block_stop') {
            this.receivedStreamingEvents = true;
        }

        if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
                onText(event.delta.text);
                this.streamingText += event.delta.text;
                process.stdout.write(`${C.cyan}${event.delta.text}${C.reset}`);
                this.scheduleStreamFlush(sink);
            } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                this.pendingToolInput += event.delta.partial_json;
            }
            return;
        }

        // ── Tool call start (streaming) ──
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            this.pendingToolName = event.content_block.name || event.content_block.tool_name || null;
            this.pendingToolInput = '';
            if (event.content_block.input && Object.keys(event.content_block.input).length > 0) {
                this.emitToolCall(event.content_block, sink);
                this.pendingToolName = null;
            } else if (this.pendingToolName) {
                this.flushAndSpeak(sink);
                const preliminary = this.describeToolCall({ name: this.pendingToolName, input: {} });
                this.lastToolDescription = preliminary;
                sink.sendToolStatus(preliminary);
                this.toolCallCount++;
            }
            return;
        }

        // ── Tool call end (streaming) ──
        if (event.type === 'content_block_stop') {
            if (this.pendingToolName) {
                let input = {};
                try {
                    if (this.pendingToolInput.trim()) {
                        input = JSON.parse(this.pendingToolInput);
                    }
                } catch { /* partial JSON */ }
                this.emitToolCall({ name: this.pendingToolName, input }, sink);
                this.pendingToolName = null;
                this.pendingToolInput = '';
            }
            return;
        }

        // ── Result ──
        if (event.type === 'result') {
            this.flushStreamingText(sink);
            if (!this.streamingText.trim() && event.result) {
                this.streamingText = event.result;
            }
            return;
        }

        // ── Tool result (various formats) ──
        const toolOutput = event.output || event.content || event.result_text || event.data;
        if (event.type === 'tool_result' || (event.type === 'result' && event.subtype === 'tool_result') || (toolOutput && event.tool_use_id)) {
            const output = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput || '');

            if (this.lastToolDescription.startsWith('Reading') && output.length > 0) {
                const lines = output.split('\n').slice(0, 20);
                let contentPreview = this.lastToolDescription;
                for (const line of lines) {
                    contentPreview += `\n  ${line}`;
                }
                if (output.split('\n').length > 20) {
                    contentPreview += `\n  ... (${output.split('\n').length - 20} more lines)`;
                }
                sink.sendToolStatus(contentPreview);
            }

            this.streamingText = '';
            this.lastFlushedLength = 0;
            return;
        }

        // ── Catch-all: find tool calls ──
        const tool = this.findToolInEvent(event);
        if (tool && tool.name) {
            this.emitToolCall(tool, sink);
            return;
        }

        // ── Text in other formats ──
        const text = event.text || event.content || event.delta?.text;
        if (typeof text === 'string' && text.length > 0) {
            onText(text);
            this.streamingText += text;
            this.scheduleStreamFlush(sink);
        }
    }

    // ── Tool description ────────────────────────────────────

    private describeToolCall(block: any): string {
        const toolName = block.name || block.tool_name || 'tool';
        const input = block.input || {};

        const filePath = input.file_path || '';
        const fileName = filePath ? path.basename(filePath) : '';
        const dirName = filePath ? path.basename(path.dirname(filePath)) : '';
        const shortPath = fileName ? (dirName ? `${dirName}/${fileName}` : fileName) : 'a file';

        switch (toolName) {
            case 'Read': return `Reading ${shortPath}`;
            case 'Edit': {
                let msg = `Editing ${shortPath}`;
                if (input.old_string) {
                    const oldLines = input.old_string.trim().split('\n');
                    for (const line of oldLines.slice(0, 8)) msg += `\n  ⊖ ${line}`;
                    if (oldLines.length > 8) msg += `\n  ⊖ ... (${oldLines.length - 8} more lines)`;
                }
                if (input.new_string) {
                    const newLines = input.new_string.trim().split('\n');
                    for (const line of newLines.slice(0, 8)) msg += `\n  ⊕ ${line}`;
                    if (newLines.length > 8) msg += `\n  ⊕ ... (${newLines.length - 8} more lines)`;
                }
                return msg;
            }
            case 'Write': {
                let msg = `Creating ${shortPath}`;
                if (input.content) {
                    const writeLines = input.content.trim().split('\n');
                    const showLines = writeLines.slice(0, 12);
                    for (const line of showLines) msg += `\n  ⊕ ${line}`;
                    if (writeLines.length > 12) msg += `\n  ⊕ ... (${writeLines.length - 12} more lines)`;
                }
                return msg;
            }
            case 'Bash': {
                const cmd = (input.command || '').trim();
                const short = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
                return `Running: ${short}`;
            }
            case 'Glob': return `Searching for files matching ${input.pattern || 'a pattern'}`;
            case 'Grep': return `Searching code for "${input.pattern || 'something'}"`;
            case 'TodoWrite': return 'Planning next steps...';
            case 'TodoRead': return 'Checking task list...';
            case 'ToolSearch': return 'Looking up available tools...';
            case 'Agent': return `Running a subtask: ${input.description || input.prompt?.slice(0, 60) || 'working...'}`;
            case 'WebSearch': return `Searching the web for "${input.query || 'something'}"`;
            case 'WebFetch': return `Fetching ${input.url || 'a webpage'}`;
            case 'NotebookEdit': return `Editing notebook ${shortPath}`;
            default: return `Using ${toolName}`;
        }
    }
}
