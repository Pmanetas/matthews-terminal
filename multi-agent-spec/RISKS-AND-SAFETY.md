# Risks, Safety, and Mitigation

## The Core Problem

An AI agent with terminal access can do anything you can do on your computer. That's what makes it powerful, but it's also what makes it dangerous. When you're running multiple agents simultaneously across different projects, the risk multiplies because you can't watch all of them at once.

## Risk Categories

### 1. Unintended Actions

**What could happen:**
- Agent deletes files you didn't want deleted
- Agent modifies the wrong file or project
- Agent runs a destructive command (rm -rf, git reset --hard, drop database)
- Agent pushes code to the wrong branch or production
- Agent installs malicious or unvetted packages
- Agent makes API calls you didn't authorise (spending money, sending emails)

**Why it happens:**
- Voice commands can be ambiguous — "clean up the project" could mean organise files or delete everything
- Speech-to-text can misinterpret words
- Agent makes assumptions about what you meant
- With multiple agents, a command meant for agent 1 could accidentally go to agent 2

**Mitigation:**
- **Confirmation prompts for destructive actions.** Before any delete, push, deploy, or irreversible action, the agent should ask for confirmation through the phone. "I'm about to push to main on the markets project — confirm?"
- **Action classification system.** Classify every action as safe (read files, search), moderate (edit files, run tests), or dangerous (delete, push, deploy, install packages, API calls). Safe actions run automatically. Moderate actions run with a notification. Dangerous actions require voice confirmation.
- **Undo/rollback.** Before making changes, create a git stash or backup. If something goes wrong, you can say "undo that" and it reverts.
- **Read-only mode.** Option to start agents in read-only mode where they can analyse and report but not modify anything. Good for audits and reviews.

### 2. Agent Goes Off Track

**What could happen:**
- Agent starts "fixing" things you didn't ask it to fix
- Agent refactors code you wanted left alone
- Agent enters a loop of trying to fix its own errors, making things worse
- Agent burns through API credits on a runaway task

**Why it happens:**
- Claude and Codex sometimes try to be "helpful" by doing more than asked
- Long-running tasks can drift from the original goal
- Error recovery loops where the agent keeps trying to fix a failing approach

**Mitigation:**
- **Token/time limits per task.** Set a maximum runtime or token spend per command. If an agent hits the limit, it stops and reports back.
- **Task scope lock.** When you give a command, the agent should only touch files relevant to that command. Enforce this with file path restrictions.
- **Stop command.** Voice command "stop agent 2" should immediately kill the process. This already exists in Matthews Terminal — make sure it's reliable.
- **Activity feed.** Every action the agent takes is logged and shown on the phone in real time. If you see it doing something weird, you can stop it immediately.
- **Dry run mode.** Agent shows what it would do without actually doing it. "Here's the changes I'd make — should I go ahead?"

### 3. Security and Access

**What could happen:**
- Agent reads sensitive files (credentials, API keys, private keys, .env files)
- Agent sends data to external services (through API calls or web requests)
- Agent accesses services you're logged into (email, cloud, banking if browser sessions exist)
- If the bridge server is compromised, someone else could send commands to your agents
- If someone gets access to your phone app, they control your computer

**Why it happens:**
- Agents have the same file system access as your user account
- The bridge server is on the public internet (Render)
- Voice commands go over the network

**Mitigation:**
- **Authentication on the bridge.** Token-based auth so only your phone and your daemon can connect. Not just any WebSocket connection.
- **Encrypted WebSocket (WSS).** All traffic between phone, bridge, and daemon should be encrypted. Render already provides HTTPS/WSS.
- **File access restrictions.** Configurable list of directories/files agents are NOT allowed to read or write. Default deny-list: ~/.ssh, ~/.aws, .env files, credentials, private keys.
- **Network restrictions.** Option to block agents from making outbound HTTP requests unless explicitly allowed.
- **Session tokens.** Phone app requires authentication (PIN, biometrics) before sending commands.
- **Audit log.** Every command sent and every action taken is logged with timestamps. Reviewable later.

### 4. Multi-Agent Conflicts

**What could happen:**
- Two agents edit the same file at the same time
- Agent 1 deletes a file that agent 2 is reading
- Two agents run conflicting git operations on the same repo
- Agents interfere with each other's running processes

**Why it happens:**
- Multiple agents working in the same project directory
- No coordination between agents

**Mitigation:**
- **One agent per project directory.** Enforce that only one agent can be active in a given directory at a time. If you want two agents on the same project, use git worktrees for isolation.
- **File locking.** Simple advisory lock system — if agent 1 is editing a file, agent 2 waits or works on something else.
- **Git worktree isolation.** Each agent gets its own worktree branch, preventing git conflicts. Merge when done.

### 5. Cost and Resource Usage

**What could happen:**
- Multiple agents running Claude and Codex burn through API credits fast
- Long-running tasks accumulate significant costs
- Too many agents consume laptop CPU/memory

**Why it happens:**
- Each agent is a separate Claude/Codex session using tokens
- Multiple agents multiply the cost
- Claude Code on the Max plan has higher limits but still has them

**Mitigation:**
- **Cost tracking.** Track token usage per agent and display on phone. "Agent 1 has used $2.30 this session."
- **Budget limits.** Set a maximum spend per agent or per day. Agent pauses and asks before exceeding.
- **Agent count limit.** Recommend max 3-5 concurrent agents to avoid overwhelming the laptop.
- **Idle timeout.** Agents that haven't received a command in X minutes auto-sleep to save resources.

## Recommended Permission Levels

### Level 1: Observer (Safest)
- Read files only
- Search and analyse codebase
- Report findings
- Cannot modify, create, or delete anything
- Good for: code reviews, audits, architecture analysis

### Level 2: Developer (Default)
- Read and write files within the project directory
- Run tests and builds
- Create new files
- Git operations within the branch
- Requires confirmation for: pushes, deploys, deletes, installs
- Good for: most development work

### Level 3: Admin (Full Access)
- Everything in Developer plus:
- Push to remote, deploy, install packages
- Access external APIs and services
- Cross-directory file access
- Good for: trusted automation, personal use only

### Level 4: Unrestricted (Current — dangerously-skip-permissions)
- Full access to everything
- No confirmation prompts
- Use only when you fully trust what you're telling the agent to do
- Not recommended for production/product use

## Implementation Priority

For the first version of multi-agent Matthews Terminal:

1. **Must have:** Stop command, activity feed, authentication on bridge
2. **Should have:** Destructive action confirmation, file access deny-list, one-agent-per-directory rule
3. **Nice to have:** Permission levels, cost tracking, dry run mode, budget limits
4. **Future:** Full audit logging, team access controls, role-based permissions

## The Bottom Line

The power of agents IS the risk. You can't have an agent that does real work without giving it the ability to do real damage. The goal isn't to eliminate risk — it's to make sure you're always in control and you can always stop things. The phone-based command centre actually helps here because you get real-time visibility into what every agent is doing, and you can kill any of them instantly with your voice.
