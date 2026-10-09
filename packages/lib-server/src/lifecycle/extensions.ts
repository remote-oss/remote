/**
 * @fileoverview The default extensions of a connection to a server that already runs: the entries of the setting are
 * filtered to extension identifiers, and each kept one is installed on the host through the server's own command
 * line. A failure never fails the connection; it is logged for the extension it belongs to.
 */

import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {ScriptParameters} from '../scripts/bootstrap.ts';
import {runStep} from './run-step.ts';

/** Whether an extension entry has the shape `<publisher>.<name>` of an extension identifier. */
export function isExtensionIdentifier(entry: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9-]*$/.test(entry);
}

/**
 * The entries that are extension identifiers, in the order and with the casing written. Each entry is logged, as
 * kept or as dropped.
 */
export function keptExtensions(
  entries: readonly string[],
  logger: Logger,
): string[] {
  const kept: string[] = [];
  for (const entry of entries) {
    if (isExtensionIdentifier(entry)) {
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

/** Why the host was not asked, or did not answer. */
export type ExtensionsNotRun =
  'channelFailed' | 'noResultBlock' | 'scriptFailed';

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

/**
 * Installs the default extensions on the host of a server that already runs, one after the other. Entries that are
 * not extension identifiers are dropped, and with none left the host is not contacted. Every failure, of one
 * extension or of the whole step, is logged per extension and returned as a value.
 */
export async function installExtensions(
  channel: HostChannel,
  base: ScriptParameters,
  entries: readonly string[],
  logger: Logger,
  cancellation: AbortSignal,
): Promise<ExtensionsOutcome> {
  const extensions = keptExtensions(entries, logger);
  if (extensions.length === 0) {
    return {kind: 'done', results: []};
  }
  const stepRun = await runStep(
    channel,
    {installMode: 'singleScript', step: 'installExtensions'},
    {...base, start: {...base.start, extensions}},
    {cancellation},
  );
  if (stepRun.kind !== 'result' || stepRun.block.status !== 'Ok') {
    const reason: ExtensionsNotRun =
      stepRun.kind === 'result' ? 'scriptFailed' : stepRun.kind;
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
