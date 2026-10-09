/**
 * @fileoverview The proposed-API setup of a family extension: it probes the editor, decides whether the user is told,
 * and carries the user through the setup notification, the edit of the runtime arguments and the restart. The editor
 * is behind ports, so the whole flow is tested with fakes. Only one notification shows per window for the whole
 * family, and nothing the user does holds the activation back.
 */

import {decide, type GateDecision, type GateInput} from './decisions.ts';
import type {ProposalProbe} from './probe.ts';

/** What the user is told: that the family needs the arguments, or that the last attempt did not enable them. */
export type SetupNotice =
  {kind: 'setup'; argvEntries: readonly string[]} | {kind: 'failedAttempt'};

/** What the user answered to a setup notice; closing it is "not now". */
export type SetupAnswer = 'configure' | 'notNow';

/** What the user answered to the restart notice. */
export type RestartAnswer = 'quit' | 'later';

/** Two flags the extension keeps in its global state, which the profile shares and settings sync does not carry. */
export interface SetupFlags {
  /** The user declined the setup; it silences warnings at activation until a probe succeeds. */
  dismissed(): boolean;
  setDismissed(value: boolean): PromiseLike<void>;
  /** The user edited the runtime arguments and the next probe has not run yet. */
  attemptPending(): boolean;
  setAttemptPending(value: boolean): PromiseLike<void>;
}

/** Who shows the one notification of the window. */
export interface WindowClaim {
  /**
   * Takes the window for `extensionId`, or says who holds it. The holder is unknown when it could not be found out,
   * which counts as another extension holding the window.
   */
  claim(extensionId: string): Promise<{holder: string | undefined}>;
}

/** Stands for a holder that could not be found out, which is never an extension's id. */
const UNKNOWN_HOLDER = '(unknown)';

/** What the setup needs from the editor and from the family. */
export interface SetupPorts {
  extensionId: string;
  probe(): Promise<readonly ProposalProbe[]>;
  /** The installed family extensions that declare proposed APIs. */
  installedFamilyIds(): readonly string[];
  /** The extension ids the install's runtime arguments already enable. */
  argvEnabled(): Promise<readonly string[]>;
  flags: SetupFlags;
  window: WindowClaim;
  showSetup(notice: SetupNotice): Promise<SetupAnswer>;
  showRestart(): Promise<RestartAnswer>;
  /** Opens the editor's runtime arguments for editing. */
  configureRuntimeArguments(): PromiseLike<unknown>;
  /** Settles `true` when the user saved and closed the runtime arguments after they were opened. */
  argvEdited(): Promise<boolean>;
  quit(): PromiseLike<unknown>;
  /** Records that the user's part of the setup failed; the setup never throws it at the activation. */
  logFailure(message: string): void;
}

/** How the user's part of the setup ended: it ran to its end, or a port failed and it was given up. */
export type InteractionOutcome = 'finished' | 'failed';

/** What one run decided, and the part of it that waits for the user. */
export interface SetupRun {
  decision: GateDecision;
  /** Settles when the user is done with what was shown; it never rejects, and the activation does not wait for it. */
  interaction: Promise<InteractionOutcome>;
}

/** Runs the user's part of the setup so that a failing port is logged once and ends it, never rejects. */
async function guarded(
  ports: SetupPorts,
  flow: () => Promise<void>,
): Promise<InteractionOutcome> {
  try {
    await flow();
    return 'finished';
  } catch (caught) {
    ports.logFailure(
      `the setup was given up: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return 'failed';
  }
}

/** Deletes the flags that are set; a flag that is not set is not written. */
async function clearFlags(flags: SetupFlags): Promise<void> {
  if (flags.dismissed()) {
    await flags.setDismissed(false);
  }
  if (flags.attemptPending()) {
    await flags.setAttemptPending(false);
  }
}

/** Offers the restart, and quits the editor if the user accepts. */
async function offerRestart(ports: SetupPorts): Promise<void> {
  if ((await ports.showRestart()) === 'quit') {
    await ports.quit();
  }
}

/** After the user opened the runtime arguments: wait for the edit, remember it, offer the restart. */
async function afterConfigure(ports: SetupPorts): Promise<void> {
  await ports.configureRuntimeArguments();
  if (!(await ports.argvEdited())) {
    return;
  }
  await ports.flags.setAttemptPending(true);
  await offerRestart(ports);
}

/** Shows the notice and follows the user's answer. */
async function converse(ports: SetupPorts, notice: SetupNotice): Promise<void> {
  if ((await ports.showSetup(notice)) === 'notNow') {
    await ports.flags.setDismissed(true);
    return;
  }
  await afterConfigure(ports);
}

/**
 * Probes the editor and, when a proposal is missing, tells the user once for the whole family. `activationTime` is
 * false after a use of a guarded member failed, which the dismissal does not silence. Every call probes again:
 * nothing is cached on success, and a probe that succeeds deletes the flags.
 */
export async function runSetup(
  ports: SetupPorts,
  activationTime: boolean,
): Promise<SetupRun> {
  const probes = await ports.probe();
  const attemptPending = ports.flags.attemptPending();
  const input: GateInput = {
    extensionId: ports.extensionId,
    probes: probes.map(probe => ({
      proposal: probe.proposal,
      result: probe.state,
    })),
    installedFamilyIds: ports.installedFamilyIds(),
    argvEnabled: await ports.argvEnabled(),
    // After an attempt of the user's, a failure is told whatever they said before.
    dismissed: ports.flags.dismissed() && !attemptPending,
    activationTime,
    windowClaimedBy: undefined,
  };
  let decision = decide(input);
  if (decision.kind === 'notify') {
    // Only an extension that has something to tell takes the window.
    const {holder} = await ports.window.claim(ports.extensionId);
    if (holder !== ports.extensionId) {
      decision = decide({...input, windowClaimedBy: holder ?? UNKNOWN_HOLDER});
    }
  }
  if (decision.kind === 'proceed' && decision.missing.length === 0) {
    await clearFlags(ports.flags);
  }
  if (decision.kind !== 'notify') {
    return {decision, interaction: Promise.resolve('finished')};
  }
  if (input.argvEnabled.includes(ports.extensionId)) {
    // The runtime arguments already list this extension, so only the restart is missing.
    return {
      decision,
      interaction: guarded(ports, () => offerRestart(ports)),
    };
  }
  if (attemptPending) {
    await ports.flags.setAttemptPending(false);
  }
  const notice: SetupNotice = attemptPending
    ? {kind: 'failedAttempt'}
    : {kind: 'setup', argvEntries: decision.argvEntries};
  return {
    decision,
    interaction: guarded(ports, () => converse(ports, notice)),
  };
}
