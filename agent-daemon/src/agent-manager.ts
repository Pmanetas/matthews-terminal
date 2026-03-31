/**
 * AgentManager — holds multiple agent instances (Claude or Codex) and routes commands to them.
 */

import { AgentRunner } from './agent-runner';
import { CodexRunner } from './codex-runner';
import { AgentSink, AgentInfo, AgentStatus, ImageData } from './types';

/** Common interface both AgentRunner and CodexRunner implement */
interface Runner {
    readonly id: string;
    readonly busy: boolean;
    handleCommand(text: string, sink: AgentSink, images?: ImageData[]): Promise<void>;
    abortCommand(sink: AgentSink): void;
    dispose(): void;
}

export class AgentManager {
    private agents = new Map<string, { runner: Runner; info: AgentInfo }>();
    private nextId = 1;
    private sinkFactory: (agentId: string) => AgentSink;

    constructor(sinkFactory: (agentId: string) => AgentSink) {
        this.sinkFactory = sinkFactory;
    }

    spawnAgent(projectDir: string, name: string, engine: 'claude' | 'codex' = 'claude'): AgentInfo {
        const agentId = `agent-${this.nextId++}`;
        const runner: Runner = engine === 'codex'
            ? new CodexRunner(agentId, projectDir)
            : new AgentRunner(agentId, projectDir);
        const info: AgentInfo = { agentId, name, projectDir, engine, status: 'idle' };
        this.agents.set(agentId, { runner, info });
        console.log(`[AgentManager] Spawned ${agentId} (${name}) in ${projectDir} [${engine}]`);
        return info;
    }

    killAgent(agentId: string): boolean {
        const entry = this.agents.get(agentId);
        if (!entry) return false;

        const sink = this.sinkFactory(agentId);
        entry.runner.abortCommand(sink);
        entry.runner.dispose();
        this.agents.delete(agentId);
        console.log(`[AgentManager] Killed ${agentId} (${entry.info.name})`);
        return true;
    }

    async sendCommand(agentId: string, text: string, images?: ImageData[]): Promise<void> {
        const entry = this.agents.get(agentId);
        if (!entry) {
            console.error(`[AgentManager] Agent ${agentId} not found`);
            return;
        }

        const sink = this.sinkFactory(agentId);
        entry.info.status = 'running';
        try {
            await entry.runner.handleCommand(text, sink, images);
            entry.info.status = 'idle';
        } catch {
            entry.info.status = 'error';
        }
    }

    stopAgent(agentId: string): void {
        const entry = this.agents.get(agentId);
        if (!entry) return;
        const sink = this.sinkFactory(agentId);
        entry.runner.abortCommand(sink);
        entry.info.status = 'idle';
    }

    listAgents(): AgentInfo[] {
        return Array.from(this.agents.values()).map(e => ({
            ...e.info,
            status: e.runner.busy ? 'running' : e.info.status,
        }));
    }

    getAgent(agentId: string): AgentInfo | undefined {
        return this.agents.get(agentId)?.info;
    }

    dispose(): void {
        for (const [id, entry] of this.agents) {
            console.log(`[AgentManager] Cleaning up ${id}`);
            entry.runner.dispose();
        }
        this.agents.clear();
    }
}
