# Matthews Terminal

A voice-controlled VS Code assistant. Speak from your phone. Control your laptop. Hear the results.

---

## Project Structure

```
matthews-terminal/
│
├── README.md                  ← You are here
│
├── docs/                      ← All documentation
│   └── BUILD-SPEC.md          ← Full build specification
│
├── web-app/                   ← Phone web app (Voice Control)
│   └── (coming soon)
│
├── voice-bridge/              ← Laptop bridge server
│   └── (coming soon)
│
├── vscode-extension/          ← VS Code extension (Voice Bridge Extension)
│   └── (coming soon)
│
└── shared/                    ← Shared types, constants, utilities
    └── (coming soon)
```

## Quick Links

- [Build Spec](docs/BUILD-SPEC.md) — Full specification for the project

## Build Order

1. `web-app/` — Simple mobile-friendly PWA with speak button
2. `voice-bridge/` — Laptop bridge server receiving commands
3. `vscode-extension/` — VS Code extension controlling editor and terminal
4. Wire it all together end to end

## Terminal Name

The agent terminal in VS Code is named: **VOICE AGENT**
