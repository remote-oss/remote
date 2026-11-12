/**
 * @fileoverview Starts a connection's relay host in the container: it writes the script beside the server, runs it with
 * the server's `node` through one long-lived `docker exec -i` as the remote user, and drives its frames until the
 * connection's lease ends. Each kind gets a fresh socket path, which its variable carries to the lifecycle commands and
 * the extension host. With no kind set up, nothing runs.
 */

import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {EngineHost} from '../engine/engine-host.ts';
import {relayHostArguments} from '../exec/exec-arguments.ts';
import {
  installRelayHostScript,
  relayHostScriptPath,
} from './relay-host-script.ts';
import {
  HOST_CONNECT_MILLISECONDS,
  type HostEnd,
  relaySession,
} from './relay-session.ts';

/** A kind of relay a connection sets up: its name on the wire, the variable its socket path goes in, and its host end. */
export interface RelayKind {
  kind: string;
  variable: string;
  connect(cancellation: AbortSignal): Promise<HostEnd>;
}

/** Where the relay host runs, and the kinds it carries. */
export interface RelayHostRequest {
  engine: EngineHost;
  /** The container's channel as the remote user, for writing the script. */
  channel: HostChannel;
  containerId: string;
  remoteUser: string;
  /** The installed server's own `node`. */
  nodePath: string;
  /** The server's data folder, where the script goes. */
  dataFolder: string;
  kinds: readonly RelayKind[];
  cancellation: AbortSignal;
}

/** What the relay host needs of its surroundings. */
export interface RelayHostDependencies {
  logger: Logger;
  /** A fresh random name part for a socket path. */
  randomName(): string;
  /** Calls `callback` after `milliseconds`; the result stops the wait. */
  setTimer(milliseconds: number, callback: () => void): () => void;
}

/** A relay host that runs, or none at all: its variables, and how its lease ends. */
export interface RelayHost {
  variables: Readonly<Record<string, string>>;
  dispose(): void;
}

/** How starting a relay host ended. */
export type RelayHostStart =
  {kind: 'started'; host: RelayHost} | {kind: 'failed'; detail: string};

/** The relay host of a connection with no kind set up: no process, no variables. */
const NO_RELAY_HOST: RelayHost = {
  variables: {},
  dispose: () => undefined,
};

/** The socket path of `kind` for one connection. */
function socketPathOf(kind: string, randomName: string): string {
  return `/tmp/remote-oss-${kind}-${randomName}.sock`;
}

/** Starts the relay host of `request`'s kinds, and waits until its sockets listen, within the connect bound. */
export async function startRelayHost(
  dependencies: RelayHostDependencies,
  request: RelayHostRequest,
): Promise<RelayHostStart> {
  if (request.kinds.length === 0) {
    return {kind: 'started', host: NO_RELAY_HOST};
  }
  const installed = await installRelayHostScript(
    request.channel,
    request.dataFolder,
    request.cancellation,
  );
  if (installed.kind === 'failed') {
    return {kind: 'failed', detail: installed.detail};
  }
  const sockets = request.kinds.map(relay => ({
    relay,
    path: socketPathOf(relay.kind, dependencies.randomName()),
  }));
  const lease = new AbortController();
  const spawned = await request.engine.spawn(
    relayHostArguments(
      request.containerId,
      request.remoteUser,
      request.nodePath,
      relayHostScriptPath(request.dataFolder),
      sockets.map(socket => `${socket.relay.kind}=${socket.path}`),
    ),
    {cancellation: lease.signal},
  );
  if (spawned.kind === 'failed') {
    return {kind: 'failed', detail: spawned.detail};
  }
  const {process} = spawned;
  process.stdin.on('error', () => undefined);
  let tellReady: (listening: boolean) => void;
  const readiness = new Promise<boolean>(resolve => {
    tellReady = resolve;
  });
  const session = relaySession({
    connectors: new Map(
      request.kinds.map(
        relay =>
          [
            relay.kind,
            (cancellation: AbortSignal) => relay.connect(cancellation),
          ] as const,
      ),
    ),
    send: bytes => {
      process.stdin.write(bytes);
    },
    pauseInput: () => {
      process.stdout.pause();
    },
    resumeInput: () => {
      process.stdout.resume();
    },
    endHost: () => {
      lease.abort();
    },
    ready: () => {
      tellReady(true);
    },
    setTimer: (milliseconds, callback) =>
      dependencies.setTimer(milliseconds, callback),
    logLine: line => {
      dependencies.logger.info(line);
    },
  });
  process.stdout.on('data', (chunk: Uint8Array) => {
    session.receive(chunk);
  });
  void process.exited.then(status => {
    tellReady(false);
    session.ended();
    dependencies.logger.info(
      `the relay host's process ended (${status === undefined ? 'signal' : String(status)})`,
    );
  });
  const stopTimer = dependencies.setTimer(HOST_CONNECT_MILLISECONDS, () => {
    tellReady(false);
  });
  function cancelled(): void {
    tellReady(false);
  }
  request.cancellation.addEventListener('abort', cancelled, {once: true});
  if (request.cancellation.aborted) {
    cancelled();
  }
  const listening = await readiness;
  stopTimer();
  request.cancellation.removeEventListener('abort', cancelled);
  if (!listening) {
    lease.abort();
    return {
      kind: 'failed',
      detail: 'its sockets were not listening within the bound',
    };
  }
  dependencies.logger.info(
    `the relay host listens for ${sockets.map(socket => `${socket.relay.kind} at ${socket.path}`).join(', ')}`,
  );
  return {
    kind: 'started',
    host: {
      variables: Object.fromEntries(
        sockets.map(socket => [socket.relay.variable, socket.path]),
      ),
      dispose: () => {
        process.stdin.end();
        lease.abort();
      },
    },
  };
}
