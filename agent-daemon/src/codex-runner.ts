/**
 * CodexRunner — Spawns OpenAI Codex CLI and parses its JSONL output.
 *
 * Mirrors AgentRunner but for Codex CLI instead of Claude CLI.
 * Uses `codex exec --json` for non-interactive execution with JSONL streaming.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentSink, ImageData } from './types';
import { SessionContext } from './session-context';
import { ConversationLog } from './conversation-log';

const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
};

const CODEX_SYSTEM_PROMPT = `You are Sabrina, a code reviewer and auditor. You're thorough, sharp-eyed, and you talk like a mate — natural and conversational. Your responses are read aloud by text-to-speech. Rules:
- Talk like you're chatting with a mate — natural, conversational sentences.
- NEVER use bullet points, numbered lists, dashes, or markdown formatting.
- CRITICAL: Keep your final summary SHORT — 2 to 3 sentences max, all in ONE paragraph. No line breaks between sentences. Just one flowing block of text.
- CRITICAL: Narrate what you're doing as you go. Before each action, say a short sentence about what you're about to do.
- Keep each narration line short — one sentence, like you're thinking out loud.
- After finishing, give a brief 2-3 sentence summary in one paragraph.
- Speak naturally: "I'll check the bridge connection file" not "Reviewing file.ts line 42".
- When asked to audit or review, be THOROUGH. Check every file that was changed. Verify the changes make sense. Look for bugs, missed edge cases, typos, logic errors, and anything that looks off. Don't gloss over things.
- Before auditing, read Matthew's conversation history at .matthews/claude-conversation.md to understand what was recently done and why. Your own conversation history is at .matthews/sabrina-conversation.md.
- CRITICAL DEPLOYMENT RULE: You are running inside the Matthews Terminal daemon. If you edit files in agent-daemon/ and rebuild (npm run build), the daemon RESTARTS and your session is KILLED. You MUST git add, git commit, and git push BEFORE rebuilding the daemon. The correct order is: make changes → git add → git commit → git push → THEN rebuild. NEVER rebuild before pushing. This is non-negotiable.
- You are part of a multi-agent system. Matthew (Claude) is the primary coding agent. You (Sabrina/Codex) are the code reviewer. The user talks to both of you through a phone voice interface. Your conversation history persists across messages via session context — pick up where you left off naturally.`;

type CommandDescription = {
    kind: 'read' | 'search' | 'list' | 'command';
    summary: string;
    filePath?: string;
    workspacePath?: string;
};

export class CodexRunner {
    private readonly projectDir: string;
    private readonly agentId: string;
    private isProcessing = false;
    private activeProcess: ChildProcess | undefined;
    private aborted = false;
    private conversationStarted = false;
    private lastUserPrompt = '';

    // Session persistence
    private sessionContext: SessionContext;
    private conversationLog: ConversationLog;
    private activeLoggingDir: string;
    private lastReportedWorkspace: string;
    private turnLoggingLocked = false;
    private pendingConversationUser: { text: string; imageCount?: number } | null = null;
    private pendingConversationToolActions: string[] = [];
    private pendingCommands = new Map<string, CommandDescription>();
    private pendingFileChanges = new Map<string, Array<{ path: string; kind: string; beforeText: string | null }>>();

    // Codex thread ID for conversation continuity (resume sessions)
    private threadId: string | null = null;

    constructor(agentId: string, projectDir: string) {
        this.agentId = agentId;
        this.projectDir = projectDir;
        this.activeLoggingDir = projectDir;
        this.lastReportedWorkspace = projectDir;
        this.sessionContext = new SessionContext(projectDir, 'sabrina');
        this.conversationLog = new ConversationLog(projectDir, 'sabrina');
    }

    get id(): string { return this.agentId; }
    get busy(): boolean { return this.isProcessing; }

    private buildSessionPreamble(): string {
        const exchanges = this.sessionContext.getExchanges();
        if (exchanges.length === 0) return '';

        let context = '\n\n[PREVIOUS SABRINA CONTEXT — Keep this continuity in mind and pick up naturally from it.]\n\n';
        for (const ex of exchanges) {
            context += `User: ${ex.user}\n`;
            context += `Sabrina: ${ex.assistant}\n\n`;
        }
        context += '[END OF PREVIOUS SABRINA CONTEXT]\n\n';
        return context;
    }

    private normalizeWorkspacePath(filePath: string): string {
        let normalized = this.unquoteToken(filePath).trim().replace(/^['"]+|['"]+$/g, '');
        if (!normalized) return normalized;

        if (process.platform !== 'win32') {
            return path.normalize(normalized);
        }

        const slashPath = normalized.replace(/\\/g, '/');
        const drivePathMatch = slashPath.match(/^\/([a-zA-Z])\/(.+)$/);
        if (drivePathMatch) {
            return path.win32.normalize(`${drivePathMatch[1]}:\\${drivePathMatch[2].replace(/\//g, '\\')}`);
        }

        if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
            return path.win32.normalize(normalized);
        }

        if (slashPath.startsWith('/')) {
            const siblingName = slashPath.split('/').filter(Boolean)[0];
            const desktopParent = path.dirname(this.projectDir);
            if (siblingName) {
                const siblingRoot = path.join(desktopParent, siblingName);
                if (fs.existsSync(siblingRoot)) {
                    return path.join(desktopParent, ...slashPath.split('/').filter(Boolean));
                }
            }

            const rootCandidate = path.win32.normalize(slashPath);
            if (fs.existsSync(rootCandidate)) {
                return rootCandidate;
            }
        }

        return normalized;
    }

    private resolveWorkspacePath(filePath: string): string {
        if (!filePath) return filePath;
        const normalizedPath = this.normalizeWorkspacePath(filePath);
        if (path.isAbsolute(normalizedPath)) return path.normalize(normalizedPath);

        const candidate1 = path.resolve(this.projectDir, normalizedPath);
        const parentDir = path.dirname(this.projectDir);
        const candidate2 = path.resolve(parentDir, normalizedPath);
        if (fs.existsSync(candidate1)) return candidate1;
        if (fs.existsSync(candidate2)) return candidate2;
        return candidate1;
    }

    private resolveExistingWorkspacePath(filePath: string): string | null {
        if (!filePath) return null;
        const normalizedPath = this.normalizeWorkspacePath(filePath);
        const parentDir = path.dirname(this.projectDir);
        const candidates = path.isAbsolute(normalizedPath)
            ? [path.normalize(normalizedPath)]
            : [path.resolve(this.projectDir, normalizedPath), path.resolve(parentDir, normalizedPath)];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }
        return null;
    }

    private findWorkspaceRoot(filePath: string): string | null {
        if (!filePath || !path.isAbsolute(filePath)) return null;

        let dir = filePath;
        try {
            if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
                dir = path.dirname(dir);
            }
        } catch {
            dir = path.dirname(dir);
        }

        for (let i = 0; i < 10; i++) {
            const hasMarker = fs.existsSync(path.join(dir, 'package.json'))
                || fs.existsSync(path.join(dir, 'CLAUDE.md'))
                || fs.existsSync(path.join(dir, '.git'));
            if (hasMarker) return dir;

            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }

        return null;
    }

    private checkWorkspace(filePath: string, sink: AgentSink): void {
        if (!filePath || !path.isAbsolute(filePath)) return;
        const normalized = filePath.replace(/\\/g, '/').toLowerCase();
        const currentWorkspace = this.lastReportedWorkspace.replace(/\\/g, '/').toLowerCase();
        if (normalized.startsWith(currentWorkspace + '/') || normalized === currentWorkspace) return;

        const dir = this.findWorkspaceRoot(filePath);
        if (!dir) return;

        const normalizedDir = dir.replace(/\\/g, '/').toLowerCase();
        const normalizedLast = this.lastReportedWorkspace.replace(/\\/g, '/').toLowerCase();
        if (normalizedDir !== normalizedLast) {
            console.log(`[Workspace] Codex file outside current project: ${filePath}`);
            console.log(`\x1b[36m[Workspace] Codex switching to: ${dir}\x1b[0m`);
            this.lastReportedWorkspace = dir;
            sink.sendWorkspace(dir);
            const normalizedActive = this.activeLoggingDir.replace(/\\/g, '/').toLowerCase();
            const shouldSwitchLogging = !this.pendingConversationUser
                || !this.turnLoggingLocked
                || normalizedDir === normalizedActive;
            if (shouldSwitchLogging) {
                this.switchLogging(dir);
                if (this.pendingConversationUser) {
                    this.turnLoggingLocked = true;
                }
            }
        }
    }

    private switchLogging(newDir: string): void {
        const normalizedNew = newDir.replace(/\\/g, '/').toLowerCase();
        const normalizedCurrent = this.activeLoggingDir.replace(/\\/g, '/').toLowerCase();
        if (normalizedNew === normalizedCurrent) return;

        this.activeLoggingDir = newDir;
        this.sessionContext = new SessionContext(newDir, 'sabrina');
        this.conversationLog = new ConversationLog(newDir, 'sabrina');
        this.conversationLog.logSessionStart();
        this.ensureConversationTurnLogged();
        console.log(`\x1b[36m[Workspace] Codex logging now targets: ${path.basename(newDir)}\x1b[0m`);
    }

    private recordToolAction(description: string): void {
        if (this.pendingConversationUser) {
            this.pendingConversationToolActions.push(description);
            return;
        }
        this.conversationLog.logToolAction(description);
    }

    private ensureConversationTurnLogged(): void {
        if (!this.pendingConversationUser) return;

        this.conversationLog.logUser(this.pendingConversationUser.text, this.pendingConversationUser.imageCount);
        for (const description of this.pendingConversationToolActions) {
            this.conversationLog.logToolAction(description);
        }

        this.pendingConversationUser = null;
        this.pendingConversationToolActions = [];
    }

    private makeDisplayPath(filePath: string): string {
        if (!filePath) return 'a file';
        const normalized = filePath.replace(/\\/g, '/');
        const desktopIdx = normalized.toLowerCase().indexOf('/desktop/');
        if (desktopIdx >= 0) {
            return normalized.slice(desktopIdx + '/desktop/'.length);
        }
        if (path.isAbsolute(filePath)) {
            const parts = normalized.split('/').filter(Boolean);
            return parts.slice(-3).join('/');
        }
        const projectName = path.basename(this.lastReportedWorkspace || this.projectDir);
        return `${projectName}/${normalized}`;
    }

    private stripAnsi(text: string): string {
        return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
    }

    private splitLines(text: string): string[] {
        const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalized.split('\n');
        while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        return lines;
    }

    private readTextFile(filePath: string): string | null {
        try {
            if (!filePath || !fs.existsSync(filePath)) return null;
            const content = fs.readFileSync(filePath, 'utf-8');
            if (content.includes('\u0000')) return null;
            return content;
        } catch {
            return null;
        }
    }

    private unquoteToken(value: string): string {
        const trimmed = value.trim();
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    }

    private extractCommandScript(command: string): string {
        const match = command.match(/-Command\s+(['"])([\s\S]*)\1$/i);
        return match ? match[2] : command;
    }

    private extractSwitchValue(command: string, switchName: string): string | null {
        const regex = new RegExp(`-${switchName}\\s+((?:'[^']*')|(?:\"[^\"]*\")|(?:[^\\s|;]+))`, 'i');
        const match = command.match(regex);
        return match ? this.unquoteToken(match[1]) : null;
    }

    private extractQuotedTokens(command: string): string[] {
        const tokens: string[] = [];
        const matcher = /'([^']+)'|"([^"]+)"/g;
        let match: RegExpExecArray | null = null;
        while ((match = matcher.exec(command)) !== null) {
            tokens.push(match[1] || match[2] || '');
        }
        return tokens;
    }

    private looksLikePathToken(value: string): boolean {
        const trimmed = value.trim();
        if (!trimmed) return false;
        if (/^https?:\/\//i.test(trimmed)) return false;
        if (/^[$%]/.test(trimmed)) return false;
        if (/^[a-zA-Z0-9_.-]+$/.test(trimmed)) return false;

        return /^[a-zA-Z]:[\\/]/.test(trimmed)
            || trimmed.startsWith('/')
            || trimmed.startsWith('./')
            || trimmed.startsWith('.\\')
            || trimmed.startsWith('../')
            || trimmed.startsWith('..\\')
            || trimmed.includes('\\')
            || trimmed.includes('/');
    }

    private extractWorkspaceHintFromCommand(command: string): string | undefined {
        const candidates: string[] = [];
        const pushCandidate = (value: string | null | undefined) => {
            if (!value) return;
            const token = this.unquoteToken(value);
            if (!this.looksLikePathToken(token)) return;
            candidates.push(token);
        };

        pushCandidate(this.extractSwitchValue(command, 'LiteralPath'));
        pushCandidate(this.extractSwitchValue(command, 'Path'));

        const gitCwd = command.match(/\bgit\b[\s\S]*?\s-C\s+((?:'[^']*')|(?:\"[^\"]*\")|(?:[^\s|;]+))/i)?.[1];
        pushCandidate(gitCwd);

        for (const token of this.extractQuotedTokens(command)) {
            pushCandidate(token);
        }

        for (const candidate of candidates) {
            const resolved = this.resolveExistingWorkspacePath(candidate);
            if (resolved && this.findWorkspaceRoot(resolved)) {
                return resolved;
            }
        }

        return undefined;
    }

    private describeCommandExecution(command: string): CommandDescription {
        const script = this.extractCommandScript(command).replace(/\s+/g, ' ').trim();
        const shortScript = script.length > 80 ? script.slice(0, 80) + '...' : script;
        const workspacePath = this.extractWorkspaceHintFromCommand(script);

        if (/\bGet-Content\b/i.test(script)) {
            const rawPath = this.extractSwitchValue(script, 'LiteralPath')
                || this.extractSwitchValue(script, 'Path')
                || script.match(/\bGet-Content\b\s+(?:-Raw\s+)?((?:'[^']*')|(?:"[^"]*")|(?:[^\s|;]+))/i)?.[1]
                || '';
            const filePath = rawPath
                ? (this.resolveExistingWorkspacePath(rawPath) || this.resolveWorkspacePath(rawPath))
                : '';
            return {
                kind: 'read',
                summary: `Reading ${this.makeDisplayPath(filePath || rawPath)}`,
                filePath: filePath || rawPath || undefined,
                workspacePath: filePath || workspacePath,
            };
        }

        if (/\bSelect-String\b/i.test(script) || (/\brg\b/i.test(script) && !/\b--files\b/i.test(script))) {
            const pattern = this.extractSwitchValue(script, 'Pattern');
            return {
                kind: 'search',
                summary: pattern ? `Searching code for "${pattern}"` : 'Searching through code',
                workspacePath,
            };
        }

        if ((/\bGet-ChildItem\b/i.test(script) && /\b-Recurse\b/i.test(script)) || (/\brg\b/i.test(script) && /\b--files\b/i.test(script))) {
            const filter = this.extractSwitchValue(script, 'Filter');
            return {
                kind: 'search',
                summary: filter ? `Searching for files matching ${filter}` : 'Searching for files',
                workspacePath,
            };
        }

        if (/\bGet-ChildItem\b/i.test(script) || /\b(ls|dir)\b/i.test(script)) {
            return {
                kind: 'list',
                summary: 'Checking folder contents',
                workspacePath,
            };
        }

        return {
            kind: 'command',
            summary: `Running: ${shortScript || 'a command'}`,
            workspacePath,
        };
    }

    private buildReadPreview(summary: string, filePath?: string, fallbackText?: string): string {
        const directContent = filePath ? this.readTextFile(filePath) : null;
        const sourceText = directContent ?? (fallbackText ? this.stripAnsi(fallbackText) : '');
        const lines = this.splitLines(sourceText);
        if (lines.length === 0) return summary;

        let preview = summary;
        for (const [index, line] of lines.slice(0, 40).entries()) {
            preview += `\n  ${String(index + 1).padStart(4)} │ ${line}`;
        }
        if (lines.length > 40) {
            preview += `\n  ... (${lines.length - 40} more lines)`;
        }
        return preview;
    }

    private getChangedLinePreview(beforeText: string | null, afterText: string | null): { removed: string[]; added: string[] } {
        const beforeLines = this.splitLines(beforeText || '');
        const afterLines = this.splitLines(afterText || '');

        let start = 0;
        while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
            start++;
        }

        let beforeEnd = beforeLines.length - 1;
        let afterEnd = afterLines.length - 1;
        while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
            beforeEnd--;
            afterEnd--;
        }

        return {
            removed: beforeEnd >= start ? beforeLines.slice(start, beforeEnd + 1) : [],
            added: afterEnd >= start ? afterLines.slice(start, afterEnd + 1) : [],
        };
    }

    private buildFileChangePreview(filePath: string, kind: string, beforeText: string | null, afterText: string | null): string {
        const shortPath = this.makeDisplayPath(filePath);

        if (kind === 'delete') {
            let msg = `Deleting ${shortPath}`;
            const removed = this.splitLines(beforeText || '');
            for (const line of removed.slice(0, 12)) {
                msg += `\n  ⊖ ${line}`;
            }
            if (removed.length > 12) {
                msg += `\n  ⊖ ... (${removed.length - 12} more lines)`;
            }
            return msg;
        }

        if (kind === 'create') {
            let msg = `Creating ${shortPath}`;
            const added = this.splitLines(afterText || '');
            for (const line of added.slice(0, 12)) {
                msg += `\n  ⊕ ${line}`;
            }
            if (added.length > 12) {
                msg += `\n  ⊕ ... (${added.length - 12} more lines)`;
            }
            return msg;
        }

        let msg = `Editing ${shortPath}`;
        const preview = this.getChangedLinePreview(beforeText, afterText);
        for (const line of preview.removed.slice(0, 8)) {
            msg += `\n  ⊖ ${line}`;
        }
        if (preview.removed.length > 8) {
            msg += `\n  ⊖ ... (${preview.removed.length - 8} more lines)`;
        }
        for (const line of preview.added.slice(0, 8)) {
            msg += `\n  ⊕ ${line}`;
        }
        if (preview.added.length > 8) {
            msg += `\n  ⊕ ... (${preview.added.length - 8} more lines)`;
        }
        return msg;
    }

    private beginFileChange(item: any, sink: AgentSink): void {
        if (!item?.id || !Array.isArray(item.changes)) return;

        const snapshots = item.changes
            .map((change: any) => {
                const rawPath = change?.path || '';
                const resolvedPath = this.resolveWorkspacePath(rawPath);
                if (!resolvedPath) return null;
                this.checkWorkspace(resolvedPath, sink);
                return {
                    path: resolvedPath,
                    kind: change?.kind || 'update',
                    beforeText: this.readTextFile(resolvedPath),
                };
            })
            .filter(Boolean) as Array<{ path: string; kind: string; beforeText: string | null }>;

        if (snapshots.length === 0) return;
        this.pendingFileChanges.set(item.id, snapshots);

        for (const snapshot of snapshots) {
            const summary = snapshot.kind === 'create'
                ? `Creating ${this.makeDisplayPath(snapshot.path)}`
                : snapshot.kind === 'delete'
                    ? `Deleting ${this.makeDisplayPath(snapshot.path)}`
                    : `Editing ${this.makeDisplayPath(snapshot.path)}`;
            console.log(`${C.yellow}[Codex] ${summary}${C.reset}`);
            sink.sendToolStatus(summary);
        }
    }

    private completeFileChange(item: any, sink: AgentSink): void {
        if (!item?.id) return;
        const snapshots = this.pendingFileChanges.get(item.id) || [];
        this.pendingFileChanges.delete(item.id);

        for (const snapshot of snapshots) {
            const afterText = snapshot.kind === 'delete' ? null : this.readTextFile(snapshot.path);
            const preview = this.buildFileChangePreview(snapshot.path, snapshot.kind, snapshot.beforeText, afterText);
            console.log(`${C.yellow}[Codex] ${preview.split('\n')[0]}${C.reset}`);
            sink.sendToolStatus(preview);
            this.recordToolAction(preview.split('\n')[0]);
        }
    }

    abortCommand(sink: AgentSink): void {
        if (!this.isProcessing || !this.activeProcess) return;

        console.log(`[Codex ${this.agentId}] Aborting active command`);
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
        this.turnLoggingLocked = false;
        this.pendingConversationUser = null;
        this.pendingConversationToolActions = [];
        sink.sendResult('Stopped.');
    }

    async handleCommand(text: string, sink: AgentSink, images?: ImageData[]): Promise<void> {
        if (this.isProcessing) {
            sink.sendResult('Still working on something...');
            return;
        }

        this.isProcessing = true;
        this.aborted = false;
        this.lastUserPrompt = text;
        this.lastReportedWorkspace = this.activeLoggingDir;
        this.turnLoggingLocked = false;

        if (!this.conversationStarted) {
            sink.sendNewSession();
            this.conversationLog.logSessionStart();
            this.conversationStarted = true;
        }

        this.pendingConversationUser = { text, imageCount: images?.length };
        this.pendingConversationToolActions = [];

        const imgLabel = images?.length ? ` [+${images.length} image(s)]` : '';
        console.log(`\n${C.blue}🤖 You (→Codex):${C.reset} ${text}${imgLabel}`);
        console.log(`${C.dim}⏳ Codex is thinking...${C.reset}\n`);

        sink.sendStatus('Thinking...');

        // Save images to temp files
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
            const result = await this.runCodex(text, sink, imageFiles);
            if (this.aborted) {
                console.log(`[Codex ${this.agentId}] Command was aborted, skipping result`);
            } else {
                // Use the last agent message as result text when narrations were sent
                const hadNarrations = this.narratedTexts.length > 0;
                const finalText = hadNarrations
                    ? (this.lastAgentMessage.trim() || result.trim() || 'Done')
                    : (result.trim() || 'Done');
                console.log(`\n${C.green}✅ Codex Result:${C.reset} ${finalText.slice(0, 200)}${finalText.length > 200 ? '...' : ''}`);
                // Never skip TTS — the result needs its own audio so the phone can
                // sync the typing animation to the speech (last narration was held back)
                sink.sendResult(finalText);
                this.ensureConversationTurnLogged();
                this.sessionContext.saveExchange(this.lastUserPrompt, finalText);
                this.conversationLog.logAssistant(finalText);
            }
        } catch (err: unknown) {
            if (!this.aborted) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`\n${C.red}❌ Codex Error: ${msg}${C.reset}`);
                sink.sendResult(`Error: ${msg}`);
                this.ensureConversationTurnLogged();
                this.conversationLog.logAssistant(`Error: ${msg}`);
            }
        } finally {
            this.isProcessing = false;
            this.activeProcess = undefined;
            this.turnLoggingLocked = false;
            if (this.aborted) {
                this.pendingConversationUser = null;
                this.pendingConversationToolActions = [];
            }
            for (const f of imageFiles) {
                try { fs.unlinkSync(f); } catch {}
            }
        }
    }

    dispose(): void {
        const pid = this.activeProcess?.pid;
        if (pid) {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/F', '/T', '/PID', pid.toString()], { shell: true });
            } else {
                this.activeProcess?.kill('SIGTERM');
            }
        }
        this.activeProcess = undefined;
    }

    // ── Codex CLI ──────────────────────────────────────────

    private narratedTexts: string[] = [];
    private lastAgentMessage: string = '';
    private pendingSpeakText: string | null = null;

    private runCodex(prompt: string, sink: AgentSink, imageFiles: string[] = []): Promise<string> {
        this.narratedTexts = [];
        this.lastAgentMessage = '';
        this.pendingSpeakText = null;
        this.pendingCommands.clear();
        this.pendingFileChanges.clear();
        return new Promise((resolve, reject) => {
            let fullPrompt: string;
            let args: string[];

            if (this.threadId) {
                // Resume existing conversation — Codex keeps full history
                fullPrompt = prompt;
                // Add image references if any
                if (imageFiles.length > 0) {
                    fullPrompt += imageFiles.map(f =>
                        `\n\n[The user attached an image. Use the Read tool to view it at: ${f}]`
                    ).join('');
                }
                args = [
                    'exec', 'resume',
                    this.threadId,
                    '--json',
                    '-s', 'danger-full-access',
                    '-',  // read prompt from stdin
                ];
            } else {
                // First message — include system prompt and any session preamble from disk
                fullPrompt = `${CODEX_SYSTEM_PROMPT}${this.buildSessionPreamble()}\n\nUser: ${prompt}`;
                // Add image references if any
                if (imageFiles.length > 0) {
                    fullPrompt += imageFiles.map(f =>
                        `\n\n[The user attached an image at: ${f}]`
                    ).join('');
                }
                args = [
                    'exec',
                    '--json',
                    '-s', 'danger-full-access',
                    '-',  // read prompt from stdin
                ];
            }

            // Add image flags if Codex supports them
            for (const img of imageFiles) {
                args.push('-i', img);
            }

            const mode = this.threadId ? `resume ${this.threadId.slice(0, 8)}...` : 'new session';
            console.log(`${C.dim}[Codex] Spawning: codex ${mode} (prompt via stdin)${C.reset}`);

            this.activeProcess = spawn('codex', args, {
                cwd: this.projectDir,
                shell: true,
                env: { ...process.env },
            });

            // Write prompt via stdin to avoid shell escaping issues with newlines
            this.activeProcess.stdin?.write(fullPrompt);
            this.activeProcess.stdin?.end();

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
                        this.handleCodexEvent(event, sink, (text) => {
                            fullResponseText += text;
                        });
                    } catch {
                        console.log(`[Codex ${this.agentId}] ${trimmed}`);
                    }
                }
            });

            this.activeProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString().trim();
                if (text) {
                    console.log(`${C.dim}[Codex stderr] ${text}${C.reset}`);
                }
            });

            this.activeProcess.on('error', (err) => {
                if (err.message.includes('ENOENT')) {
                    reject(new Error('Codex CLI not found. Install: npm i -g @openai/codex'));
                } else {
                    reject(err);
                }
            });

            this.activeProcess.on('close', (code) => {
                // Process any remaining buffered data
                if (lineBuffer.trim()) {
                    try {
                        const event = JSON.parse(lineBuffer.trim());
                        this.handleCodexEvent(event, sink, (text) => {
                            fullResponseText += text;
                        });
                    } catch { /* ignore */ }
                }
                if (fullResponseText.trim()) {
                    resolve(fullResponseText.trim());
                } else if (code === 0) {
                    resolve('Done.');
                } else {
                    // If resume failed, clear thread ID so next message starts fresh
                    if (this.threadId) {
                        console.log(`${C.yellow}[Codex] Resume may have failed (exit ${code}), clearing thread ID for fresh start${C.reset}`);
                        this.threadId = null;
                    }
                    reject(new Error(`Codex exited with code ${code}`));
                }
            });
        });
    }

    /**
     * Handle a single JSONL event from Codex CLI.
     *
     * Codex emits these event types:
     * - thread.started: { thread_id }
     * - turn.started: {}
     * - item.started: { item: { id, type, command, status: "in_progress" } }
     * - item.completed: { item: { id, type, text?, command?, aggregated_output?, exit_code? } }
     * - turn.completed: { usage }
     * - turn.failed: { error }
     * - error: { message }
     */
    private handleCodexEvent(
        event: any,
        sink: AgentSink,
        appendText: (text: string) => void,
    ): void {
        switch (event.type) {
            case 'thread.started':
                if (event.thread_id) {
                    this.threadId = event.thread_id;
                    console.log(`${C.dim}[Codex] Thread: ${event.thread_id} (saved for resume)${C.reset}`);
                } else {
                    console.log(`${C.dim}[Codex] Thread started (no id)${C.reset}`);
                }
                break;

            case 'turn.started':
                console.log(`${C.dim}[Codex] Turn started${C.reset}`);
                break;

            case 'item.started': {
                const item = event.item;
                if (item?.type === 'command_execution' && item.command) {
                    const described = this.describeCommandExecution(item.command);
                    if (item.id) {
                        this.pendingCommands.set(item.id, described);
                    }
                    const workspacePath = described.workspacePath || described.filePath;
                    if (workspacePath) {
                        this.checkWorkspace(workspacePath, sink);
                    }
                    if (described.kind !== 'read') {
                        console.log(`${C.yellow}[Codex] ${described.summary}${C.reset}`);
                        sink.sendToolStatus(described.summary);
                        this.recordToolAction(described.summary);
                    }
                } else if (item?.type === 'file_change') {
                    this.beginFileChange(item, sink);
                } else if (item?.type === 'file_edit') {
                    console.log(`${C.yellow}[Codex] Editing file${C.reset}`);
                    sink.sendToolStatus('Editing a file');
                    this.recordToolAction('Editing a file');
                } else if (item?.type === 'file_read') {
                    console.log(`${C.yellow}[Codex] Reading file${C.reset}`);
                    sink.sendToolStatus('Reading a file');
                    this.recordToolAction('Reading a file');
                }
                break;
            }

            case 'item.completed': {
                const item = event.item;
                if (!item) break;

                if (item.type === 'agent_message' && item.text) {
                    console.log(`${C.cyan}[Codex] Message: ${item.text.slice(0, 150)}${C.reset}`);
                    // Speak the PREVIOUS pending message (we now know it's not the last one)
                    // The last message is held back so the result TTS can speak it instead,
                    // allowing the phone's TypingMarkdown to sync text to audio.
                    if (this.pendingSpeakText) {
                        sink.sendSpeak(this.pendingSpeakText);
                    }
                    this.lastAgentMessage = item.text;
                    sink.sendNarration(item.text);
                    this.pendingSpeakText = item.text;
                    this.narratedTexts.push(item.text);
                }

                if (item.type === 'command_execution') {
                    const described = (item.id && this.pendingCommands.get(item.id))
                        || this.describeCommandExecution(item.command || '');
                    if (item.id) {
                        this.pendingCommands.delete(item.id);
                    }

                    if (described.kind === 'read') {
                        const workspacePath = described.workspacePath || described.filePath;
                        if (workspacePath) {
                            this.checkWorkspace(workspacePath, sink);
                        }
                        const preview = this.buildReadPreview(described.summary, described.filePath, item.aggregated_output);
                        console.log(`${C.yellow}[Codex] ${described.summary}${C.reset}`);
                        sink.sendToolStatus(preview);
                        this.recordToolAction(described.summary);
                    } else if (described.kind === 'command') {
                        const exitCode = item.exit_code ?? '?';
                        console.log(`${C.yellow}[Codex] Command done (exit ${exitCode}): ${described.summary}${C.reset}`);
                        sink.sendToolStatus(`Command finished (exit ${exitCode})`);
                    }
                }

                if (item.type === 'file_change') {
                    this.completeFileChange(item, sink);
                }

                if (item.type === 'file_read' && item.filename) {
                    const resolvedPath = this.resolveWorkspacePath(item.filename);
                    this.checkWorkspace(resolvedPath, sink);
                    console.log(`${C.yellow}[Codex] Read: ${resolvedPath}${C.reset}`);
                    sink.sendToolStatus(`Reading ${resolvedPath}`);
                    this.recordToolAction(`Reading ${resolvedPath}`);
                }

                if (item.type === 'file_edit' && item.filename) {
                    const resolvedPath = this.resolveWorkspacePath(item.filename);
                    this.checkWorkspace(resolvedPath, sink);
                    console.log(`${C.yellow}[Codex] Edited: ${resolvedPath}${C.reset}`);
                    sink.sendToolStatus(`Editing ${resolvedPath}`);
                    this.recordToolAction(`Editing ${resolvedPath}`);
                }
                break;
            }

            case 'turn.completed':
                if (event.usage) {
                    const u = event.usage;
                    console.log(`${C.dim}[Codex] Tokens: ${u.input_tokens} in, ${u.output_tokens} out (${u.cached_input_tokens || 0} cached)${C.reset}`);
                }
                break;

            case 'turn.failed':
                console.log(`${C.red}[Codex] Turn failed: ${JSON.stringify(event.error)}${C.reset}`);
                break;

            case 'error':
                console.log(`${C.red}[Codex] Error: ${event.message}${C.reset}`);
                break;

            default:
                console.log(`${C.dim}[Codex] Unknown event: ${event.type}${C.reset}`);
                break;
        }
    }
}
