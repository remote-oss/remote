/**
 * @fileoverview The checks of the Docker CLI: the first check before a reload or a picker, which shows its own
 * dialogs; the second check inside the resolve, which shows nothing; and the current context.
 */

import type {Logger} from 'lib-log';
import {
  BUTTON_LINKS,
  dialogOf,
  type EngineButton,
  type Translate,
} from '../surfaces/engine-dialogs.ts';
import {
  firstCheckOutcomeOf,
  type QueryResult,
  type SecondCheckOutcome,
  secondCheckOutcomeOf,
} from './check-outcome.ts';
import {type Executable, executableOf} from './executable.ts';
import type {EngineHost} from './engine-host.ts';

/** How long one query may take, in milliseconds. */
const QUERY_TIMEOUT_MILLISECONDS = 60_000;

/** The modal error dialog and the other editor actions the first check needs. */
export interface EngineDialogPort {
  /** Shows a modal error with its detail and buttons; undefined when the user cancelled. */
  showError(
    message: string,
    detail: string,
    items: readonly string[],
  ): Promise<string | undefined>;
  openExternal(address: string): Promise<unknown>;
  revealLog(): void;
}

/** Everything the checks need from their surroundings. */
export interface PreflightDependencies {
  /** The program for a file, made once the setting has named it. */
  engineFor(file: string): EngineHost;
  /** `dev.containers.dockerPath` as the editor reports it now. */
  dockerPath(): unknown;
  dialogs: EngineDialogPort;
  translate: Translate;
  /** Calls `callback` after `milliseconds`; the result stops the wait. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  clock(): number;
  logger: Logger;
  /** The PATH of the extension host, for the line that names where a program was looked for. */
  searchPath(): string;
}

/** How the first check ended for its caller: the window may go on, or it must not. */
export type FirstCheckResult = 'proceed' | 'stopped';

/** What a query printed, spelled the way the log names it: the exit status, or the code of a failed spawn. */
function exitText(result: QueryResult): string {
  if (result.kind === 'failed') {
    return /\bE[A-Z]+\b/.exec(result.detail)?.[0] ?? 'failed';
  }
  return result.status === undefined ? 'signal' : String(result.status);
}

/** Runs one query with the check's timer, and logs it. */
async function query(
  dependencies: PreflightDependencies,
  executable: Extract<Executable, {kind: 'spawn'}>,
  argv: readonly string[],
  cancellation: AbortSignal,
): Promise<QueryResult> {
  const timedOut = new AbortController();
  const cancelTimer = dependencies.setTimer(QUERY_TIMEOUT_MILLISECONDS, () => {
    timedOut.abort();
  });
  const started = dependencies.clock();
  const outcome = await dependencies
    .engineFor(executable.file)
    .run(
      argv,
      {kind: 'none'},
      {cancellation: AbortSignal.any([cancellation, timedOut.signal])},
    );
  cancelTimer();
  const result: QueryResult =
    outcome.kind === 'failed'
      ? outcome
      : {...outcome, timedOut: timedOut.signal.aborted};
  dependencies.logger.debug(
    `docker: ${argv.join(' ')} → ${exitText(result)} (${String(dependencies.clock() - started)} ms)`,
  );
  if (result.kind === 'failed' && /\bENOENT\b/.test(result.detail)) {
    dependencies.logger.warn(
      `${executable.written} was not found; PATH: ${dependencies.searchPath()}`,
    );
  }
  return result;
}

/** Whether a query ran to an exit of 0 in time. */
function succeeded(result: QueryResult): boolean {
  return result.kind === 'ran' && !result.timedOut && result.status === 0;
}

/** What choosing a button does; resolves what the caller does next. */
async function chosen(
  dependencies: PreflightDependencies,
  button: EngineButton | undefined,
): Promise<FirstCheckResult> {
  if (button === undefined) {
    return 'stopped';
  }
  const {action} = button;
  if (action === 'ignore') {
    return 'proceed';
  }
  if (action === 'showLog') {
    dependencies.dialogs.revealLog();
    return 'stopped';
  }
  await dependencies.dialogs.openExternal(BUTTON_LINKS[action]);
  return 'stopped';
}

/**
 * The first check, before a reload or a picker: the client version, then the structured version. It shows one modal
 * error dialog for any outcome but a pass and resolves `proceed` for a pass and for the dialog's "Ignore", `stopped`
 * otherwise. Nothing is remembered: every call runs both queries again.
 */
export async function firstCheck(
  dependencies: PreflightDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<FirstCheckResult> {
  const executable = executableOf(dependencies.dockerPath(), base);
  const queries: QueryResult[] = [];
  if (executable.kind === 'spawn') {
    const first = await query(
      dependencies,
      executable,
      ['--version'],
      cancellation,
    );
    queries.push(first);
    if (succeeded(first)) {
      queries.push(
        await query(
          dependencies,
          executable,
          ['version', '--format', '{{json .}}'],
          cancellation,
        ),
      );
    }
  }
  const outcome = firstCheckOutcomeOf(executable, queries);
  if (outcome === 'passed') {
    return 'proceed';
  }
  const dialog = dialogOf(outcome, executable.written, dependencies.translate);
  const label = await dependencies.dialogs.showError(
    dialog.message,
    dialog.detail,
    dialog.buttons.map(button => button.label),
  );
  return chosen(
    dependencies,
    dialog.buttons.find(button => button.label === label),
  );
}

/**
 * The second check, inside the resolve: the full version query. It shows nothing; a failure carries the id of the text
 * that names its reason.
 */
export async function secondCheck(
  dependencies: PreflightDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<SecondCheckOutcome> {
  const executable = executableOf(dependencies.dockerPath(), base);
  if (executable.kind === 'notFound') {
    return secondCheckOutcomeOf(executable, {kind: 'failed', detail: ''});
  }
  return secondCheckOutcomeOf(
    executable,
    await query(dependencies, executable, ['version'], cancellation),
  );
}

/** The name of the current Docker context, or undefined for the default one or when it can't be read. */
export async function currentContext(
  dependencies: PreflightDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  const executable = executableOf(dependencies.dockerPath(), base);
  if (executable.kind === 'spawn') {
    const result = await query(
      dependencies,
      executable,
      ['context', 'show'],
      cancellation,
    );
    if (succeeded(result) && result.kind === 'ran') {
      const name = result.stdout.trim();
      return name === '' || name === 'default' ? undefined : name;
    }
    dependencies.logger.warn(
      `the Docker context could not be read: ${exitText(result)}`,
    );
    return undefined;
  }
  dependencies.logger.warn('the Docker context could not be read: not found');
  return undefined;
}
