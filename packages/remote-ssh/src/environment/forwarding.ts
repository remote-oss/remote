/**
 * @fileoverview The forwarding plans of an SSH window together: the agent link and the display, and the one
 * environment they give the window's extension host and terminals. Pure: no `vscode`, no process, no file system.
 */

import {
  type AgentLinkPlan,
  terminalEnvironment as agentEnvironment,
} from './agent-link.ts';
import {
  type DisplayPlan,
  terminalEnvironment as displayEnvironment,
} from './display.ts';

/** The window's two plans, made once per connect. */
export interface ForwardingPlans {
  agentLink: AgentLinkPlan;
  display: DisplayPlan;
}

/** The variables the plans set, `SSH_AUTH_SOCK` and `DISPLAY` or fewer, and nothing else. */
export function forwardingEnvironment(
  plans: ForwardingPlans,
): Record<string, string> {
  return {
    ...agentEnvironment(plans.agentLink),
    ...displayEnvironment(plans.display),
  };
}
