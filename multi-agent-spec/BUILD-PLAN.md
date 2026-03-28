# Multi-Agent Build Plan

## Phase 1: Extract Agent Runner from VS Code Extension

**Goal:** Pull the Claude CLI spawning/parsing logic out of the VS Code extension into a standalone Node module.

**What to do:**
- Create new directory: `agent-daemon/`
- Copy `vscode-extension/src/command-handler.ts` → `agent-daemon/src/agent-runner.ts`
- Remove all `import * as vscode from 'vscode'`
- Replace `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` with `this.projectDir` (constructor param)
- Replace `this.writeEmitter.fire(...)` with `this.log(...)` (console output)
- Remove `ensureTerminal()` entirely
- Create an `AgentSink` interface to replace `BridgeClient`:

```typescript
interface AgentSink {
  sendStatus(text: string): void;
  sendToolStatus(text: string): void;
  sendResult(text: string): void;
  sendSpeak(text: string): void;
  sendNarration(text: string): void;
  sendNewSession(): void;
}
```

- The AgentSink implementation tags every message with `{ agentId: this.agentId, ... }`

**Files:**
- `agent-daemon/src/agent-runner.ts` — extracted CommandHandler
- `agent-daemon/src/types.ts` — AgentSink interface, message types
- `agent-daemon/package.json`
- `agent-daemon/tsconfig.json`

**This is the biggest piece of work.** The command-handler.ts is 870 lines but the refactoring is mechanical — find/replace VS Code APIs with plain Node equivalents.

---

## Phase 2: Build Agent Manager

**Goal:** A manager that holds multiple AgentRunner instances and routes commands to them.

**What to do:**
- Create `agent-daemon/src/agent-manager.ts`
- Maintains `Map<string, AgentRunner>`
- Methods: `spawnAgent(agentId, projectDir, name)`, `killAgent(agentId)`, `sendCommand(agentId, text, images?)`, `getStatus(agentId)`, `listAgents()`
- Handles cleanup on process exit (kill all child Claude processes)
- Create `agent-daemon/src/bridge-connection.ts` — WebSocket client that connects to bridge, routes incoming messages to the right agent via AgentManager
- Create `agent-daemon/src/index.ts` — entry point

**Files:**
- `agent-daemon/src/agent-manager.ts`
- `agent-daemon/src/bridge-connection.ts`
- `agent-daemon/src/index.ts`

---

## Phase 3: Update Bridge Server

**Goal:** Support multiple agents instead of one extension.

**Changes to `voice-bridge/src/server.ts`:**

1. Add `'daemon'` to client roles (alongside `'phone'` and `'extension'`)
2. Replace single `BridgeState` with `agents: Map<string, AgentState>`:

```typescript
interface AgentState {
  agentId: string;
  projectDir: string;
  name: string;
  status: 'idle' | 'running' | 'complete' | 'error';
  messageHistory: HistoryEntry[];
}
```

3. New message types:
   - `spawn_agent` — phone requests new agent
   - `kill_agent` — phone kills an agent
   - `agent_list` — phone requests list of agents
   - `agent_spawned` — daemon confirms agent started
   - `agent_command` — command routed to specific agent

4. All messages from daemon include `agentId` — bridge forwards to phone with that tag
5. Per-agent message history (replay on reconnect)
6. TTS generation prefixes audio with agent name

---

## Phase 4: Update Phone UI

**Goal:** Show multiple agents in one feed.

**Changes to web-app:**

1. `src/types.ts` or equivalent — add `agentId` to Message interface
2. `src/hooks/useBridge.ts`:
   - Handle `agentId` on incoming messages
   - New functions: `spawnAgent(projectDir, name)`, `killAgent(agentId)`
   - `sendCommand` takes optional `targetAgent`
3. `src/components/VoiceChat.tsx`:
   - Agent roster bar at top (coloured dots with names and status)
   - Messages prefixed with agent label and colour
   - Currently focused agent indicator

---

## Phase 5: Voice Command Parsing

**Goal:** Parse voice commands to figure out which agent to target.

**Simple regex-based parser:**
- "start an agent on [project name]" → spawn_agent
- "kill agent [number]" / "stop agent [number]" → kill_agent
- "tell agent [number] to [command]" → route to specific agent
- "what's agent [number] doing?" → query agent status
- "agent [number], [command]" → route to specific agent
- No agent specified → send to most recently active agent

**Project registry config:**
```json
{
  "projects": {
    "markets": "C:/Users/Peter/OneDrive/Desktop/Matthews app test",
    "terminal": "C:/Users/Peter/OneDrive/Desktop/Matthews Terminal",
    "valscout": "C:/Users/Peter/OneDrive/Desktop/ValScout"
  }
}
```

---

## Known Challenges

### Audio Interleaving
If multiple agents finish at the same time, TTS responses queue up. Solution: prefix each audio response with the agent name so the user knows who's talking. The existing audio queue in useBridge.ts already plays sequentially.

### Voice Command Ambiguity
"Run the tests" — which agent? Default to the most recently addressed agent. The phone UI should make the focused agent obvious with a highlight.

### Process Cleanup on Windows
If the daemon crashes, orphan Claude processes may linger. Register cleanup handlers and use `taskkill /F /T /PID` for each child process on exit.

### Claude CLI --continue
The `--continue` flag resumes the last conversation for a given working directory. This works naturally with multi-agent since each agent has its own `cwd`. But if an agent process dies and restarts, the conversation chain may break.

### Permissions
Claude Code may require `--dangerously-skip-permissions` or pre-configured trust per project directory. The daemon should handle this consistently.

---

## What Stays the Same

- The VS Code extension continues to work as-is for single-session use
- The bridge server remains on Render
- The phone app remains a PWA
- TTS via Groq/OpenAI unchanged
- STT via Groq Whisper unchanged
- The agent daemon is a NEW addition, not a replacement
