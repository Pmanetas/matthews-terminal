# Development Workflow and Pain Points

## Current Workflow (VS Code Extension)

This is how Matthew currently develops and tests Matthews Terminal:

1. Open Matthews Terminal project in VS Code
2. Make code changes to the extension, bridge, or web app
3. Rebuild the extension (`npm run build` in vscode-extension/)
4. Package a new .vsix file (`npx vsce package`)
5. Install the .vsix in VS Code (Extensions → Install from VSIX)
6. Reload VS Code window (Ctrl+Shift+P → "Reload Window")
7. Run "Matthews Terminal: Connect to Voice Bridge"
8. Open the web app on phone to test
9. If something's wrong, go back to step 2

**Problems with this loop:**
- Rebuilding and reinstalling the extension every time is slow
- Sometimes VS Code caches the old extension and you have to fully restart
- Sometimes it creates duplicate extension versions
- Reloading VS Code kills all terminals including any Claude sessions
- The feedback loop is too long for small tweaks

## Better Development Approach (Extension Dev Mode)

Instead of packaging and installing the .vsix every time, use VS Code's extension development host:

1. Open the vscode-extension/ folder in VS Code
2. Press F5 — this opens a NEW VS Code window with the extension loaded from source
3. Make changes to the code
4. Press Ctrl+Shift+F5 to restart the extension host (way faster than full reload)
5. The extension reloads with your changes — no .vsix packaging needed

This is the standard way to develop VS Code extensions. The "Extension Development Host" window runs your extension directly from the source code, so every time you restart it picks up your latest changes instantly.

**To set this up**, make sure vscode-extension/.vscode/launch.json has:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

And a .vscode/tasks.json with a watch mode:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "label": "npm: watch",
      "isBackground": true,
      "problemMatcher": "$esbuild-watch"
    }
  ]
}
```

With watch mode running, your code recompiles automatically when you save. Then just Ctrl+Shift+F5 in the dev host to reload.

## Even Better: The Standalone Daemon (Future)

Once the agent daemon is built (see BUILD-PLAN.md), the development loop gets way simpler:

1. Make changes to agent-daemon/ code
2. Stop the daemon process (Ctrl+C)
3. Rebuild (`npm run build`)
4. Start it again (`node dist/index.js`)
5. Phone reconnects automatically via bridge

No VS Code reload needed. No .vsix packaging. No extension host. Just a regular Node process that you restart. This is one of the big advantages of moving to a standalone daemon.

For even faster iteration, use `tsx watch src/index.ts` (TypeScript execute with watch mode) — it auto-restarts the daemon when you save any file. Zero manual steps.

## Testing Workflow

### Testing the voice pipeline:
1. Daemon running on laptop (or extension in dev host)
2. Bridge server running (on Render or locally with `npm run dev` in voice-bridge/)
3. Web app open on phone (or locally at localhost:5173)
4. Speak a command → see it flow through the whole system

### Testing locally (no Render):
1. Run bridge locally: `cd voice-bridge && npm run dev` (runs on localhost:4800)
2. Run daemon pointing to local bridge: set bridge URL to `ws://localhost:4800`
3. Open web app locally: `cd web-app && npm run dev` (runs on localhost:5173)
4. Everything runs on your machine, no cloud dependency

### Testing the phone app:
- For local testing on phone, use your laptop's local IP (e.g., `http://192.168.1.x:5173`)
- Or deploy web app to Render and test against the cloud bridge

## Matthew's Preferred Test Setup

Matthew uses a separate project repo (currently "Matthews app test" on Desktop) as a test target for the voice agent. He tells the agent to make changes to that repo to verify the voice pipeline is working correctly. This keeps test experiments separate from the Matthews Terminal source code.

When testing:
1. Matthews Terminal code is open in one VS Code window (for development)
2. The test project gets modified by the voice agent (to verify it works)
3. Changes to the test project don't matter — it's a sandbox

With multi-agent support, this test setup becomes even more useful — you can have one agent working on Matthews Terminal itself and another agent on the test project, verifying both sides simultaneously.
