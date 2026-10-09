/**
 * @fileoverview The decisions of the proposed-API gate: from what the probes found, who may tell the user, and which
 * extension ids the runtime arguments should list. It reads no state and shows nothing; the caller supplies the flags
 * and acts on the decision.
 */

/** What a probe found: the editor grants the proposal, does not, or gives no way to tell. */
export type ProbeResult = 'granted' | 'missing' | 'unprobeable';

/** The result of probing one proposal. */
export interface ProbeReport {
  proposal: string;
  result: ProbeResult;
}

/** Everything a decision rests on, read by the caller. */
export interface GateInput {
  extensionId: string;
  probes: readonly ProbeReport[];
  /** The family extensions installed in this editor, this one included. */
  installedFamilyIds: readonly string[];
  /** The ids the install's runtime arguments already enable. */
  argvEnabled: readonly string[];
  /** Whether the user declined the setup. */
  dismissed: boolean;
  /** True at activation, false after the use of a guarded member failed. */
  activationTime: boolean;
  /** The extension that holds the window's notification, if one does. */
  windowClaimedBy: string | undefined;
}

/** What the extension does about the probes. */
export type GateDecision =
  /** Nothing is missing, or what is missing is not told at this moment. */
  | {
      kind: 'proceed';
      granted: readonly string[];
      missing: readonly string[];
    }
  /** This extension shows the window's one notification. */
  | {
      kind: 'notify';
      claimWindow: true;
      argvEntries: readonly string[];
      missing: readonly string[];
    }
  /** Another extension holds the window's notification. */
  | {kind: 'silent'; missing: readonly string[]};

/**
 * The ids to offer for the runtime arguments: this extension first, then the other installed family extensions in
 * the order given, each once, none that the arguments already enable, and never the bare switch or an empty id.
 */
export function argvEntryList(
  ownId: string,
  installed: readonly string[],
  enabled: readonly string[],
): string[] {
  const wanted = new Set(
    [ownId, ...installed].filter(
      identifier => identifier !== '' && identifier !== '*',
    ),
  );
  return [...wanted].filter(identifier => !enabled.includes(identifier));
}

function namesOf(
  probes: readonly ProbeReport[],
  result: ProbeResult,
): string[] {
  return probes
    .filter(probe => probe.result === result)
    .map(probe => probe.proposal);
}

/**
 * Decides from the probes. A proposal that cannot be probed counts as neither granted nor missing. The user is told
 * only when something is missing, not when a declined setup silences the activation (a failed use is not silenced),
 * and only by the extension that holds the window or, when none does, by this one.
 */
export function decide(input: GateInput): GateDecision {
  const granted = namesOf(input.probes, 'granted');
  const missing = namesOf(input.probes, 'missing');
  if (missing.length === 0 || (input.dismissed && input.activationTime)) {
    return {kind: 'proceed', granted, missing};
  }
  if (
    input.windowClaimedBy !== undefined &&
    input.windowClaimedBy !== input.extensionId
  ) {
    return {kind: 'silent', missing};
  }
  return {
    kind: 'notify',
    claimWindow: true,
    argvEntries: argvEntryList(
      input.extensionId,
      input.installedFamilyIds,
      input.argvEnabled,
    ),
    missing,
  };
}
