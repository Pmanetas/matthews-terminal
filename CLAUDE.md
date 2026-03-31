# Matthews Terminal

A voice-controlled VS Code assistant. Speak from your phone, control your laptop, hear the results.

## Architecture

Four components connected via WebSocket:

1. **Web App** (`web-app/`) — React + Vite PWA on phone. Glass-morphism chat UI with speak button, transcript display, TTS playback, image attachment, terminal viewer for daemon logs. Hosted on Render.
2. **Voice Bridge** (`voice-bridge/`) — Node.js Express + WebSocket relay server on Render. Routes messages between phone and extension/daemon. Handles Groq Whisper STT and OpenAI/Groq TTS. Maintains message history for replay on reconnect. Port 4800.
3. **VS Code Extension** (`vscode-extension/`) — Controls VS Code editor and terminal. Creates/finds "VOICE AGENT" terminal, sends commands, captures output. Connects to bridge as `extension` role.
4. **Agent Daemon** (`agent-daemon/`) — Standalone Node.js process that connects to bridge and manages Claude CLI agents via `AgentRunner`. Supports multi-agent spawning, project registry, session context persistence. Also identifies as `extension` role for backward compatibility.

```
Phone (web-app) <-> Voice Bridge (Render) <-> Agent Daemon / VS Code Extension <-> Terminal
```

## Key Files

- `voice-bridge/src/server.ts` — Bridge server, all message routing, TTS/STT
- `agent-daemon/src/index.ts` — Daemon entry, stdout capture, bridge connection
- `agent-daemon/src/bridge-connection.ts` — WebSocket client, message handling, agent sink factory
- `agent-daemon/src/agent-manager.ts` — Multi-agent lifecycle (spawn, kill, route commands)
- `agent-daemon/src/agent-runner.ts` — Individual Claude CLI agent process
- `agent-daemon/src/session-context.ts` — Persists conversation to `.matthews/session-context.json`
- `agent-daemon/src/conversation-log.ts` — Full conversation history to `.matthews/conversation.md`
- `agent-daemon/src/claude-md-updater.ts` — (DISABLED) Was auto-updating CLAUDE.md with conversation history
- `agent-daemon/src/types.ts` — AgentSink, AgentInfo, BridgeCommand, DaemonMessage types
- `vscode-extension/src/extension.ts` — VS Code extension activation
- `vscode-extension/src/bridge-client.ts` — Extension WebSocket client
- `vscode-extension/src/command-handler.ts` — Command routing in VS Code
- `vscode-extension/src/terminal-manager.ts` — Terminal creation and management
- `web-app/src/components/VoiceChat.tsx` — Main phone UI component
- `web-app/src/hooks/useBridge.ts` — WebSocket hook for phone
- `docs/BUILD-SPEC.md` — Full v1 build specification
- `multi-agent-spec/` — Future multi-agent architecture docs

## Current State (as of 2026-03-28)

### What's Working
- Phone web app connects to bridge, sends voice commands, displays responses
- Voice bridge relays messages, does STT (Groq Whisper) and TTS (OpenAI with Groq fallback)
- Agent daemon spawns Claude CLI agent, captures stdout/stderr, forwards to bridge
- Phone terminal viewer shows daemon logs in real-time with message counter
- Daemon log history replays to phone on reconnect
- Session context persists conversation exchanges to disk
- Narration/TTS pipeline working (had race conditions, now fixed)
- Image attachment support from phone to agent

### Recent Work (Last Few Sessions)
- Added automatic CLAUDE.md updating and full conversation logging in the daemon
- Built terminal viewer on phone to see daemon logs remotely
- Fixed daemon logs not showing on phone (added DaemonLogMessage to bridge union type)
- Added message counter in top-left of phone UI
- Replay daemon log history to phone on connect
- Fixed narration TTS pipeline (stderr race conditions, streaming flag resets, speak handler)
- Added agent daemon with multi-agent spec and session persistence

### What's Next
- Multi-agent support (spawn agents per project, route commands by agentId)
- Bridge protocol update for multi-agent messages
- Phone UI for selecting/managing multiple agents

## Conversation History

The daemon automatically maintains two conversation files in `.matthews/`:

- **`session-context.json`** — Rolling log of last 20 exchanges (JSON). Used internally for session recovery when daemon restarts.
- **`conversation.md`** — Full append-only conversation log (Markdown). Every user message and assistant response, with timestamps. Never truncated.

Full conversation history is in `.matthews/conversation.md` — read it if you need context from past sessions. It is NOT loaded automatically to save token usage.

## Conventions

- Terminal name: `VOICE AGENT`
- Bridge URL (prod): `wss://matthews-terminal.onrender.com`
- Bridge URL (local): `ws://localhost:4800`
- Daemon identifies as `extension` role for backward compatibility
- The assistant persona is called "Matthew" — friendly, conversational tone
- TTS: OpenAI tts-1 with onyx voice (1.12x speed), Groq fallback
- STT: Groq Whisper large-v3-turbo

## Build & Run

- **Voice Bridge**: `cd voice-bridge && npm run dev` (needs GROQ_API_KEY, OPENAI_API_KEY)
- **Agent Daemon**: `cd agent-daemon && npm run build && node dist/index.js [project-dir]`
- **VS Code Extension**: Package .vsix, install in VS Code, reload window
- **Web App**: `cd web-app && npm run dev` (or build for prod: `npm run build`, served by bridge)
