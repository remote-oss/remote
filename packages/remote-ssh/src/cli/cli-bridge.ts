/**
 * @fileoverview The window's local bridge on the CLI path: a listener on this machine's loopback whose every connection
 * is one server socket of the CLI. The first connection runs `serve`, which installs and starts the server; each later
 * one runs `openSocket`. Bytes go both ways as `servermsg` frames over the one control connection.
 */

import type {Duplex, LocalPort} from 'lib-forwarding';
import type {Scheduler} from 'lib-helper';
import type {
  CliControl,
  CliControlFailure,
  CliServeError,
  CliServeParams,
  CliSocket,
  ServerLogLine,
} from 'lib-server';

/** Why the bridge stopped serving the window. */
export type CliBridgeLoss =
  | {kind: 'serveFailed'; error: CliServeError; errorLine: string | undefined}
  | {kind: 'controlClosed'};

/** The bridge the window connects to. */
export interface CliBridge {
  /** The listener the editor connects to. */
  readonly address: {host: '127.0.0.1'; port: number};
  /**
   * Called once when the bridge stops: `serveFailed` when a `serve` failed, which a retry would repeat, and
   * `controlClosed` when the control connection ended or a `serve` outlasted its bound. Never after `close`.
   */
  onLost(listener: (cause: CliBridgeLoss) => void): void;
  close(): void;
}

/** What the bridge needs from its surroundings. */
export interface CliBridgeDependencies {
  local: LocalPort;
  /** The loopback port to listen on. */
  port: number;
  scheduler: Scheduler;
  /** The bound of the first `serve`, which installs and starts the server. */
  firstServeMilliseconds: number;
  /** The bound of every later `serve`, which only attaches to the running server. */
  laterServeMilliseconds: number;
}

/** The outcome of one socket's `serve`, or the bound that ran out first. */
type Served = Awaited<ReturnType<CliControl['serve']>> | {kind: 'outlasted'};

/**
 * Opens the bridge's listener over `control`, which has authenticated. `onControlEnded` registers for the end of the
 * control connection's stream, which only its owner sees.
 */
export async function openCliBridge(
  control: CliControl,
  serveParams: CliServeParams,
  events: {
    onServeLog(line: ServerLogLine): void;
    onControlEnded(listener: () => void): void;
  },
  dependencies: CliBridgeDependencies,
): Promise<CliBridge> {
  const lossListeners: Array<(cause: CliBridgeLoss) => void> = [];
  const connections = new Set<Duplex>();
  let firstServe: Promise<Served> | undefined;
  let ended = false;
  let loss: CliBridgeLoss | undefined;

  function lose(cause: CliBridgeLoss): void {
    if (ended || loss !== undefined) {
      return;
    }
    loss = cause;
    for (const listener of lossListeners) {
      listener(cause);
    }
  }

  /**
   * Runs this connection's `serve`, bounded; the bound running out ends the control connection. Every connection after
   * the first waits for the first `serve`: the client refuses `openSocket` until it has succeeded.
   */
  function onLog(line: ServerLogLine): void {
    events.onServeLog(line);
  }

  async function serveOnce(): Promise<Served> {
    if (firstServe === undefined) {
      firstServe = bounded(
        control.serve(serveParams, onLog),
        dependencies.firstServeMilliseconds,
      );
      return firstServe;
    }
    const before = await firstServe;
    if (before.kind !== 'serving') {
      return before;
    }
    return bounded(
      control.openSocket(onLog),
      dependencies.laterServeMilliseconds,
    );
  }

  /** `running`, or `outlasted` when `milliseconds` pass first. */
  function bounded(
    running: Promise<Awaited<ReturnType<CliControl['serve']>>>,
    milliseconds: number,
  ): Promise<Served> {
    return new Promise<Served>(resolve => {
      const stopTimer = dependencies.scheduler.setTimer(milliseconds, () => {
        resolve({kind: 'outlasted'});
      });
      void running.then(outcome => {
        stopTimer();
        resolve(outcome);
      });
    });
  }

  function failureLoss(
    failure: CliControlFailure | {kind: 'outlasted'},
  ): CliBridgeLoss {
    return failure.kind === 'serveFailed'
      ? {
          kind: 'serveFailed',
          error: failure.error,
          errorLine: failure.errorLine,
        }
      : {kind: 'controlClosed'};
  }

  events.onControlEnded(() => {
    lose({kind: 'controlClosed'});
  });

  /**
   * Relays one connection of the editor to its own server socket. The protocol has no message that ends one socket
   * from this side (`[cli]` sends `serverclose`, never takes it), so a connection the editor closes only stops being
   * relayed; its socket on the CLI goes when the control connection does.
   */
  function relay(connection: Duplex): void {
    connections.add(connection);
    const early: Uint8Array[] = [];
    let socket: CliSocket | undefined;
    let open = true;
    connection.onData(chunk => {
      if (socket === undefined) {
        early.push(chunk);
      } else {
        socket.send(chunk);
      }
    });
    connection.onClose(() => {
      open = false;
      connections.delete(connection);
    });
    void serveOnce().then(outcome => {
      if (outcome.kind !== 'serving') {
        connection.close();
        if (outcome.kind === 'outlasted') {
          control.close();
        }
        lose(failureLoss(outcome));
        return;
      }
      if (!open || ended) {
        return;
      }
      socket = outcome.socket;
      for (const chunk of early.splice(0)) {
        socket.send(chunk);
      }
      socket.onData(chunk => {
        // The decoder may hand out a view of a buffer it reuses, and a connection may hold a chunk before it writes.
        if (open) {
          connection.send(chunk.slice());
        }
      });
      socket.onClose(() => {
        connection.close();
      });
    });
  }

  const listening = await dependencies.local.listen(
    dependencies.port,
    connection => {
      // After a loss no `serve` can succeed: the first failed, or the control connection is gone.
      if (ended || loss !== undefined) {
        connection.close();
        return;
      }
      relay(connection);
    },
    () => {
      lose({kind: 'controlClosed'});
    },
  );

  return {
    address: {host: '127.0.0.1', port: dependencies.port},
    onLost: listener => {
      lossListeners.push(listener);
    },
    close: () => {
      if (ended) {
        return;
      }
      ended = true;
      listening.close();
      for (const connection of [...connections]) {
        connection.close();
      }
      control.close();
    },
  };
}
