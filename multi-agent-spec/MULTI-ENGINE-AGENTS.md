# Multi-Engine Agents — Claude + Codex

## The Idea

Don't just run multiple Claude agents. Run multiple agents using DIFFERENT AI engines. Some agents run Claude Code, others run OpenAI Codex CLI. Pick the right tool for the right job. Control them all by voice from one phone.

## Why Both Engines

[Claude Code and Codex have different strengths](https://northflank.com/blog/claude-code-vs-openai-codex):

### Claude Code — Best For:
- Complex features and frontend components
- Code quality and deep reasoning
- Architecture planning and codebase analysis
- Documentation and design conversations
- Coordinated multi-file changes
- Understanding full codebase context

### Codex CLI — Best For:
- Terminal-native tasks (DevOps, scripts, CLI tools) — [scores 77.3% vs Claude's 65.4% on Terminal-Bench 2.0](https://smartscope.blog/en/generative-ai/chatgpt/codex-vs-claude-code-2026-benchmark/)
- Security audits — [GPT-5.3-Codex has found 500+ zero-day vulnerabilities in testing](https://www.builder.io/blog/codex-vs-claude-code)
- Infrastructure and DevOps automation
- Long-running tasks with cloud execution
- Speed-critical straightforward implementation
- Open-source (Apache 2.0), built in Rust

### Codex CLI Details
- Install: `npm i -g @openai/codex` or `brew install --cask codex`
- Run: `codex` in any directory
- Auth: Sign in with ChatGPT account (Plus/Pro/Team/Enterprise)
- Output: Streams JSON, supports `--output-format stream-json` similar to Claude
- Resume: `codex resume --last` or `codex resume <SESSION_ID>`
- Parallel: Supports subagent workflows and git worktree isolation
- Sandbox: OS-level sandboxing (Seatbelt on macOS, Landlock on Linux)
- Models: GPT-5.4, GPT-5.3-Codex, GPT-5.3-Codex-Spark (1000+ tokens/sec)

## How It Works in the Multi-Agent System

The agent daemon manages agents of different types:

```typescript
interface AgentConfig {
  agentId: string;
  engine: 'claude' | 'codex';
  projectDir: string;
  name: string;
}
```

The AgentManager spawns the right CLI based on the engine:

```typescript
class AgentManager {
  spawnAgent(config: AgentConfig) {
    if (config.engine === 'claude') {
      // spawn: claude --print --verbose --dangerously-skip-permissions --output-format stream-json
    } else if (config.engine === 'codex') {
      // spawn: codex --output-format stream-json [or equivalent flags]
    }
  }
}
```

Each engine has its own stream parser since their JSON output formats differ slightly, but they both feed into the same AgentSink interface — so the bridge and phone don't care which engine is behind the agent.

## Voice Commands

- "Start a Claude agent on the markets project" → spawns Claude Code CLI
- "Start a Codex agent on the infrastructure repo" → spawns Codex CLI
- "Run a security audit on project 3 with Codex" → spawns Codex (good at security)
- "Agent 1, use Claude to refactor the frontend" → Claude handles complex frontend
- "Agent 2, use Codex to write the deployment scripts" → Codex handles DevOps

## Phone UI

The agent roster shows which engine each agent is using:

```
[C] Agent 1 — Markets Dashboard — running (Claude)
[X] Agent 2 — Infrastructure — running (Codex)
[C] Agent 3 — Matthews Terminal — idle (Claude)
```

## Use Cases

### The Developer Command Centre
You're on the couch with your phone. You say:
1. "Start a Claude agent on the frontend, fix the mobile layout"
2. "Start a Codex agent on the backend, run a security audit"
3. "Start another Claude agent on the docs, update the API reference"

Three agents, two different engines, three different projects, all running simultaneously. You get voice updates as each one works. When the security audit finishes, Codex reports what it found. When the frontend fix is done, Claude tells you what it changed. You never touch your laptop.

### The Code Review Pipeline
1. Codex agent audits the codebase for security vulnerabilities (it's specifically trained for this)
2. Claude agent reviews the architecture and suggests improvements
3. Codex agent runs the full test suite and reports results
4. All happening in parallel, all reporting back to your phone

## Architecture Impact

The agent-runner.ts needs to be engine-aware:

```
agent-daemon/
├── src/
│   ├── index.ts
│   ├── agent-manager.ts        ← manages all agents regardless of engine
│   ├── agent-runner.ts         ← base interface
│   ├── claude-runner.ts        ← Claude Code CLI specifics (extracted from current extension)
│   ├── codex-runner.ts         ← Codex CLI specifics (new)
│   ├── stream-parsers/
│   │   ├── claude-parser.ts    ← parses Claude's stream-json format
│   │   └── codex-parser.ts     ← parses Codex's output format
│   ├── bridge-connection.ts
│   └── types.ts
```

The AgentSink interface stays the same for both engines — sendStatus, sendToolStatus, sendResult, sendSpeak, sendNarration. The engine-specific runners translate their respective CLI outputs into these common events.

## Future Engines

The architecture is engine-agnostic. Adding more engines later is just:
1. New runner class (e.g., `gemini-runner.ts`)
2. New stream parser
3. New CLI spawn config

Could support: Gemini CLI, Aider, OpenCode, or any CLI-based coding agent.
