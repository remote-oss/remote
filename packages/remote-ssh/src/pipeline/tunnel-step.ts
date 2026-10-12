/**
 * @fileoverview The step that opens the window's tunnel to the server: through the connection's SOCKS relay, the path
 * the default settings select, or through a second `ssh` run in its own terminal, to the server's port or to its
 * socket. The second `ssh` owns the window's port, so the step waits for the line that says its forwards are set up,
 * checks that ours was among them, and only then waits for the port to accept a connection.
 */

import type {Scheduler} from 'lib-helper';
import {
  type Dialer,
  factoryFor,
  type LocalPort,
  openForwardedTunnel,
  openRelayTunnel,
  selectTunnelPath,
  type TunnelPath,
  type TunnelSettings,
  type WaitLimits,
} from 'lib-forwarding';
import type {Logger} from 'lib-log';
import type {StartedServer} from 'lib-server';
import {
  connectWaitMilliseconds,
  type Forward,
  type Invocation,
  type LoginTerminals,
  openTunnelSession,
  PromptReader,
  type ConnectWaitSettings,
  type TunnelSession,
} from 'lib-ssh';
import type {TerminalLogin} from '../surfaces/terminal-questions.ts';
import {isAborted, portOf} from './connect.ts';
import type {ConnectInput, ConnectSteps} from './steps.ts';

/** What the window gets besides the tunnel: the variables of its extension host and its environment tunnels. */
interface WindowEnvironment {
  extensionHostEnv: Readonly<Record<string, string | null>>;
  environmentTunnels: readonly unknown[];
}

/** What the step is made of. */
export interface TunnelStepDependencies {
  /** The settings that select the tunnel's path, as they are now. */
  settings: () => TunnelSettings;
  local: LocalPort;
  scheduler: Scheduler;
  limits: WaitLimits;
  /** The dialer through the connection's SOCKS relay on `socksPort`; the extension gives lib-forwarding's `socksDialer`. */
  dialerFor(socksPort: number): Dialer;
  /** The window's port on this machine's loopback, or nothing when none is free. */
  chooseLocalPort(): Promise<number | undefined>;
  /** The window's environment for the connection that is being set up. */
  environment(): WindowEnvironment;
  /** The login terminals of the editor. */
  terminals: LoginTerminals;
  /** The tunnel run for one forward: the local port and where it leads on the host. */
  tunnelInvocation(forward: Forward): Invocation;
  /** Shows the tunnel login's questions for this connect and answers the terminal; the handle takes an input down. */
  attachQuestions(
    login: TerminalLogin,
    input: ConnectInput,
  ): {onQuestion(text: string): void; dispose(): void};
  /** `remote.SSH.showLoginTerminal`, read once per attempt. */
  revealLoginTerminals(): boolean;
  /** What decides the length of the connect wait, which also bounds a question of the tunnel login that nobody can see. */
  connectWait(): ConnectWaitSettings;
  logger: Logger;
}

/** How long the second `ssh`'s port may take to accept a connection once its forwards are set up. */
const FORWARD_READY_MILLISECONDS = 10_000;

/** The reason of a tunnel whose port never accepted: "Error establishing tunnel (Max wait time exhausted)." */
const MAX_WAIT_EXHAUSTED = {
  id: 'S067',
  values: [{id: 'S089', values: []}],
} as const;

/**
 * The failure of a tunnel that did not open, on any path: no reason of its own, so the dialog names only the host.
 * The tunnel's own text (S067) comes with the reason that carries values.
 */
const NOT_OPENED: Awaited<ReturnType<ConnectSteps['openTunnel']>> = {
  kind: 'failed',
  failure: {kind: 'unknown'},
};

/** What the step gives when it opens a tunnel. */
type TunnelResult = Awaited<ReturnType<ConnectSteps['openTunnel']>>;

/** The forward the second `ssh` sets up: the server's port on the second-ssh path, its socket on the socket path. */
function forwardFor(
  path: 'secondSsh' | 'socket',
  localPort: number,
  server: StartedServer,
): Forward {
  const {endpoint} = server;
  if (path === 'secondSsh' && endpoint.kind === 'port') {
    return {kind: 'local', localPort, remotePort: endpoint.port};
  }
  if (path === 'socket' && endpoint.kind === 'socket') {
    return {kind: 'socket', localPort, socketPath: endpoint.path};
  }
  throw new Error(
    path === 'secondSsh'
      ? 'the second-ssh path needs a port endpoint'
      : 'the socket path needs a socket endpoint',
  );
}

/** What the tunnel's listeners hear when its `ssh` ends without being asked to. */
const TUNNEL_ENDED = 'the tunnel ssh ended';

/** What the tunnel tells about its own end: once, and only for an end nobody asked for. */
function endOf(session: TunnelSession): {
  asked(): void;
  onClosed(listener: (detail: string) => void): void;
} {
  const listeners: Array<(detail: string) => void> = [];
  const state = {ended: false, asked: false};
  session.onEnd(() => {
    if (state.asked) {
      return;
    }
    state.ended = true;
    for (const listener of listeners.splice(0)) {
      listener(TUNNEL_ENDED);
    }
  });
  return {
    asked: () => {
      state.asked = true;
    },
    onClosed: listener => {
      if (state.ended) {
        listener(TUNNEL_ENDED);
      } else if (!state.asked) {
        listeners.push(listener);
      }
    },
  };
}

/** The tunnel through a second `ssh` in its own terminal, to the server's port or socket. */
async function openTerminalTunnel(
  dependencies: TunnelStepDependencies,
  path: 'secondSsh' | 'socket',
  given: Parameters<ConnectSteps['openTunnel']>,
): Promise<TunnelResult> {
  const [input, , server, onWaiting, cancellation] = given;
  if (isAborted(cancellation)) {
    return CANCELLED;
  }
  const localPort = await dependencies.chooseLocalPort();
  if (localPort === undefined) {
    return NOT_OPENED;
  }
  if (isAborted(cancellation)) {
    return CANCELLED;
  }
  const forward = forwardFor(path, localPort, server);
  const session = openTunnelSession(
    dependencies.terminals,
    dependencies.tunnelInvocation(forward),
    localPort,
    dependencies.revealLoginTerminals(),
  );
  let stall: (() => void) | undefined;
  const unreachable = new Promise<'unreachable'>(resolve => {
    stall = () => {
      resolve('unreachable');
    };
  });
  const reader = new PromptReader(
    dependencies.scheduler,
    connectWaitMilliseconds(dependencies.connectWait()),
    {
      onQuestion: text => {
        questions.onQuestion(text);
      },
      onUnreachable: () => {
        stall?.();
      },
    },
  );
  const questions = dependencies.attachQuestions(
    {terminal: session, reader},
    input,
  );
  session.onOutput(text => {
    reader.push(text);
  });
  function takeDown(): void {
    reader.stop();
    questions.dispose();
  }
  const cancelled = new Promise<'cancelled'>(resolve => {
    cancellation.addEventListener(
      'abort',
      () => {
        resolve('cancelled');
      },
      {once: true},
    );
  });
  const gate = await Promise.race([session.gate, unreachable, cancelled]);
  takeDown();
  if (gate === 'cancelled') {
    session.stop();
    return CANCELLED;
  }
  if (gate === 'unreachable') {
    session.stop();
    return {kind: 'failed', failure: {kind: 'timeout'}};
  }
  if (gate.kind === 'forwardFailed') {
    dependencies.logger.warn(`the tunnel's forward failed: ${gate.line}`);
    session.stop();
    return NOT_OPENED;
  }
  if (gate.kind === 'ended') {
    return NOT_OPENED;
  }
  onWaiting();
  const opening = openForwardedTunnel({
    local: dependencies.local,
    scheduler: dependencies.scheduler,
    localPort,
    limits: {
      ...dependencies.limits,
      readyMilliseconds: FORWARD_READY_MILLISECONDS,
    },
    stopSession: () => {
      session.stop();
    },
  });
  const outcome = await Promise.race([opening, cancelled]);
  if (outcome === 'cancelled') {
    // The session is the tunnel: stopped, there is nothing left for the wait to hand over, and it ends at its bound.
    session.stop();
    return CANCELLED;
  }
  if (outcome.kind !== 'open') {
    return {
      kind: 'failed',
      failure: {kind: 'unknown', reason: MAX_WAIT_EXHAUSTED},
    };
  }
  const {extensionHostEnv, environmentTunnels} = dependencies.environment();
  const end = endOf(session);
  return {
    kind: 'done',
    value: {
      opened: {
        address: outcome.address,
        extensionHostEnv,
        environmentTunnels,
      },
      close: () => {
        end.asked();
        outcome.close();
      },
      onClosed: listener => {
        end.onClosed(listener);
      },
    },
  };
}

/** The failure of a connect that was cancelled while the tunnel was being opened. */
const CANCELLED: TunnelResult = {kind: 'failed', failure: {kind: 'cancelled'}};

/**
 * The step that names the window tunnel's path and opens the tunnel on it. The path is read from the settings once,
 * the first time it is asked for, and the step opens the tunnel on that path, so the pipeline's bound and the step
 * cannot disagree. The step is made for one connect, so the choice lasts for that connect alone.
 */
export function openTunnelStep(
  dependencies: TunnelStepDependencies,
): Pick<ConnectSteps, 'tunnelPath' | 'openTunnel'> {
  let chosen: TunnelPath | undefined;
  function tunnelPath(): TunnelPath {
    chosen ??= selectTunnelPath(dependencies.settings());
    return chosen;
  }
  async function openTunnel(
    ...given: Parameters<ConnectSteps['openTunnel']>
  ): Promise<TunnelResult> {
    const [, lease, server, onWaiting] = given;
    const path = tunnelPath();
    if (path !== 'socks') {
      return openTerminalTunnel(dependencies, path, given);
    }
    const localPort = await dependencies.chooseLocalPort();
    if (localPort === undefined) {
      return NOT_OPENED;
    }
    const dialer = dependencies.dialerFor(lease.socksPort);
    const outcome = await openRelayTunnel({
      dialer,
      local: dependencies.local,
      scheduler: dependencies.scheduler,
      target: {kind: 'port', port: portOf(server)},
      localPort,
      limits: dependencies.limits,
      onWaiting,
    });
    if (outcome.kind !== 'open') {
      return NOT_OPENED;
    }
    const factory = factoryFor({
      dialer,
      local: dependencies.local,
      scheduler: dependencies.scheduler,
      limits: dependencies.limits,
    });
    const {extensionHostEnv, environmentTunnels} = dependencies.environment();
    let closeRan = false;
    return {
      kind: 'done',
      value: {
        opened: {
          address: outcome.address,
          extensionHostEnv,
          environmentTunnels,
          tunnelFeatures: factory.features,
          tunnelFactory: factory,
        },
        close: () => {
          if (closeRan) {
            return;
          }
          closeRan = true;
          factory.closeAll();
          outcome.close();
        },
        onClosed: outcome.onClosed,
      },
    };
  }
  return {tunnelPath, openTunnel};
}
