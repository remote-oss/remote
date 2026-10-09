/**
 * @fileoverview The tunnel factory the resolver hands to the editor: one tunnel for each port the user or an
 * extension forwards, all through the one SSH connection. After a reconnection the forwards keep their ports and run
 * over the new dialer; the ones the new connection cannot reach are reported and stay listed.
 */

import type {Scheduler} from 'lib-helper';
import type {Dialer, LocalPort} from './ports.ts';
import {openRelayTunnel} from './relay.ts';
import {succeedsWithin, type WaitLimits} from './wait.ts';

/** A port to forward: the port on the host's loopback and the port to listen on here. */
export interface ForwardRequest {
  remotePort: number;
  localPort: number;
  label?: string;
}

/** A forwarded port: where it is on the host and where it is here. */
export interface ForwardedPort {
  remotePort: number;
  localPort: number;
  label?: string;
}

/** Why a port was not forwarded. */
export type ForwardFailure = 'listenFailed' | 'tunnelNotReady';

/** The outcome of one forward. */
export type ForwardOutcome =
  | {kind: 'forwarded'; port: ForwardedPort}
  | {kind: 'failed'; reason: ForwardFailure};

/** What a reconnection did to the forwards. */
export interface ReviveReport {
  revived: readonly ForwardedPort[];
  failed: readonly ForwardedPort[];
}

/** What the window's port forwarding offers: SSH forwards are private to this machine, with no elevation. */
export interface TunnelFeatures {
  elevation: boolean;
  privacy: readonly 'private'[];
}

/** The forwards of one connection. */
export interface TunnelFactory {
  readonly features: TunnelFeatures;
  /** Forwards a port; it is listed from then on, until `closeAll`. */
  forward(request: ForwardRequest): Promise<ForwardOutcome>;
  /** The ports forwarded now, in the order they were forwarded. */
  forwarded(): readonly ForwardedPort[];
  /** The connection was replaced: every forward uses `dialer` from now on, and each is probed through it. */
  reconnect(dialer: Dialer): Promise<ReviveReport>;
  /** Ends every forward. */
  closeAll(): void;
}

/** Everything a factory is made from. */
export interface FactoryInit {
  dialer: Dialer;
  local: LocalPort;
  scheduler: Scheduler;
  limits: WaitLimits;
}

interface Entry {
  port: ForwardedPort;
  close(): void;
}

/** The factory for a connection, starting with its first dialer. */
export function factoryFor(init: FactoryInit): TunnelFactory {
  let dialer = init.dialer;
  const entries: Entry[] = [];
  const throughCurrent: Dialer = {dial: target => dialer.dial(target)};
  return {
    features: {elevation: false, privacy: ['private']},
    async forward(request) {
      const outcome = await openRelayTunnel({
        dialer: throughCurrent,
        local: init.local,
        scheduler: init.scheduler,
        target: {kind: 'port', port: request.remotePort},
        localPort: request.localPort,
        limits: init.limits,
      });
      if (outcome.kind === 'open') {
        const port: ForwardedPort = {
          remotePort: request.remotePort,
          localPort: request.localPort,
          ...(request.label === undefined ? {} : {label: request.label}),
        };
        entries.push({port, close: outcome.close});
        return {kind: 'forwarded', port};
      }
      return {
        kind: 'failed',
        reason:
          outcome.kind === 'listenFailed' ? 'listenFailed' : 'tunnelNotReady',
      };
    },
    forwarded: () => entries.map(entry => entry.port),
    async reconnect(replacement) {
      dialer = replacement;
      const revived: ForwardedPort[] = [];
      const failed: ForwardedPort[] = [];
      for (const entry of entries) {
        const worked = await succeedsWithin(
          async () => {
            (
              await dialer.dial({kind: 'port', port: entry.port.remotePort})
            ).close();
          },
          init.limits,
          init.scheduler,
        );
        (worked ? revived : failed).push(entry.port);
      }
      return {revived, failed};
    },
    closeAll() {
      for (const entry of entries.splice(0)) {
        entry.close();
      }
    },
  };
}
