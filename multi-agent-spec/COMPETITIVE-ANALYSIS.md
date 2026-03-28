# Competitive Analysis — March 2026

## The Question: Does anyone have voice-controlled multi-agent coding orchestration?

**Answer: No.**

---

## Full Breakdown

### Multi-Agent Tools (No Voice)

| Tool | Multi-Agent | Cross-Project | Voice Input | Voice Output | Phone Remote |
|------|-------------|---------------|-------------|--------------|--------------|
| Superset | Yes (10+) | Yes (worktrees) | No | No | No |
| Claude Code Agent Teams | Yes | Same project | No | No | No |
| Claude Squad | Yes | Yes (tmux) | No | No | No |
| Claude MPM | Yes (47 agents) | Yes | No | No | No |
| JetBrains Air | Yes | Yes (Docker) | No | No | No |
| Codex App | Yes | Yes | No | No | No |
| Cursor 2.0 | Yes (8 agents) | Same repo | No | No | No |
| GitHub Copilot Squad | Yes | Same repo | No | No | No |
| Composio Agent Orchestrator | Yes | Yes (worktrees) | No | No | No |
| Intent (Augment Code) | Yes | Yes (cross-repo) | No | No | No |

### Voice-Capable Tools (Single Session)

| Tool | Multi-Agent | Voice Input | Voice Output | Phone Remote |
|------|-------------|-------------|--------------|--------------|
| Claude Code /voice | No (single) | Yes (spacebar) | No | No |
| OpenAI Codex CLI | No (single) | Yes (spacebar) | No | No |
| Cursor | No (single) | Yes (basic) | No | No |
| Gemini CLI (RFC) | No (single) | Proposed | Proposed | No |
| Agent Voice (community) | No (single) | Yes | Yes (Azure) | No |

### Matthews Terminal (Current)

| Feature | Status |
|---------|--------|
| Voice Input | Yes (Web Speech API from phone) |
| Voice Output (TTS) | Yes (Groq/OpenAI TTS) |
| Phone Remote | Yes (PWA on home screen) |
| Real-time Tool Status | Yes |
| Multi-Agent | Not yet |
| Cross-Project | Not yet |

### Matthews Terminal (With Multi-Agent)

| Feature | Status |
|---------|--------|
| Voice Input | Yes |
| Voice Output (TTS) | Yes |
| Phone Remote | Yes |
| Real-time Tool Status | Yes |
| Multi-Agent | Yes |
| Cross-Project | Yes |
| **Combined** | **Only product with all of these** |

---

## Key Insight

The market has split into two camps:
1. **Multi-agent tools** — powerful but keyboard/screen only
2. **Voice tools** — convenient but single-session only

Nobody has combined them. Matthews Terminal with multi-agent support would be the first product to bridge both camps.

---

## Risk: Big Players Moving Fast

- Claude Code shipped voice input March 3, 2026
- Google Gemini CLI has an active RFC for bidirectional voice
- OpenAI added voice to Codex CLI
- Cursor added voice-to-text

The window is open now. Voice output (talk-back) and multi-agent voice orchestration are not on any public roadmap. But these companies move fast. First-mover advantage matters.

---

## Sources

- Superset: https://superset.sh/ / https://github.com/superset-sh/superset
- Claude Code Agent Teams: https://code.claude.com/docs/en/agent-teams
- Claude Squad: https://github.com/smtg-ai/claude-squad
- Claude MPM: https://github.com/bobmatnyc/claude-mpm
- JetBrains Air: https://air.dev/
- Codex App: https://openai.com/codex/
- Cursor 2.0: https://cursor.com/changelog/2-0
- GitHub Copilot Squad: https://github.blog/ai-and-ml/github-copilot/how-squad-runs-coordinated-ai-agents-inside-your-repository/
- Composio Agent Orchestrator: https://github.com/ComposioHQ/agent-orchestrator
- Intent (Augment Code): https://www.augmentcode.com/product/intent
- Claude Code Voice: https://techcrunch.com/2026/03/03/claude-code-rolls-out-a-voice-mode-capability/
- Gemini CLI Voice RFC: https://github.com/google-gemini/gemini-cli/issues/21869
- Agent Voice: https://github.com/PlagueHO/agent-voice
- Voice AI Market: https://voiceaiwrapper.com/insights/voice-ai-market-analysis-trends-growth-opportunities
