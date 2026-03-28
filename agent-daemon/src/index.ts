/**
 * Matthews Terminal — Agent Daemon
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
