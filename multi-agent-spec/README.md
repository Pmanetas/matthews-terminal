# Multi-Agent Spec — Drop into Matthews Terminal

This folder contains the complete spec for extending Matthews Terminal from a single-session voice remote into a multi-agent voice orchestrator.

## Files

- **VISION.md** — What we're building, why it matters, the market gap
- **ARCHITECTURE.md** — How the system works, component responsibilities, message flows
- **BUILD-PLAN.md** — Five-phase build plan with specific files, code changes, and known challenges
- **COMPETITIVE-ANALYSIS.md** — Every competitor analysed with feature comparison tables and sources
- **MULTI-ENGINE-AGENTS.md** — Running Claude AND Codex agents side by side, engine-agnostic architecture
- **RISKS-AND-SAFETY.md** — What can go wrong, security concerns, permission levels, and how to mitigate everything
- **DEV-WORKFLOW.md** — Current dev pain points, faster extension testing, and how the standalone daemon simplifies everything

## How to Use

Copy this entire `multi-agent-spec/` folder into the Matthews Terminal project root. When you start a Claude session in that project, it will have full context on:

1. The vision and market opportunity
2. The exact architecture changes needed
3. The step-by-step build plan
4. What every competitor does and doesn't have

## Context from This Session (2026-03-28)

- Matthew explored the Matthews Terminal codebase and confirmed the MVP is complete and working end-to-end
- Thorough web search confirmed no product exists with voice-controlled multi-agent coding orchestration
- Claude Code's voice mode is input-only (no talk-back) and single-session — Matthews Terminal is already ahead
- 95% of the VS Code extension code is portable to a standalone Node script
- The multi-agent extension is estimated at 5 phases of work
- The VS Code extension should continue to work alongside the new agent daemon
- Matthew wants multi-engine support — agents can run Claude Code OR Codex CLI, picking the right tool for the job
- Codex is stronger at security audits (500+ zero-day finds), DevOps, terminal tasks, and long-running work
- Claude is stronger at frontend, architecture, code quality, and multi-file reasoning
- Architecture should be engine-agnostic — easy to add Gemini CLI or other engines later
