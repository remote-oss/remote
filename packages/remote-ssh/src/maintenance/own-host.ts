/**
 * @fileoverview Kill and uninstall on the window's own host: whether the command is available, what each of
 * the four plans does to the window, and the notice each outcome shows.
 */

/** The kind of the window the command acts on. */
export type WindowKind = 'local' | 'sshConnected' | 'sshDisconnected';

/** The notice a command outcome shows. */
export type CommandNotice = 'killed' | 'killFailed' | 'none';

/** What a kill or uninstall on the own host does to the window. */
export interface OwnHostPlan {
  /** A new SSH connection to the host is made. */
  opensConnection: boolean;
  /** The kill or uninstall step runs on the host. */
  actsOnHost: boolean;
  /** The same window becomes an empty local window. */
  switchesToLocalWindow: boolean;
  forgetsStoredDetails: boolean;
  notice: CommandNotice;
}

/**
 * The command is available only while the window's connection to its host is open.
 */
export function killCurrentAvailable(window: WindowKind): boolean {
  return window === 'sshConnected';
}

/**
 * The plan for a kill on the window's own host. With the local server in effect, the window acts locally and
 * switches to a local one; without it, a connection is made and the kill runs on the host, and the window
 * stays.
 */
export function killCurrentPlan(effectiveUseLocalServer: boolean): OwnHostPlan {
  const opensConnection = !effectiveUseLocalServer;
  return {
    opensConnection,
    actsOnHost: opensConnection,
    switchesToLocalWindow: !opensConnection,
    forgetsStoredDetails: true,
    notice: 'killed',
  };
}

/**
 * The plan for an uninstall on the window's own host: as the kill's plan, with no notice — an uninstall shows
 * nothing when it succeeds.
 */
export function uninstallOwnHostPlan(
  effectiveUseLocalServer: boolean,
): OwnHostPlan {
  const opensConnection = !effectiveUseLocalServer;
  return {
    opensConnection,
    actsOnHost: opensConnection,
    switchesToLocalWindow: !opensConnection,
    forgetsStoredDetails: true,
    notice: 'none',
  };
}

/**
 * The outcome of the kill or uninstall step. `stepFailed`: the connection opened, but the probe or the step did not
 * work on the host.
 */
export type StepResult = 'stepRan' | 'stepFailed' | 'connectionFailed';

/** The notice a kill outcome shows. */
export function killResult(result: StepResult): CommandNotice {
  return result === 'stepRan' ? 'killed' : 'killFailed';
}

/** The notice an uninstall outcome shows. */
export function uninstallResult(result: StepResult): 'silent' | 'commandError' {
  return result === 'connectionFailed' ? 'commandError' : 'silent';
}
