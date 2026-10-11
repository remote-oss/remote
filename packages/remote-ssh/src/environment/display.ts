/**
 * @fileoverview The forwarded display of an SSH window: the session's own `DISPLAY`, passed to the window's
 * terminals unchanged. Pure: no `vscode`, no process, no file system.
 */

/** The inputs of the plan for one window. */
export interface DisplayInput {
  /** `remote.SSH.enableX11Forwarding`. */
  settingEnabled: boolean;
  /** `DISPLAY` exactly as the session on the host reports it; `''` when none. */
  sessionDisplay: string;
  /** False when the connection is reused and `stored` decides the plan. */
  newConnection: boolean;
  /** The plan the connection's first window stored. */
  stored: DisplayPlan | undefined;
}

/** The plan: no display and why, or the display value the session reported. */
export type DisplayPlan =
  | {kind: 'none'; reason: 'settingOff' | 'noSessionDisplay'}
  | {kind: 'display'; value: string};

/**
 * The plan for one window. A reused connection keeps its stored plan; otherwise the setting and the session's
 * own display decide, and the value is passed through unchanged.
 */
export function planDisplay(input: DisplayInput): DisplayPlan {
  if (!input.newConnection && input.stored !== undefined) {
    return input.stored;
  }
  if (!input.settingEnabled) {
    return {kind: 'none', reason: 'settingOff'};
  }
  if (input.sessionDisplay === '') {
    return {kind: 'none', reason: 'noSessionDisplay'};
  }
  return {kind: 'display', value: input.sessionDisplay};
}

/**
 * The environment a terminal gets from the plan: the display as `DISPLAY` and nothing else, no `XAUTHORITY`.
 * A `none` plan sets nothing.
 */
export function terminalEnvironment(plan: DisplayPlan): Record<string, string> {
  if (plan.kind !== 'display') {
    return {};
  }
  return {DISPLAY: plan.value};
}

/**
 * The `DISPLAY` a terminal ends up with: the plan's value when it sets one, otherwise the inherited value
 * unchanged.
 */
export function mergedDisplay(
  inherited: string | undefined,
  plan: DisplayPlan,
): string | undefined {
  return plan.kind === 'display' ? plan.value : inherited;
}
