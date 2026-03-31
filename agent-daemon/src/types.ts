// ── Agent Sink ──────────────────────────────────────────────
// The interface each AgentRunner uses to send messages back to the bridge.
// Every message is tagged with agentId by the implementation.

export interface AgentSink {
    sendStatus(text: string): void;
    sendToolStatus(text: string): void;
    sendResult(text: string): void;
    sendSpeak(text: string): void;
    sendNarration(text: string): void;
    sendNewSession(): void;
    sendWorkspace(dir: string): void;
}

// ── Image Data ──────────────────────────────────────────────

export interface ImageData {
    data: string;       // base64
    mimeType: string;
    name?: string;
}

// ── Agent State ─────────────────────────────────────────────

export type AgentStatus = 'idle' | 'running' | 'complete' | 'error';

export interface AgentInfo {
    agentId: string;
    name: string;
    projectDir: string;
    engine: 'claude' | 'codex';
    status: AgentStatus;
}

// ── Messages between daemon and bridge ──────────────────────

export type DaemonMessage =
    | { type: 'identify'; client: 'daemon' }
    | { type: 'agent_spawned'; agentId: string; name: string; projectDir: string; engine: string }
    | { type: 'agent_killed'; agentId: string }
    | { type: 'agent_list'; agents: AgentInfo[] }
    | { type: 'status'; agentId: string; text: string }
    | { type: 'tool_status'; agentId: string; text: string }
    | { type: 'result'; agentId: string; text: string; engine?: string }
    | { type: 'speak'; agentId: string; text: string; engine?: string }
    | { type: 'narration'; agentId: string; text: string; engine?: string }
    | { type: 'new_session'; agentId: string };

export type BridgeCommand =
    | { type: 'spawn_agent'; agentId: string; name: string; projectDir: string; engine?: 'claude' | 'codex' }
    | { type: 'kill_agent'; agentId: string }
    | { type: 'command'; agentId: string; text: string; images?: ImageData[] }
    | { type: 'stop'; agentId: string }
    | { type: 'list_agents' };

// ── Project Registry ────────────────────────────────────────

export interface ProjectRegistry {
    projects: Record<string, string>;   // friendly name → absolute directory path
}
