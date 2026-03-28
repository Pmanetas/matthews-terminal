/**
 * ClaudeMdUpdater — automatically maintains the CLAUDE.md file in a project.
 *
 * After each conversation exchange, updates the "Recent Work" and
 * "Last Conversation" sections so that any new Claude session
 * entering the repo has full context immediately.
 */

import * as fs from 'fs';
import * as path from 'path';

const CLAUDE_MD = 'CLAUDE.md';

// Markers for the auto-updated section
const AUTO_START = '<!-- AUTO-UPDATED BY DAEMON — DO NOT EDIT BELOW -->';
const AUTO_END = '<!-- END AUTO-UPDATED SECTION -->';

export class ClaudeMdUpdater {
    private readonly filePath: string;
    private readonly projectDir: string;
    private updateTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingUpdate = false;

    constructor(projectDir: string) {
        this.projectDir = projectDir;
        this.filePath = path.join(projectDir, CLAUDE_MD);
    }

    /**
     * Schedule a CLAUDE.md update. Debounced so rapid exchanges
     * don't cause excessive file writes.
     */
    scheduleUpdate(recentExchanges: Array<{ user: string; assistant: string; timestamp: string }>): void {
        this.pendingUpdate = true;
        if (this.updateTimer) clearTimeout(this.updateTimer);

        this.updateTimer = setTimeout(() => {
            this.updateTimer = undefined;
            if (this.pendingUpdate) {
                this.doUpdate(recentExchanges);
                this.pendingUpdate = false;
            }
        }, 5000); // Wait 5s after last exchange before writing
    }

    /** Force an immediate update (e.g. on shutdown) */
    forceUpdate(recentExchanges: Array<{ user: string; assistant: string; timestamp: string }>): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
        }
        this.doUpdate(recentExchanges);
        this.pendingUpdate = false;
    }

    private doUpdate(recentExchanges: Array<{ user: string; assistant: string; timestamp: string }>): void {
        try {
            if (!fs.existsSync(this.filePath)) {
                console.log('[ClaudeMdUpdater] No CLAUDE.md found, skipping update');
                return;
            }

            let content = fs.readFileSync(this.filePath, 'utf-8');

            // Build the auto-updated section
            const autoSection = this.buildAutoSection(recentExchanges);

            // Replace existing auto section, or append it
            const startIdx = content.indexOf(AUTO_START);
            const endIdx = content.indexOf(AUTO_END);

            if (startIdx !== -1 && endIdx !== -1) {
                content = content.slice(0, startIdx) + autoSection + content.slice(endIdx + AUTO_END.length);
            } else {
                content = content.trimEnd() + '\n\n' + autoSection + '\n';
            }

            fs.writeFileSync(this.filePath, content, 'utf-8');
            console.log('[ClaudeMdUpdater] Updated CLAUDE.md with latest conversation context');
        } catch (err) {
            console.error('[ClaudeMdUpdater] Failed to update CLAUDE.md:', err);
        }
    }

    private buildAutoSection(exchanges: Array<{ user: string; assistant: string; timestamp: string }>): string {
        const now = new Date().toISOString();
        let section = `${AUTO_START}\n\n`;
        section += `## Last Updated\n\n${now}\n\n`;

        if (exchanges.length > 0) {
            section += `## Recent Conversation\n\n`;
            section += `The last ${exchanges.length} exchange(s) from the most recent session:\n\n`;

            for (const ex of exchanges) {
                const time = new Date(ex.timestamp).toLocaleTimeString();
                section += `**[${time}] User:** ${ex.user}\n\n`;
                // Truncate very long responses but keep the substance
                const response = ex.assistant.length > 500
                    ? ex.assistant.slice(0, 500) + '...'
                    : ex.assistant;
                section += `**[${time}] Matthew:** ${response}\n\n`;
            }
        }

        section += `${AUTO_END}`;
        return section;
    }

    dispose(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
        }
    }
}
