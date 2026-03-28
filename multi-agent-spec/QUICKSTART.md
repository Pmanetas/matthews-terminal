# Quickstart — How to Start Working on This

## Right Now (Using the VS Code Extension)

1. Open "Matthews Terminal" folder in VS Code
2. Open terminal in VS Code (Ctrl + backtick)
3. Type `claude` and hit enter — Claude starts with full context of this project
4. Ctrl+Shift+P → "Matthews Terminal: Connect to Voice Bridge" — connects extension to bridge
5. Open web app on phone — you're now talking by voice to Claude working on this project
6. Say: "Read the multi-agent-spec folder and start building Phase 1 — the standalone daemon"
7. Claude builds the daemon using the BUILD-PLAN.md as its guide

## When You Change Extension Code

If Claude modifies files in vscode-extension/:
1. Say "rebuild the extension" — Claude runs npm run build
2. Ctrl+Shift+P → "Reload Window" in VS Code
3. Ctrl+Shift+P → "Matthews Terminal: Connect to Voice Bridge" to reconnect
4. Phone reconnects automatically

If Claude modifies voice-bridge/ or web-app/ — no reload needed, those are separate services.

## Once the Daemon is Built (The Goal)

1. Open any terminal (doesn't need to be VS Code)
2. Run: `node agent-daemon/dist/index.js`
3. Open phone — start talking
4. No VS Code needed, no extension, no reloading
5. Daemon manages multiple agents across different project folders
6. To restart after code changes: Ctrl+C, rebuild, run again

## What Claude Knows When It Starts

Claude will automatically read:
- CLAUDE.md in the project root (project overview)
- multi-agent-spec/VISION.md (what we're building and why)
- multi-agent-spec/ARCHITECTURE.md (system design)
- multi-agent-spec/BUILD-PLAN.md (step-by-step phases)
- multi-agent-spec/MULTI-ENGINE-AGENTS.md (Claude + Codex support)
- multi-agent-spec/RISKS-AND-SAFETY.md (permissions and safety)
- multi-agent-spec/DEV-WORKFLOW.md (development process)
- multi-agent-spec/COMPETITIVE-ANALYSIS.md (market landscape)

You don't need to explain any context. Just tell it what to build.
