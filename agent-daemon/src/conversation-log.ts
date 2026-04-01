/**
 * ConversationLog — writes the FULL conversation history to a markdown file.
 *
 * Unlike SessionContext (which keeps a rolling 20-exchange JSON for session recovery),
 * this writes every single message to `.matthews/conversation.md` so that any agent
 * entering the repo can read the complete history of what's been discussed.
 *
 * The file is append-only and human-readable.
 * Auto-rotates: keeps the last ~500 lines in conversation.md, archives older content.
 */

import * as fs from 'fs';
import * as path from 'path';

const SESSION_DIR = '.matthews';
const CONVERSATION_FILE = 'conversation.md';
const ARCHIVE_FILE = 'conversation-archive.md';
const MAX_LINES = 500;
const TIMEZONE = 'Australia/Melbourne';

export class ConversationLog {
    private readonly filePath: string;
    private readonly archivePath: string;

    constructor(projectDir: string) {
        const dir = path.join(projectDir, SESSION_DIR);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.filePath = path.join(dir, CONVERSATION_FILE);
        this.archivePath = path.join(dir, ARCHIVE_FILE);

        // Create file with header if it doesn't exist
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, '# Matthews Terminal — Conversation Log\n\nFull history of all conversations between the user and agents in this repo.\n\n---\n\n', 'utf-8');
        }
    }

    /** Start a new session marker */
    logSessionStart(): void {
        const timestamp = this.formatTimestamp();
        const divider = `\n## Session — ${timestamp}\n\n`;
        this.append(divider);
    }

    /** Log a user message */
    logUser(text: string, imageCount?: number): void {
        const timestamp = this.formatTimestamp();
        const images = imageCount ? ` [+${imageCount} image(s)]` : '';
        this.append(`**[${timestamp}] User:**${images}\n${text}\n\n`);
    }

    /** Log an assistant response */
    logAssistant(text: string): void {
        const timestamp = this.formatTimestamp();
        this.append(`**[${timestamp}] Matthew:**\n${text}\n\n`);
    }

    /** Format a timestamp with date and time — always Melbourne time */
    private formatTimestamp(): string {
        const now = new Date();
        const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TIMEZONE });
        const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TIMEZONE });
        return `${date} ${time}`;
    }

    /** Log a tool action (optional — for detailed history) */
    logToolAction(description: string): void {
        this.append(`> ${description}\n\n`);
    }

    /** Get the full conversation log content */
    getFullLog(): string {
        try {
            if (fs.existsSync(this.filePath)) {
                return fs.readFileSync(this.filePath, 'utf-8');
            }
        } catch {}
        return '';
    }

    /** Get a summary of recent exchanges (last N) for CLAUDE.md */
    getRecentSummary(count: number = 10): string {
        const log = this.getFullLog();
        if (!log) return '';

        // Extract the last N user/assistant pairs
        const lines = log.split('\n');
        const entries: string[] = [];
        let current = '';

        for (const line of lines) {
            if (line.startsWith('**[') && (line.includes('] User:**') || line.includes('] Matthew:**'))) {
                if (current.trim()) entries.push(current.trim());
                current = line + '\n';
            } else {
                current += line + '\n';
            }
        }
        if (current.trim()) entries.push(current.trim());

        return entries.slice(-count * 2).join('\n\n');
    }

    private append(text: string): void {
        try {
            fs.appendFileSync(this.filePath, text, 'utf-8');
            this.rotateIfNeeded();
        } catch (err) {
            console.error('[ConversationLog] Failed to write:', err);
        }
    }

    /** Move older content to archive when conversation.md gets too long */
    private rotateIfNeeded(): void {
        try {
            const content = fs.readFileSync(this.filePath, 'utf-8');
            const lines = content.split('\n');
            if (lines.length <= MAX_LINES) return;

            // Find a session boundary near the midpoint to split cleanly
            const cutTarget = lines.length - MAX_LINES;
            let cutAt = cutTarget;
            for (let i = cutTarget; i < cutTarget + 50 && i < lines.length; i++) {
                if (lines[i].startsWith('## Session')) {
                    cutAt = i;
                    break;
                }
            }

            const archiveContent = lines.slice(0, cutAt).join('\n');
            const keepContent = '# Matthews Terminal — Conversation Log\n\n_(Older history in conversation-archive.md)_\n\n---\n\n' + lines.slice(cutAt).join('\n');

            // Append to archive
            if (fs.existsSync(this.archivePath)) {
                fs.appendFileSync(this.archivePath, '\n' + archiveContent, 'utf-8');
            } else {
                fs.writeFileSync(this.archivePath, archiveContent, 'utf-8');
            }

            // Rewrite main file with just recent content
            fs.writeFileSync(this.filePath, keepContent, 'utf-8');
            console.log(`[ConversationLog] Rotated: archived ${cutAt} lines, kept ${lines.length - cutAt} lines`);
        } catch (err) {
            console.error('[ConversationLog] Rotation failed:', err);
        }
    }
}
