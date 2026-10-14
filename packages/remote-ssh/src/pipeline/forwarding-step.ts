/**
 * @fileoverview The forwarding of a connect: the window's agent link and display plans, from the settings and the
 * probe's facts or from the connection's stored record, and the agent link made on the host from an extension
 * terminal, so that the editor's own trust check comes before it. Nothing here shows anything; it logs.
 */

import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {ProbedHost} from 'lib-server';
import {posixQuote} from 'lib-ssh';
import {type AgentLinkPlan, planAgentLink} from '../environment/agent-link.ts';
import {type DisplayPlan, planDisplay} from '../environment/display.ts';
import type {ForwardingPlans} from '../environment/forwarding.ts';
import type {ConnectionLease} from './steps.ts';

/** The name of the extension terminal that makes the agent link. */
export const LINK_TERMINAL_NAME = 'Remote - SSH agent link';

/** The start of every agent link's path. */
const LINK_PREFIX = '/tmp/vscode-ssh-auth-sock-';

/** Prints the agent links in /tmp, one path a line; a dangling link counts, a pattern that matched nothing does not. */
const LISTING_SCRIPT = [
  `for name in ${LINK_PREFIX}*; do`,
  `  if [ -e "$name" ] || [ -L "$name" ]; then printf '%s\\n' "$name"; fi`,
  'done',
].join('\n');

/** The editor's extension terminals, each running one piece of work. */
export interface LinkTerminals {
  /** Creates a terminal named `name`; when the editor opens it, `work` runs, and then the terminal closes. */
  open(name: string, work: () => Promise<void>): void;
}

/** What the forwarding of a connect reads and where it makes the link. */
export interface ForwardingDependencies {
  /** `remote.SSH.enableAgentForwarding`, read when the connect plans. */
  agentForwarding: () => boolean;
  /** `remote.SSH.enableX11Forwarding`, read when the connect plans. */
  x11Forwarding: () => boolean;
  /** A cryptographic random integer in 1..999999999, which names a new link. */
  draw: () => number;
  /** The link the window planned on an earlier connect, which a reconnection keeps; written when a plan links. */
  windowLink: {path: string | undefined};
  linkTerminals: LinkTerminals;
  logger: Logger;
}

/** The agent links in /tmp the window must not draw; none when they could not be listed, which is logged. */
async function takenLinks(
  channel: HostChannel,
  cancellation: AbortSignal,
  logger: Logger,
): Promise<ReadonlySet<string>> {
  const names = new Set<string>();
  const outcome = await channel.runScript(
    {
      script: LISTING_SCRIPT,
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text: ''},
      cancellation,
    },
    line => {
      if (line.startsWith(LINK_PREFIX)) {
        names.add(line);
      }
    },
  );
  if (outcome.kind === 'failed') {
    logger.warn(
      `the agent links in /tmp could not be listed: ${outcome.failure.detail}`,
    );
  }
  return names;
}

/** The log line of the agent link plan. */
function agentLine(plan: AgentLinkPlan): string {
  return plan.kind === 'link'
    ? `agent forwarding: ${plan.linkPath} links to ${plan.target}`
    : `agent forwarding: none (${plan.reason})`;
}

/** The log line of the display plan. */
function displayLine(plan: DisplayPlan): string {
  return plan.kind === 'display'
    ? `X11 forwarding: DISPLAY is ${plan.value}`
    : `X11 forwarding: none (${plan.reason})`;
}

/**
 * The window's plans. A connection whose record was stored keeps that record's plans; otherwise the settings and the
 * probe's facts decide, and a link takes the window's earlier path or a drawn one that no link in /tmp has.
 */
export async function planForwarding(
  dependencies: ForwardingDependencies,
  lease: ConnectionLease,
  host: ProbedHost,
  cancellation: AbortSignal,
): Promise<ForwardingPlans> {
  const stored = lease.storedRecord;
  const newConnection = stored === undefined;
  const agentEnabled = dependencies.agentForwarding();
  const takenNames =
    agentEnabled && host.sshAuthSock !== ''
      ? await takenLinks(lease.channel, cancellation, dependencies.logger)
      : new Set<string>();
  const agentLink = planAgentLink({
    settingEnabled: agentEnabled,
    forwardedSocket: host.sshAuthSock,
    newConnection,
    stored: stored?.agentLink,
    windowLink: dependencies.windowLink.path,
    takenNames,
    draw: dependencies.draw,
  });
  const display = planDisplay({
    settingEnabled: dependencies.x11Forwarding(),
    sessionDisplay: host.display,
    newConnection,
    stored: stored?.display,
  });
  if (agentLink.kind === 'link') {
    dependencies.windowLink.path = agentLink.linkPath;
  }
  dependencies.logger.info(agentLine(agentLink));
  dependencies.logger.info(displayLine(display));
  return {agentLink, display};
}

/** Runs `ln` in /tmp over the channel; a failure is a warn line and nothing else. */
async function makeLink(
  channel: HostChannel,
  plan: Extract<AgentLinkPlan, {kind: 'link'}>,
  logger: Logger,
): Promise<void> {
  const output: string[] = [];
  const outcome = await channel.runScript(
    {
      script: `cd /tmp && ln -sfn -- ${posixQuote(plan.target)} ${posixQuote(plan.linkPath)}`,
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text: ''},
      cancellation: new AbortController().signal,
    },
    line => {
      output.push(line);
    },
  );
  if (outcome.kind === 'failed') {
    logger.warn(
      `the agent link ${plan.linkPath} was not made: ${outcome.failure.detail}`,
    );
  } else if (outcome.status !== 0) {
    logger.warn(
      `the agent link ${plan.linkPath} was not made: ln exited with ${String(outcome.status)}: ${output.join(' ')}`,
    );
  }
}

/** Opens the extension terminal that makes a `link` plan's link once the editor opens it; a `none` plan opens none. */
export function linkAgent(
  dependencies: Pick<ForwardingDependencies, 'linkTerminals' | 'logger'>,
  channel: HostChannel,
  plan: AgentLinkPlan,
): void {
  if (plan.kind !== 'link') {
    return;
  }
  const {logger} = dependencies;
  dependencies.linkTerminals.open(LINK_TERMINAL_NAME, () =>
    makeLink(channel, plan, logger).catch((caught: unknown) => {
      logger.warn(
        `the agent link ${plan.linkPath} was not made: ${String(caught)}`,
      );
    }),
  );
}
