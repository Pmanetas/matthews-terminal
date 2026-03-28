/**
 * Matthews Terminal — Agent Daemon (v0.1.1)
 *
 * Standalone Node.js process that connects to the voice bridge
 * and manages multiple Claude/Codex CLI agents across different projects.
 *
 * Usage:
 *   node dist/index.js                       (uses default bridge URL)
 *   MT_BRIDGE_URL=ws://localhost:4800 node dist/index.js   (local bridge)
 */

import * as fs from 'fs';
import * as path from 'path';
import { BridgeConnection } from './bridge-connection';
import { ProjectRegistry } from './types';

// ── Config ──────────────────────────────────────────────────

const DEFAULT_BRIDGE_URL = 'wss://matthews-terminal.onrender.com';
const BRIDGE_URL = process.env.MT_BRIDGE_URL || DEFAULT_BRIDGE_URL;

// The project to work in — pass as first arg or use env var
const DEFAULT_PROJECT = process.argv[2]
    || process.env.MT_PROJECT_DIR
    || process.cwd();

// Load project registry
const registryPath = path.join(__dirname, '..', 'projects.json');
let registry: ProjectRegistry = { projects: {} };
try {
    if (fs.existsSync(registryPath)) {
        registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    }
} catch (err) {
    console.error('[Daemon] Failed to load projects.json:', err);
}

// ── Start ───────────────────────────────────────────────────

const connection = new BridgeConnection(BRIDGE_URL, DEFAULT_PROJECT);

// Intercept ALL terminal output and forward to bridge for phone terminal viewer
const origLog = console.log.bind(console);
const origError = console.error.bind(console);
const origWarn = console.warn.bind(console);
const origStdoutWrite = process.stdout.write.bind(process.stdout);

function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Buffer for stdout.write chunks (Claude streams character by character)
let stdoutBuffer = '';
let stdoutFlushTimer: ReturnType<typeof setTimeout> | undefined;

function flushStdoutBuffer() {
    if (stdoutBuffer.trim()) {
        connection.sendLog(stripAnsi(stdoutBuffer));
    }
    stdoutBuffer = '';
    stdoutFlushTimer = undefined;
}

// Capture process.stdout.write — this is where Claude's streaming text goes
process.stdout.write = (chunk: any, ...rest: any[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString();
    stdoutBuffer += text;
    // Flush after 200ms of no new writes, or if buffer has a newline
    if (stdoutFlushTimer) clearTimeout(stdoutFlushTimer);
    if (text.includes('\n')) {
        flushStdoutBuffer();
    } else {
        stdoutFlushTimer = setTimeout(flushStdoutBuffer, 200);
    }
    return origStdoutWrite(chunk, ...rest as any);
};

console.log = (...args: any[]) => {
    origLog(...args);
    const text = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
    connection.sendLog(stripAnsi(text));
};

console.error = (...args: any[]) => {
    origError(...args);
    const text = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
    connection.sendLog(`ERROR: ${stripAnsi(text)}`);
};

console.warn = (...args: any[]) => {
    origWarn(...args);
    const text = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
    connection.sendLog(`WARN: ${stripAnsi(text)}`);
};

console.log('');
console.log('  \x1b[36mMatthews Terminal — Agent Daemon\x1b[0m');
console.log('  ────────────────────────────────');
console.log(`  Bridge:  ${BRIDGE_URL}`);
console.log(`  Project: ${DEFAULT_PROJECT}`);
if (Object.keys(registry.projects).length > 0) {
    console.log(`  Registry:`);
    for (const [name, dir] of Object.entries(registry.projects)) {
        console.log(`    ${name} → ${dir}`);
    }
}
console.log('');
console.log('  Connecting to bridge...');
console.log('');

connection.connect();

// ── Auto-restart on rebuild ─────────────────────────────────
// Watch dist/ for changes so daemon picks up new code automatically

const distDir = path.join(__dirname);
let restartDebounce: ReturnType<typeof setTimeout> | undefined;

fs.watch(distDir, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith('.js')) return;
    if (restartDebounce) clearTimeout(restartDebounce);
    restartDebounce = setTimeout(() => {
        console.log(`\x1b[33m[Daemon] Code changed (${filename}) — auto-restarting...\x1b[0m`);
        connection.dispose();
        // Re-exec the same process with the same args
        // detached: true + unref() so child survives parent exit on Windows
        const { spawn: spawnChild } = require('child_process');
        // Quote all args to handle spaces in paths (e.g. "Program Files", "Matthews Terminal")
        const quotedArgs = process.argv.slice(1).map((a: string) => `"${a}"`).join(' ');
        const cmd = `"${process.argv[0]}" ${quotedArgs}`;
        const child = spawnChild(cmd, [], {
            stdio: 'inherit',
            shell: true,
            detached: false, // stay in same terminal window on Windows
        });
        child.on('error', (err: any) => {
            origError('[Daemon] Failed to restart:', err.message);
        });
        // Give child a moment to start, then exit old process
        setTimeout(() => process.exit(0), 1000);
    }, 1500); // 1.5s debounce to let tsc finish writing all files
});

console.log('  \x1b[90m[Auto-restart enabled — watching dist/ for changes]\x1b[0m');

// ── Graceful shutdown ───────────────────────────────────────

function shutdown() {
    console.log('\n[Daemon] Shutting down...');
    connection.dispose();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// On Windows, handle Ctrl+C properly
if (process.platform === 'win32') {
    process.on('SIGHUP', shutdown);
}
