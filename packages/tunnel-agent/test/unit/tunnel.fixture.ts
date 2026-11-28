/**
 * @fileoverview The relay in memory, and a state folder, for the rows of the registration and of the commands over it.
 */

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {RelayError, RelayTunnel, TunnelService} from '../../src/relay.ts';

/** A relay in memory: the tunnels it holds, the calls it heard, and the failures it is told to give. */
export class MemoryRelay implements TunnelService {
  readonly tunnels = new Map<string, RelayTunnel>();
  readonly calls: string[] = [];
  /** The next calls of each kind that fail, with the relay's text. */
  readonly failures = new Map<string, RelayError | Error>();
  private count = 0;

  /** The tunnel `tunnelId`, when it is held. */
  get(tunnelId: string): Promise<RelayTunnel | undefined> {
    this.calls.push(`get ${tunnelId}`);
    return this.answer('get', () => this.tunnels.get(tunnelId));
  }

  /** A tunnel of its own id for `name`. */
  create(name: string): Promise<RelayTunnel> {
    this.count += 1;
    const tunnel: RelayTunnel = {
      tunnelId: `tunnel${String(this.count)}`,
      clusterId: 'cluster',
      name,
      ports: [],
    };
    this.calls.push(`create ${name}`);
    return this.answer('create', () => {
      this.tunnels.set(tunnel.tunnelId, tunnel);
      return tunnel;
    });
  }

  /** Renames the tunnel. */
  rename(tunnelId: string, clusterId: string, name: string): Promise<void> {
    this.calls.push(`rename ${tunnelId} ${name}`);
    return this.answer('rename', () => {
      const held = this.tunnels.get(tunnelId);
      if (held !== undefined) {
        this.tunnels.set(tunnelId, {...held, name});
      }
    });
  }

  /** Deletes the tunnel; whether it was held. */
  delete(tunnelId: string): Promise<boolean> {
    this.calls.push(`delete ${tunnelId}`);
    return this.answer('delete', () => this.tunnels.delete(tunnelId));
  }

  /** Adds `port` to the tunnel. */
  addPort(tunnelId: string, clusterId: string, port: number): Promise<void> {
    this.calls.push(`addPort ${tunnelId} ${String(port)}`);
    return this.answer('addPort', () => {
      const held = this.tunnels.get(tunnelId);
      if (held !== undefined) {
        this.tunnels.set(tunnelId, {...held, ports: [...held.ports, port]});
      }
    });
  }

  /** The answer of the call `kind`: its failure when one is set, else `work`'s result. */
  private answer<Result>(kind: string, work: () => Result): Promise<Result> {
    const failure = this.failures.get(kind);
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    return Promise.resolve(work());
  }
}

/** A state folder in a folder of its own, and the lines said to the user. */
export function worldOf(): {
  folder: string;
  said: string[];
  relay: MemoryRelay;
  end(): void;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-tunnel-'));
  return {
    folder: path.join(root, 'state'),
    said: [],
    relay: new MemoryRelay(),
    end: () => {
      rmSync(root, {recursive: true, force: true});
    },
  };
}
