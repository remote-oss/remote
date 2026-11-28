/**
 * @fileoverview The agent's tunnel commands over what a run has: the stored credential and the shipped defaults, the
 * relay's management service and the host leg that `connect` makes from them, and the signal that stops a run.
 */

import {ConfigError} from './config.ts';
import type {Handlers} from './commands.ts';
import type {TunnelService} from './relay.ts';
import {serveTunnel, type HostLeg} from './serve.ts';
import {readStateFile} from './state.ts';
import {
  registeredTunnel,
  renameTunnel,
  type TunnelContext,
  unregisterTunnel,
} from './tunnel.ts';

/** What a run of the agent has. */
export interface AgentRun {
  /** The state folder. */
  folder: string;
  /** The machine's host name. */
  hostName: string;
  /** The relay's domain from the shipped defaults; throws a `ConfigError` for defaults the agent can't use. */
  domain: () => string;
  /** The relay's service and the host leg, for the relay at `domain` and the sign-in's `token`. */
  connect: (
    domain: string,
    token: string,
  ) => {service: TunnelService; hostLeg: HostLeg};
  /** Signalled when the user stops the agent. */
  stop: AbortSignal;
  /** Says one line to the user. */
  report: (line: string) => void;
}

/** What a command needs of the relay: its context, and the host leg. */
interface Connected {
  context: TunnelContext;
  hostLeg: HostLeg;
}

/** The relay for this run, or none after the user was told that the agent has no sign-in or no usable defaults. */
function connected(agentRun: AgentRun): Connected | undefined {
  const token = readStateFile(agentRun.folder, 'credential')?.trim() ?? '';
  if (token === '') {
    agentRun.report('not signed in: run tunnel-agent login');
    return undefined;
  }
  let domain: string;
  try {
    domain = agentRun.domain();
  } catch (caught) {
    if (!(caught instanceof ConfigError)) {
      throw caught;
    }
    agentRun.report(caught.message);
    return undefined;
  }
  const {service, hostLeg} = agentRun.connect(domain, token);
  return {
    context: {
      service,
      folder: agentRun.folder,
      hostName: agentRun.hostName,
      report: agentRun.report,
    },
    hostLeg,
  };
}

/** The handlers of the tunnel commands over `run`. */
export function agentHandlers(agentRun: AgentRun): Handlers {
  return {
    start: async name => {
      const relay = connected(agentRun);
      if (relay === undefined) {
        return 1;
      }
      const tunnel = await registeredTunnel(relay.context, name);
      return tunnel === undefined
        ? 1
        : serveTunnel(relay.hostLeg, tunnel, agentRun.stop, agentRun.report);
    },
    rename: name => {
      const relay = connected(agentRun);
      return relay === undefined
        ? Promise.resolve(1)
        : renameTunnel(relay.context, name);
    },
    unregister: () => {
      const relay = connected(agentRun);
      return relay === undefined
        ? Promise.resolve(1)
        : unregisterTunnel(relay.context);
    },
  };
}
