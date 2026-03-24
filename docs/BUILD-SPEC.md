# Matthews Terminal — Build Spec

> A voice-controlled VS Code assistant.
> Speak from your phone. Control your laptop. Hear the results.

---

## Table of Contents

1. [Core Idea](#1-core-idea)
2. [First Version Scope](#2-first-version-scope)
3. [Architecture](#3-architecture)
4. [Basic Flow](#4-basic-flow)
5. [Agent Behavior](#5-agent-behavior)
6. [Phone App Layout](#6-phone-app-layout)
7. [Speech Setup](#7-speech-setup)
8. [Laptop Bridge State](#8-laptop-bridge-state)
9. [VS Code Extension Actions](#9-vs-code-extension-actions)
10. [First Milestone](#10-first-milestone)
11. [What Not to Build Yet](#11-what-not-to-build-yet)
12. [Terminal Naming](#12-terminal-naming)
13. [Naming Convention](#13-naming-convention)
14. [Build Order](#14-build-order)
15. [Mental Model](#15-mental-model)

---

## 1. Core Idea

This is **not** a full VS Code mirror on your phone.

It is a **remote control + activity feed**.

From your phone you can:

- Press a speak button
- Talk naturally
- Send a command to your laptop
- See what the assistant is doing
- Hear a spoken summary back

On your laptop, VS Code remains the real workspace where all work happens.

---

## 2. First Version Scope

Keep it extremely simple. Only support:

| Feature              | Supported |
| -------------------- | --------- |
| One VS Code workspace | Yes       |
| One agent terminal    | Yes       |
| One active repo       | Yes       |
| One voice command flow | Yes      |
| One response feed     | Yes       |

**Do not build first:**

- Multi-agent support
- Complex native iPhone app
- Full VS Code UI recreation on mobile

Build the smallest possible version that works end to end.

---

## 3. Architecture

Four pieces make up the system:

```
┌─────────────┐     ┌─────────────────┐     ┌────────────────────┐     ┌──────────────┐
│  A. Web App  │────▶│  B. Laptop      │────▶│  C. VS Code        │────▶│  D. Terminal  │
│  (Phone)     │◀────│     Bridge      │◀────│     Extension      │◀────│  (Worker)    │
└─────────────┘     └─────────────────┘     └────────────────────┘     └──────────────┘
```

### A. Web App (Phone)

The interface. A simple website that:

- Works nicely on iPhone
- Is saveable to home screen (PWA)
- Has a big speak button
- Shows transcript, status updates, and returned output
- Optionally speaks the result back

**UI:** Animated AI Chat component (21st.dev/jatin-yadav05) — glass-morphism + Framer Motion.
**Stack:** React (Next.js or Vite), shadcn/ui, Tailwind CSS.
**Hosting:** Render or similar simple cloud host.

### B. Laptop Bridge Server

Runs on your laptop while VS Code is open. It:

- Receives commands from the web app
- Knows which repo and VS Code session is active
- Sends commands into VS Code
- Receives output and status back from VS Code
- Returns output to the web app

This is the middle layer between phone and VS Code.

### C. VS Code Extension

The part inside VS Code that controls the editor and terminal. It:

- Receives commands from the laptop bridge
- Creates or attaches to the correct terminal
- Sends text into the terminal
- Optionally opens files, reads current file or selection
- Optionally shows diagnostics and recent output
- Sends status and output back to the bridge

This is the cleanest approach — the app talks to your own extension, not private internals of Claude or Codex.

### D. Agent Terminal

The actual terminal tab where the coding agent runs. Claude Code, Codex, or normal shell commands live here. The assistant targets this terminal consistently.

---

## 4. Basic Flow

```
1.  Open the web app on your phone
2.  Press speak
3.  Say something like "run tests" or "ask Claude to explain this file"
4.  Web app converts speech to text
5.  Web app sends the command to the laptop bridge
6.  Laptop bridge sends it to the VS Code extension
7.  Extension routes it to the correct terminal or editor action
8.  VS Code performs the task
9.  Output is captured
10. Output is returned through the bridge
11. Web app displays the result
12. Web app optionally reads the result aloud
```

---

## 5. Agent Behavior

The assistant acts like a **voice remote for VS Code**. It can:

- Send text into the active agent terminal
- Run terminal commands
- Open a file
- Read the current file name
- Summarize what just happened
- Report whether a command succeeded or failed
- Report what the agent is doing right now

**First version output** — keep it simple:

| Field   | Example                              |
| ------- | ------------------------------------ |
| Status  | Running / Complete / Failed          |
| Output  | "14 passed, 2 failed"               |
| Summary | "Tests completed. 14 passed, 2 failed." |

**Example interaction:**

> **You say:** "Run tests"
> **Response:** "Running tests in the agent terminal now."
> **Then:** "Tests completed. 14 passed, 2 failed."

---

## 6. Phone App Layout

### UI Component

Using the **Animated AI Chat** component from 21st.dev (by jatin-yadav05).

- **Style:** Glass-morphism design with smooth animations
- **Stack:** React + Framer Motion
- **Install:** `npx shadcn@latest add https://21st.dev/r/jatin-yadav05/animated-ai-chat`
- **Import:** `import { AnimatedAIChat } from "@/components/ui/animated-ai-chat"`

This gives us a polished chat-style interface out of the box. We adapt it to be the voice control dashboard:

- The chat input area becomes the **voice input** (speak button + transcript)
- Chat bubbles show **commands sent** and **responses received**
- Status indicators show **current task state**
- Glass-morphism look works great as a sleek mobile control panel

### Layout

```
┌────────────────────────────────┐
│  ┌──────────────────────────┐  │
│  │   Glass-morphism header  │  │
│  │   Matthews Terminal      │  │
│  │   ● Connected            │  │
│  └──────────────────────────┘  │
│                                │
│  ┌──────────────────────────┐  │
│  │  Chat / Activity Feed    │  │
│  │  ─────────────────────── │  │
│  │  You: "run tests"        │  │
│  │  MT: Running tests...    │  │
│  │  MT: 14 passed, 2 failed │  │
│  │                          │  │
│  │  You: "open index.ts"    │  │
│  │  MT: Opened index.ts     │  │
│  └──────────────────────────┘  │
│                                │
│  ┌──────────────────────────┐  │
│  │  🎤  Speak    [ ⏵ TTS ] │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

The chat-style feed replaces separate sections — everything flows naturally as a conversation between you and your terminal.

---

## 7. Speech Setup

Keep it simple for version one.

| Direction       | Method            |
| --------------- | ----------------- |
| Voice → Text    | Web Speech API or cloud STT |
| Text → Voice    | Web Speech API or cloud TTS |

**Flow:**

```
Your speech → text → sent to laptop → laptop returns result → result spoken back
```

Do not overcomplicate the voice layer at the start.

---

## 8. Laptop Bridge State

The bridge server maintains a simple state object:

```json
{
  "activeWorkspace": "/path/to/project",
  "activeRepo": "my-repo",
  "activeTerminal": "VOICE AGENT",
  "lastCommand": "npm test",
  "currentTaskStatus": "complete",
  "lastOutputSummary": "14 passed, 2 failed"
}
```

When you ask "what is it doing?" the bridge can answer properly.

---

## 9. VS Code Extension Actions

First version actions only:

| Action                    | Description                        |
| ------------------------- | ---------------------------------- |
| `getWorkspaceInfo`        | Get active workspace info          |
| `findOrCreateTerminal`    | Create or find the named terminal  |
| `sendToTerminal`          | Send text to the terminal          |
| `readTerminalOutput`      | Read terminal output if possible   |
| `openFile`                | Open a file by path                |
| `getActiveFileName`       | Get current file name              |
| `sendStatus`              | Send status updates to the bridge  |

Do not try to do everything at once.

---

## 10. First Milestone

The first milestone is this exact sequence working:

- [x] Web app opens on phone
- [ ] Speak a command
- [ ] Text reaches laptop
- [ ] VS Code extension receives it
- [ ] Extension sends it to one named terminal
- [ ] Terminal runs it
- [ ] Result comes back
- [ ] Phone displays result
- [ ] Phone speaks result

**If that works, the whole concept works.**

---

## 11. What Not to Build Yet

| Feature                          | Status     |
| -------------------------------- | ---------- |
| Multiple agents                  | Not yet    |
| Multiple repos                   | Not yet    |
| Perfect live streaming           | Not yet    |
| Full VS Code mirroring           | Not yet    |
| Fancy authentication             | Not yet    |
| Advanced memory                  | Not yet    |
| Perfect interruption handling    | Not yet    |
| Huge dashboard                   | Not yet    |

Just get one clean voice-to-terminal pipeline working first.

---

## 12. Terminal Naming

Use something obvious and stable.

| Option               | Best For                      |
| -------------------- | ----------------------------- |
| `VOICE AGENT`        | Simple, clear, model-agnostic |
| `JARVIS`             | Cooler feel                   |
| `PRAXIS VOICE AGENT` | Project-specific              |

**Recommended for v1:** `VOICE AGENT`

Why: simple, clear, easy to search for, works even if you change models later.

---

## 13. Naming Convention

| Component          | Name                    |
| ------------------ | ----------------------- |
| Web app            | Voice Control           |
| Bridge server      | voice-bridge            |
| VS Code extension  | Voice Bridge Extension  |
| Main terminal      | VOICE AGENT             |

---

## 14. Build Order

Build in this order:

```
1. Simple mobile-friendly web app
2. Laptop bridge server
3. VS Code extension
4. Named terminal creation and command sending
5. Result feed back to the web app
6. Optional speech back
```

First version only supports one workspace and one terminal.

---

## 15. Mental Model

```
Phone                = Microphone + Control Panel
Laptop Bridge        = Messenger
VS Code Extension    = Controller
Terminal             = Worker
Web App Response     = Spoken Report Back
```

---

*Matthews Terminal — v1 Build Spec*
