/**
 * @fileoverview The agent link plan of an SSH window: whether the window links its forwarded agent socket
 * into /tmp, the path of that link, and the terminal environment the plan sets. Pure: the random draw is a
 * parameter, so the plan is testable without a process, a socket or the file system.
 */

/** The inputs of the plan for one window. */
export interface AgentLinkInput {
  /** `remote.SSH.enableAgentForwarding`. */
  settingEnabled: boolean;
  /** `SSH_AUTH_SOCK` as the session reports it; `''` when none was forwarded. */
  forwardedSocket: string;
  /** False when the connection is reused and `stored` decides the plan. */
  newConnection: boolean;
  /** The plan the connection's first window stored. */
  stored: AgentLinkPlan | undefined;
  /** The link this window already made, kept across reconnection. */
  windowLink: string | undefined;
  /** Link paths in /tmp the window did not create. */
  takenNames: ReadonlySet<string>;
  /** An integer in 1..999999999; the source of the name the link is drawn from. */
  draw: () => number;
}

/** The plan: no link and why, or the link's path and the agent socket it targets. */
export type AgentLinkPlan =
  | {kind: 'none'; reason: 'settingOff' | 'noForwardedSocket'}
  | {kind: 'link'; linkPath: string; target: string};

/**
 * The link path for one draw: `/tmp/vscode-ssh-auth-sock-<draw>`. Redraws at most 16 times while the path is in
 * `takenNames`, then returns the last drawn path: a collision that survives is caught when the host creates the
 * link.
 */
export function linkPathFor(
  draw: () => number,
  takenNames: ReadonlySet<string>,
): string {
  let linkPath = `/tmp/vscode-ssh-auth-sock-${String(draw())}`;
  let redraws = 0;
  while (takenNames.has(linkPath) && redraws < 16) {
    linkPath = `/tmp/vscode-ssh-auth-sock-${String(draw())}`;
    redraws += 1;
  }
  return linkPath;
}

/**
 * The plan for one window. A reused connection keeps its stored plan; otherwise the setting and the forwarded
 * socket decide, and a link reuses the window's own link or draws a fresh path.
 */
export function planAgentLink(input: AgentLinkInput): AgentLinkPlan {
  if (!input.newConnection && input.stored !== undefined) {
    return input.stored;
  }
  if (!input.settingEnabled) {
    return {kind: 'none', reason: 'settingOff'};
  }
  if (input.forwardedSocket === '') {
    return {kind: 'none', reason: 'noForwardedSocket'};
  }
  const linkPath =
    input.windowLink ?? linkPathFor(input.draw, input.takenNames);
  return {kind: 'link', linkPath, target: input.forwardedSocket};
}

/**
 * The environment a terminal gets from the plan: the link path as `SSH_AUTH_SOCK`, and nothing else. A `none`
 * plan sets nothing.
 */
export function terminalEnvironment(
  plan: AgentLinkPlan,
): Record<string, string> {
  if (plan.kind !== 'link') {
    return {};
  }
  return {SSH_AUTH_SOCK: plan.linkPath};
}
