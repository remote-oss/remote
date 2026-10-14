/**
 * @fileoverview The default extensions of a connection to a server that already runs: the entries of the setting are
 * filtered to extension identifiers, and each kept one is installed on the host through the server's own command
 * line. A failure never fails the connection; it is logged for the extension it belongs to.
 */

import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {ExtensionEntries} from '../policy/record.ts';
import type {ScriptParameters} from '../scripts/bootstrap.ts';
import {runStep, type StepRun} from './run-step.ts';

/** Whether an extension entry has the shape `<publisher>.<name>` of an extension identifier. */
export function isExtensionIdentifier(entry: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9-]*$/.test(entry);
}

/**
 * The entries that are kept, in the order and with the casing written: the extension identifiers, or every entry
 * under `asWritten`, which leaves the server to skip what it cannot install. Each entry is logged, as kept or as
 * dropped.
 */
export function keptExtensions(
  entries: readonly string[],
  logger: Logger,
  mode: ExtensionEntries,
): string[] {
  const kept: string[] = [];
  for (const entry of entries) {
    if (mode === 'asWritten' || isExtensionIdentifier(entry)) {
      kept.push(entry);
      logger.info(`default extension: ${entry}`);
    } else {
      logger.warn(
        `default extension dropped, not <publisher>.<name>: ${entry}`,
      );
    }
  }
  return kept;
}

/** What happened to one extension on the host. */
export interface ExtensionResult {
  id: string;
  installed: boolean;
  /** The last line the host's command printed; empty when it printed none. */
  message: string;
}

/** Why the host was not asked, or did not answer: `cancelled` by the caller, `deadline` for the step's time limit. */
export type ExtensionsNotRun =
  'cancelled' | 'deadline' | 'channelFailed' | 'noResultBlock' | 'scriptFailed';

/** How long the whole install may take before the step is given up and the connection goes on. */
const EXTENSIONS_DEADLINE_MILLISECONDS = 120_000;

/** How the install of the default extensions ended; it is never an error. */
export type ExtensionsOutcome =
  | {kind: 'done'; results: ExtensionResult[]}
  | {kind: 'notRun'; reason: ExtensionsNotRun};

const NO_ANSWER = 'the host gave no answer for this extension';

function logResult(logger: Logger, result: ExtensionResult): void {
  if (result.installed) {
    logger.info(`default extension installed: ${result.id}`);
  } else {
    logger.warn(
      `default extension not installed: ${result.id}: ${result.message}`,
    );
  }
}

/** Why a step run that did not end in an `Ok` result did not install anything. */
function notRunReason(
  stepRun: StepRun,
  cancellation: AbortSignal,
): ExtensionsNotRun {
  if (stepRun.kind === 'result') {
    return 'scriptFailed';
  }
  if (stepRun.kind === 'noResultBlock') {
    return stepRun.kind;
  }
  if (stepRun.failure.kind !== 'cancelled') {
    return 'channelFailed';
  }
  return cancellation.aborted ? 'cancelled' : 'deadline';
}

/**
 * Installs the default extensions on the host of a server that already runs, one after the other. Entries that are
 * not extension identifiers are dropped, and with none left the host is not contacted. The step has a deadline, after
 * which it is given up and the extensions are logged as not installed. Every failure, of one extension or of the
 * whole step, is logged per extension and returned as a value; a cancellation by the caller is returned without
 * a log line per extension.
 */
export async function installExtensions(
  channel: HostChannel,
  base: ScriptParameters,
  entries: readonly string[],
  logger: Logger,
  cancellation: AbortSignal,
  deadlineMilliseconds: number = EXTENSIONS_DEADLINE_MILLISECONDS,
): Promise<ExtensionsOutcome> {
  const extensions = keptExtensions(entries, logger, 'identifiersOnly');
  if (extensions.length === 0) {
    return {kind: 'done', results: []};
  }
  const stepRun = await runStep(
    channel,
    {installMode: 'singleScript', step: 'installExtensions'},
    {...base, start: {...base.start, extensions}},
    {
      cancellation: AbortSignal.any([
        cancellation,
        AbortSignal.timeout(deadlineMilliseconds),
      ]),
    },
  );
  if (stepRun.kind !== 'result' || stepRun.block.status !== 'Ok') {
    const reason = notRunReason(stepRun, cancellation);
    if (reason === 'cancelled') {
      return {kind: 'notRun', reason};
    }
    for (const extension of extensions) {
      logger.warn(`default extension not installed: ${extension}: ${reason}`);
    }
    return {kind: 'notRun', reason};
  }
  const facts = stepRun.block.serverFacts;
  const results = extensions.map((extension, position): ExtensionResult => {
    const prefix = `extension.${String(position)}`;
    return {
      id: extension,
      installed: facts[`${prefix}.status`] === 'installed',
      message: facts[`${prefix}.message`] ?? NO_ANSWER,
    };
  });
  for (const result of results) {
    logResult(logger, result);
  }
  return {kind: 'done', results};
}
