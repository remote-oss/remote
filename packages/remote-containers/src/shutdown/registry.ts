/**
 * @fileoverview The registry of the shutdown helper: the connections that windows have told it about, and what each
 * one's end owes its container. A connection ends once, by a leave or by the close of the lease that registered it;
 * ten seconds later the container is stopped when no other live connection uses it. A connection that ends before its
 * container is known looks the container up by its labels instead. Everything the helper does is on its own log, and
 * nothing is shown.
 */

import type {
  ContainerIdentity,
  EngineCoordinates,
  ShutdownReply,
  ShutdownRequest,
} from './protocol.ts';

/** How long the check waits after a connection ends, in milliseconds: fixed, not a setting. */
export const CHECK_MILLISECONDS = 10_000;

/** How many times a lookup for a container that was not known looks, ten seconds apart: 120 seconds in all. */
export const LOOKUP_ATTEMPTS = 12;

/** What a `docker` run gave: its exit status, undefined when it could not start, and its standard output. */
export interface DockerResult {
  status: number | undefined;
  stdout: string;
}

/** What the registry needs of the world; the program passes the real ones and the rows fake ones. */
export interface RegistryPorts {
  /** Runs `docker` with `argv` against the engine; it always resolves. */
  runDocker(
    engine: EngineCoordinates,
    argv: readonly string[],
  ): Promise<DockerResult>;
  /** Runs `callback` once after `milliseconds`; the result cancels it. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  logLine(line: string): void;
}

/** The registry's decisions; each request method answers as the helper replies. */
export interface ShutdownRegistry {
  /** Records the connection `request` names, held by lease `leaseId`. */
  register(
    leaseId: number,
    request: Extract<ShutdownRequest, {type: 'register'}>,
  ): ShutdownReply;
  /** Records the container of a connection and the action its recorded value gives. */
  setContainer(
    request: Extract<ShutdownRequest, {type: 'container'}>,
  ): ShutdownReply;
  /** Ends the connection: the window left its container without the lease closing. */
  leave(request: Extract<ShutdownRequest, {type: 'leave'}>): ShutdownReply;
  /** Ends every live connection whose lease is not among `liveLeases`. */
  leasesChanged(liveLeases: readonly number[]): void;
  /** Resolves when no check or lookup is pending. */
  drain(): Promise<void>;
}

/** What the registry knows of one connection. */
interface Connection {
  leaseId: number;
  identity: ContainerIdentity;
  engine: EngineCoordinates;
  containerId: string | undefined;
  action: 'stop' | 'none' | undefined;
  live: boolean;
}

/** The registry over `ports`. */
export function createShutdownRegistry(ports: RegistryPorts): ShutdownRegistry {
  const connections = new Map<string, Connection>();
  const pending = new Set<Promise<void>>();
  const unknown: ShutdownReply = {
    accepted: false,
    problem: 'unknown connection',
  };

  /** Runs `work` after `milliseconds`, and keeps it pending until it is done. */
  function later(
    milliseconds: number,
    work: () => Promise<void>,
  ): Promise<void> {
    const obligation = new Promise<void>(resolve => {
      ports.setTimer(milliseconds, () => {
        void work().then(resolve);
      });
    });
    pending.add(obligation);
    void obligation.then(() => {
      pending.delete(obligation);
    });
    return obligation;
  }

  /** Whether another live connection holds the container: by its id, or by the folder and configuration it is for. */
  function inUse(connection: Connection, containerId: string): boolean {
    return [...connections.values()].some(
      other =>
        other !== connection &&
        other.live &&
        (other.containerId === containerId ||
          (other.identity.hostPath === connection.identity.hostPath &&
            other.identity.configFile === connection.identity.configFile)),
    );
  }

  /** Stops the container unless another live connection holds it. */
  async function stopUnused(
    connection: Connection,
    containerId: string,
  ): Promise<void> {
    if (inUse(connection, containerId)) {
      ports.logLine(`container ${containerId} is in use and stays running`);
      return;
    }
    const result = await ports.runDocker(connection.engine, [
      'stop',
      containerId,
    ]);
    if (result.status !== 0) {
      ports.logLine(
        `docker stop ${containerId} failed with status ${String(result.status)}`,
      );
    }
  }

  /** Looks for the running container of the connection's folder and configuration; looks again until it gives up. */
  async function lookUp(
    connection: Connection,
    attempt: number,
  ): Promise<void> {
    const {hostPath, configFile} = connection.identity;
    const result = await ports.runDocker(connection.engine, [
      'ps',
      '-q',
      '--filter',
      `label=devcontainer.local_folder=${hostPath}`,
      '--filter',
      `label=devcontainer.config_file=${configFile}`,
    ]);
    if (result.status !== 0) {
      ports.logLine(
        `docker ps failed with status ${String(result.status)}; the lookup ends`,
      );
      return;
    }
    const [found] = result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '');
    if (found !== undefined) {
      await stopUnused(connection, found);
      return;
    }
    if (attempt >= LOOKUP_ATTEMPTS) {
      ports.logLine(`no running container for ${hostPath}; the lookup ends`);
      return;
    }
    await later(CHECK_MILLISECONDS, () => lookUp(connection, attempt + 1));
  }

  /** Ends a live connection, once, and schedules what its end owes. */
  function end(connection: Connection): void {
    if (!connection.live) {
      return;
    }
    connection.live = false;
    if (connection.action === 'none') {
      return;
    }
    const {containerId} = connection;
    void later(CHECK_MILLISECONDS, () =>
      containerId === undefined
        ? lookUp(connection, 1)
        : stopUnused(connection, containerId),
    );
  }

  return {
    register: (leaseId, request) => {
      if (connections.has(request.connectionId)) {
        return {accepted: false, problem: 'connection already registered'};
      }
      connections.set(request.connectionId, {
        leaseId,
        identity: request.identity,
        engine: request.engine,
        containerId: undefined,
        action: undefined,
        live: true,
      });
      return {accepted: true};
    },
    setContainer: request => {
      const connection = connections.get(request.connectionId);
      if (connection === undefined) {
        return unknown;
      }
      connection.containerId = request.containerId;
      connection.action = request.action;
      return {accepted: true};
    },
    leave: request => {
      const connection = connections.get(request.connectionId);
      if (connection === undefined) {
        return unknown;
      }
      end(connection);
      return {accepted: true};
    },
    leasesChanged: liveLeases => {
      for (const connection of connections.values()) {
        if (!liveLeases.includes(connection.leaseId)) {
          end(connection);
        }
      }
    },
    drain: async () => {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}
