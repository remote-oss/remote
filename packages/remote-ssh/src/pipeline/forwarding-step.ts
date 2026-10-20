/**
 * @fileoverview The forwarding of a connect: the window's agent link and display plans, from the settings and the
 * probe's facts or from the connection's stored record, and the agent link made on the host from a hidden terminal,
 * so that the editor's own trust check comes before it. Nothing here shows anything; it logs.
 */

import {type HostChannel, posixQuote} from 'lib-host';
import type {Logger} from 'lib-log';
import type {ProbedHost} from 'lib-server';
import {type AgentLinkPlan, planAgentLink} from '../environment/agent-link.ts';
import {type DisplayPlan, planDisplay} from '../environment/display.ts';
import type {ForwardingPlans} from '../environment/forwarding.ts';
import type {ConnectionLease} from './steps.ts';

/** The name of the hidden terminal that makes the agent link. */
export const LINK_TERMINAL_NAME = 'Remote - SSH agent link';

/** The start of every agent link's path. */
const LINK_PREFIX = '/tmp/vscode-ssh-auth-sock-';

/** Prints the agent links in /tmp, one path a line; a dangling link counts, a pattern that matched nothing does not. */
const LISTING_SCRIPT = [
  `for name in ${LINK_PREFIX}*; do`,
  `  if [ -e "$name" ] || [ -L "$name" ]; then printf '%s\\n' "$name"; fi`,
  'done',
].join('\n');

/** The window's hidden terminals, each running one program. */
export interface LinkTerminals {
  /**
   * Runs `program` with `programArguments` in a hidden terminal named `name`, on the host in a remote window, and
   * settles once the terminal has closed.
   */
  runProgram(
    name: string,
    program: string,
    programArguments: readonly string[],
  ): Promise<void>;
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

/** The log line of the agent link plan; it never names the socket or the link. */
function agentLine(plan: AgentLinkPlan): string {
  return plan.kind === 'link'
    ? 'agent forwarding: an agent socket was found, and the window links to it'
    : `agent forwarding: none (${plan.reason})`;
}

/** The log line of the display plan; it never names the display. */
function displayLine(plan: DisplayPlan): string {
  return plan.kind === 'display'
    ? 'X11 forwarding: a forwarded display was found'
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

/**
 * The command of the link terminal: `ln` with the target and the link path as its own arguments, never in its text.
 * It always exits 0, so the editor never reports a failure of it; the link is read back once the terminal ended.
 */
const LINK_COMMAND = 'ln -sfn -- "$1" "$2" 2>/dev/null; exit 0';

/** Reads the link back over the channel, without writing anything; a link that is not the plan's is a warn line. */
async function checkLink(
  channel: HostChannel,
  plan: Extract<AgentLinkPlan, {kind: 'link'}>,
  logger: Logger,
  warn: (detail: string) => void,
): Promise<void> {
  const output: string[] = [];
  const outcome = await channel.runScript(
    {
      script: `readlink -- ${posixQuote(plan.linkPath)}`,
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
    warn(`it could not be read back: ${outcome.failure.detail}`);
    return;
  }
  const found = output.join('\n');
  if (found === plan.target) {
    logger.info(`the agent link ${plan.linkPath} points at ${found}`);
  } else {
    warn(found === '' ? 'there is no link' : `it points at ${found}`);
  }
}

/**
 * Makes a `link` plan's link from a hidden terminal of the window, which the editor starts on the host after its own
 * trust check, then reads it back over the channel once the terminal ended; a `none` plan makes none. It returns at
 * once; a link that is missing or other than the plan's is a warn line, and nothing is shown.
 */
export function linkAgent(
  dependencies: Pick<ForwardingDependencies, 'linkTerminals' | 'logger'>,
  channel: HostChannel,
  plan: AgentLinkPlan,
): void {
  if (plan.kind !== 'link') {
    return;
  }
  const {logger} = dependencies;
  const link = plan;
  function warn(detail: string): void {
    logger.warn(`the agent link ${link.linkPath} was not made: ${detail}`);
  }
  dependencies.linkTerminals
    .runProgram(LINK_TERMINAL_NAME, '/bin/sh', [
      '-c',
      LINK_COMMAND,
      'sh',
      link.target,
      link.linkPath,
    ])
    .then(() => checkLink(channel, link, logger, warn))
    .catch((caught: unknown) => {
      warn(String(caught));
    });
}
