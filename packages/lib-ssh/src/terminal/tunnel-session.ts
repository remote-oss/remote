/**
 * @fileoverview The tunnel `ssh` of the second-login and socket paths, run in an `SSH Tunnel` terminal. `ssh` sets up
 * its local forwards before it sends the remote command, so a failed forward of ours always shows before the success
 * line the remote command prints. The session reports at that line whether our forward was set up: a busy local port
 * does not make `ssh` fail, it warns, prints the success line and keeps running.
 */

import {type Invocation, TUNNEL_SUCCESS_LINE} from '../arguments/invocation.ts';
import {setupMarkerOf} from '../diagnostics/setup-report.ts';
import {LineSplitter} from '../process/line-splitter.ts';
import type {LoginTerminals} from './login-terminal.ts';

/** The general line `ssh` prints when a forward could not be set up. */
const FORWARD_REFUSED_LINE = 'Could not request local forwarding.';

/** The text `ssh` prints before the number of a port it could not listen on. */
const CANNOT_LISTEN = 'cannot listen to port: ';

/** How the tunnel session got past its gate, or why it did not. The gate settles once, with the first answer. */
export type TunnelGate =
  {kind: 'forwarded'} | {kind: 'forwardFailed'; line: string} | {kind: 'ended'};

/** A tunnel `ssh` running in its terminal. */
export interface TunnelSession {
  /** Settles once: at the success line (forwarded or forwardFailed), or when the terminal ends first (ended). */
  gate: Promise<TunnelGate>;
  /** Each plain-text piece of the terminal's output, for the login's question reader and the log. */
  onOutput(listener: (text: string) => void): void;
  /** Calls `listener` once when the terminal ends, also after the gate. */
  onEnd(listener: () => void): void;
  /** Writes to the terminal, such as an answer to a login question. */
  send(text: string): void;
  /** Ends the tunnel by closing its terminal. Safe to call more than once. */
  stop(): void;
}

/** Whether the line says that a forward of ours, on `localPort`, could not be set up. */
function isForwardFailureFor(line: string, localPort: number): boolean {
  if (line === FORWARD_REFUSED_LINE) {
    return true;
  }
  const marker = line.lastIndexOf(CANNOT_LISTEN);
  return (
    marker >= 0 &&
    line.slice(marker + CANNOT_LISTEN.length) === String(localPort)
  );
}

/**
 * Starts `invocation`, the tunnel run, in an `SSH Tunnel` terminal for the window's `localPort`; `input` is written to
 * the terminal once ssh reports it is authenticated, when the tunnel's command goes in on its input.
 */
export function openTunnelSession(
  terminals: LoginTerminals,
  invocation: Invocation,
  localPort: number,
  reveal: boolean,
  input?: string,
): TunnelSession {
  const terminal = terminals.open(invocation, 'SSH Tunnel', reveal);
  const settling: {settle?: (gate: TunnelGate) => void} = {};
  const gate = new Promise<TunnelGate>(resolve => {
    settling.settle = resolve;
  });
  function settle(answer: TunnelGate): void {
    settling.settle?.(answer);
  }
  let failure: string | undefined;
  let inputSent = input === undefined;
  const splitter = new LineSplitter(line => {
    // The tunnel's input waits for ssh to report it is authenticated: nothing on the host that reads its standard input
    // before the login can take it.
    if (
      !inputSent &&
      input !== undefined &&
      setupMarkerOf(line) === 'authenticated'
    ) {
      inputSent = true;
      terminal.send(input);
    }
    if (line === TUNNEL_SUCCESS_LINE) {
      settle(
        failure === undefined
          ? {kind: 'forwarded'}
          : {kind: 'forwardFailed', line: failure},
      );
    } else if (failure === undefined && isForwardFailureFor(line, localPort)) {
      failure = line;
    }
  });
  terminal.onOutput(text => {
    splitter.push(text);
  });
  terminal.onEnd(() => {
    // A gate settles once: the end after the success line leaves the answer the success line gave.
    settle({kind: 'ended'});
  });
  let stopped = false;
  return {
    gate,
    onOutput: listener => {
      terminal.onOutput(listener);
    },
    onEnd: listener => {
      terminal.onEnd(() => {
        listener();
      });
    },
    send: text => {
      terminal.send(text);
    },
    stop: () => {
      if (!stopped) {
        stopped = true;
        terminal.dispose();
      }
    },
  };
}
