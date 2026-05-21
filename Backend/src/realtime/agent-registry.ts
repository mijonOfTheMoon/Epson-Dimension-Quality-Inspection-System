import type { WebSocket } from 'ws';
import type { DimensionSpec } from '../domain/types.js';

export interface AgentConnection {
  stationId: string;
  socket: WebSocket;
  connectedAt: string;
  running: boolean;
}

export interface AgentInfo {
  stationId: string;
  online: boolean;
  running: boolean;
  connectedAt: string | null;
}

export type AgentCommandType = 'start' | 'stop' | 'capture' | 'recalibrate';

export interface AgentPartPayload {
  partId: string;
  partCode: string;
  partName: string;
  vendor?: string;
  dimensions: DimensionSpec[];
}

export interface AgentCommand {
  type: AgentCommandType;
  part?: AgentPartPayload;
  operator?: { id: string; name: string };
  shift?: 'A' | 'B' | 'C';
  batchNo?: string;
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentConnection>();

  register(stationId: string, socket: WebSocket): AgentConnection {
    const existing = this.agents.get(stationId);
    if (existing) {
      try { existing.socket.close(4001, 'replaced'); } catch { /* ignore */ }
    }
    const connection: AgentConnection = {
      stationId,
      socket,
      connectedAt: new Date().toISOString(),
      running: false,
    };
    this.agents.set(stationId, connection);
    return connection;
  }

  unregister(stationId: string, socket: WebSocket): boolean {
    const current = this.agents.get(stationId);
    if (current && current.socket === socket) {
      this.agents.delete(stationId);
      return true;
    }
    return false;
  }

  get(stationId: string): AgentConnection | undefined {
    return this.agents.get(stationId);
  }

  setRunning(stationId: string, running: boolean) {
    const agent = this.agents.get(stationId);
    if (agent) agent.running = running;
  }

  send(stationId: string, command: AgentCommand): boolean {
    const agent = this.agents.get(stationId);
    if (!agent || agent.socket.readyState !== 1) return false;
    agent.socket.send(JSON.stringify(command));
    return true;
  }

  list(): AgentInfo[] {
    return [...this.agents.values()].map((a) => ({
      stationId: a.stationId,
      online: a.socket.readyState === 1,
      running: a.running,
      connectedAt: a.connectedAt,
    }));
  }
}
