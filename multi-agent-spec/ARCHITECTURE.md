# Multi-Agent Architecture

## Current Architecture (Single Session)

```
Phone (Web App) ←→ Bridge Server (Render) ←→ VS Code Extension ←→ Claude CLI
```

- Phone sends voice commands via WebSocket
- Bridge relays to VS Code extension
- Extension spawns Claude Code CLI as child process
- Claude executes, extension parses streaming output
- Results flow back through bridge to phone with TTS audio

## Proposed Architecture (Multi-Agent)

```
Phone (Web App) ←→ Bridge Server (Render) ←→ Agent Daemon (Laptop) ←→ Claude CLI #1 (Project A)
                                                                    ←→ Claude CLI #2 (Project B)
                                                                    ←→ Claude CLI #3 (Project C)
                                                                    ←→ ...
```

### New Component: Agent Daemon

A standalone Node.js process that runs on your laptop. Replaces the VS Code extension for multi-agent use.

- Connects to bridge server via WebSocket (outbound, no firewall issues)
- Manages multiple Claude CLI child processes
- Each process runs in its own project directory
- Each process has its own conversation state
- Tags all messages with agentId so bridge/phone know which agent is talking

### Why Remove VS Code Dependency

The VS Code extension currently does two things:
1. Spawns and manages Claude CLI (pure Node.js — no VS Code needed)
2. Shows output in a VS Code virtual terminal (only useful if you're looking at VS Code)

For multi-agent, you don't want to be staring at VS Code. You're on your phone. So the VS Code terminal output is unnecessary. Everything the extension does with Claude CLI can run as a standalone Node script.

95% of command-handler.ts is pure Node.js. The only VS Code-specific bits are:
- Reading workspace folder path → becomes a constructor parameter
- Writing to a virtual terminal → becomes console.log or event emitter
- Cleanup on terminal close → becomes process exit handler

## Component Responsibilities

### Phone App (web-app/)
- Voice input via Web Speech API
- Send commands tagged with target agent
- Display unified feed from all agents with agent labels
- Agent roster bar showing active agents and their status
- Audio playback of TTS responses (prefixed with agent name)
- Parse voice for agent targeting: "tell agent 2 to..."

### Bridge Server (voice-bridge/)
- Route messages between phone and daemon
- Track multiple agents (Map of agentId → AgentState)
- Per-agent message history
- Per-agent status (idle/running/complete/error)
- TTS generation (Groq/OpenAI) — prefix audio with agent name
- Handle daemon connection (new client role: 'daemon')

### Agent Daemon (NEW — agent-daemon/)
- Run on laptop as a background Node process
- Connect to bridge via WebSocket
- Manage N Claude CLI child processes
- Each agent has: agentId, projectDir, process handle, conversation state
- Tag all outbound messages with agentId
- Handle spawn/kill commands from bridge
- Cleanup child processes on exit

### Project Registry
- Config file mapping friendly names to directory paths
- Example: { "markets": "C:/Users/Peter/.../Matthews app test", "terminal": "C:/Users/Peter/.../Matthews Terminal" }
- Allows voice commands like "start an agent on markets"

## Context Per Agent

Each agent's context is handled automatically by Claude Code:
- Claude reads CLAUDE.md from the project directory
- Claude reads memory files from the user's .claude folder
- The --continue flag maintains conversation history per directory
- No special context management needed — it just works

## Message Flow Example

```
1. User says: "Start an agent on the markets dashboard"
2. Phone → Bridge: { type: "spawn_agent", name: "markets", projectDir: "C:/.../Matthews app test" }
3. Bridge → Daemon: { type: "spawn_agent", agentId: "agent-1", projectDir: "C:/.../Matthews app test", name: "markets" }
4. Daemon spawns Claude CLI in that directory
5. Daemon → Bridge: { type: "agent_spawned", agentId: "agent-1", name: "markets" }
6. Bridge → Phone: { type: "agent_spawned", agentId: "agent-1", name: "markets" }
7. Phone shows: [Agent 1 — Markets] Online

8. User says: "Agent 1, fix the modal on mobile"
9. Phone parses target → agentId: "agent-1"
10. Phone → Bridge: { type: "command", agentId: "agent-1", text: "fix the modal on mobile" }
11. Bridge → Daemon: forwards with agentId
12. Daemon routes to Agent 1's Claude process
13. Claude starts working...
14. Daemon → Bridge: { type: "tool_status", agentId: "agent-1", text: "Reading index.html" }
15. Bridge → Phone: shows "Agent 1: Reading index.html"
16. ... (more tool events) ...
17. Daemon → Bridge: { type: "result", agentId: "agent-1", text: "Fixed the modal padding..." }
18. Bridge generates TTS: "Agent 1 says: Fixed the modal padding and pushed to GitHub"
19. Phone plays audio and shows result
```
