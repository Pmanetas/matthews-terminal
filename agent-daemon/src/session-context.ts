/**
 * SessionContext — persists conversation history to disk so that
 * when the daemon restarts, a fresh Claude session can pick up
 * where the last one left off.
 *
 * Stores a rolling log of user commands and assistant responses
 * in .matthews/session-context.json inside the project directory.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Exchange {
    timestamp: string;
    user: string;
    assistant: string;
}

interface SessionData {
    exchanges: Exchange[];
}

const MAX_EXCHANGES = 20;
const SESSION_DIR = '.matthews';
const SESSION_FILE = 'session-context.json';

export class SessionContext {
    private readonly filePath: string;

    constructor(projectDir: string) {
        const dir = path.join(projectDir, SESSION_DIR);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.filePath = path.join(dir, SESSION_FILE);
    }

    /** Save a completed exchange (user prompt + assistant response) */
    saveExchange(userText: string, assistantText: string): void {
        const data = this.load();
        data.exchanges.push({
            timestamp: new Date().toISOString(),
            user: userText,
            assistant: assistantText,
        });
        // Keep only the most recent exchanges
        if (data.exchanges.length > MAX_EXCHANGES) {
            data.exchanges = data.exchanges.slice(-MAX_EXCHANGES);
        }
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
            console.error('[Session] Failed to save context:', err);
        }
    }

    /** Build a context string to prepend to the first prompt after restart */
    getContextPrompt(): string {
        const data = this.load();
        if (data.exchanges.length === 0) return '';

        let context = '\n\n[SESSION CONTEXT — The daemon was restarted. Here is what we were discussing before the restart. Continue naturally from where we left off.]\n\n';
        for (const ex of data.exchanges) {
            context += `User: ${ex.user}\n`;
            context += `Matthew: ${ex.assistant}\n\n`;
        }
        context += '[END OF PREVIOUS CONTEXT — The user is now speaking to you again. Pick up naturally.]\n\n';
        return context;
    }

    /** Check if there is any saved context */
    hasContext(): boolean {
        const data = this.load();
        return data.exchanges.length > 0;
    }

    /** Clear saved context (e.g. user wants a fresh start) */
    clear(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                fs.unlinkSync(this.filePath);
            }
        } catch {}
    }

    private load(): SessionData {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                return JSON.parse(raw);
            }
        } catch {}
        return { exchanges: [] };
    }
}
