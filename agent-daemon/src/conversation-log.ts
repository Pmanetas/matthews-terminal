/**
 * ConversationLog — writes the FULL conversation history to a markdown file.
 *
 * Unlike SessionContext (which keeps a rolling 20-exchange JSON for session recovery),
 * this writes every single message to `.matthews/conversation.md` so that any agent
 * entering the repo can read the complete history of what's been discussed.
 *
 * The file is append-only and human-readable.
 */

import * as fs from 'fs';
import * as path from 'path';

const SESSION_DIR = '.matthews';
const CONVERSATION_FILE = 'conversation.md';
const TIMEZONE = 'Australia/Melbourne';

export class ConversationLog {
    private readonly filePath: string;

    constructor(projectDir: string) {
        const dir = path.join(projectDir, SESSION_DIR);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.filePath = path.join(dir, CONVERSATION_FILE);

        // Create file with header if it doesn't exist — use the actual project folder name
        if (!fs.existsSync(this.filePath)) {
            const projectName = path.basename(projectDir);
            fs.writeFileSync(this.filePath, `# ${projectName} — Conversation Log\n\nFull history of all conversations between the user and agents in this repo.\n\n---\n\n`, 'utf-8');
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
        } catch (err) {
            console.error('[ConversationLog] Failed to write:', err);
        }
    }
}
