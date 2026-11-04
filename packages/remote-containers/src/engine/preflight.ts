/**
 * @fileoverview The checks of the Docker CLI: the first check before a reload or a picker, which shows its own
 * dialogs; the second check inside the resolve, which shows nothing; and the current context.
 */

import type {Logger} from 'lib-log';
import {
  BUTTON_LINKS,
  composeDialogOf,
  dashHostDialogOf,
  dialogOf,
  type EngineButton,
  type EngineDialog,
  type Translate,
} from '../surfaces/engine-dialogs.ts';
import {
  firstCheckOutcomeOf,
  type FirstCheckOutcome,
  type QueryResult,
  type SecondCheckOutcome,
  secondCheckOutcomeOf,
} from './check-outcome.ts';
import {
  type CheckResult,
  checkAndStart,
  type DesktopPorts,
} from './check-and-start.ts';
import {type ComposeRoute, composeRouteOf} from './compose-route.ts';
import {type Executable, executableOf} from './executable.ts';
import type {EngineHost} from './engine-host.ts';
import {type BoxCounter, pausableTimer} from './pausable-timer.ts';
import {dashHostOf, sshHostOf} from './ssh-endpoint.ts';
import {apiCheckSkipped} from './version-reply.ts';

/** The log line of a first check whose version reply names no server API version. */
const API_CHECK_SKIPPED =
  "the engine's version reply names no server API version; the API check was skipped";

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
  /** The boxes an SSH endpoint's questions open; a query's timer waits while one is open. */
  boxes?: BoxCounter;
  /** The address the Docker CLI will talk to now (`endpointInEffect`); a check that has none reads every endpoint as local. */
  endpoint?(
    base: string | undefined,
    cancellation: AbortSignal,
  ): Promise<string | undefined>;
  /** Starts Docker Desktop when the second check finds the daemon down; a host without it has none. */
  desktop?: DesktopPorts;
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
  const cancelTimer = pausableTimer(
    (milliseconds, callback) => dependencies.setTimer(milliseconds, callback),
    QUERY_TIMEOUT_MILLISECONDS,
    () => {
      timedOut.abort();
    },
    dependencies.boxes,
  );
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

/** Shows the modal error dialog, and does what the chosen button does; resolves what the caller does next. */
async function shown(
  dependencies: PreflightDependencies,
  dialog: EngineDialog,
): Promise<FirstCheckResult> {
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

/** Runs `check` once, or, on a host that can start Docker Desktop, as the check of the check-and-start step. */
async function checkedOrStarted(
  desktop: DesktopPorts | undefined,
  check: (signal: AbortSignal) => Promise<CheckResult>,
  cancellation: AbortSignal,
): Promise<void> {
  if (desktop === undefined) {
    await check(cancellation);
  } else {
    await checkAndStart({...desktop, check}, cancellation);
  }
}

/** The first check's queries: the client version, then, if it ran, the structured version. */
async function firstQueries(
  dependencies: PreflightDependencies,
  executable: Executable,
  cancellation: AbortSignal,
): Promise<QueryResult[]> {
  if (executable.kind !== 'spawn') {
    return [];
  }
  const first = await query(
    dependencies,
    executable,
    ['--version'],
    cancellation,
  );
  return succeeded(first)
    ? [
        first,
        await query(
          dependencies,
          executable,
          ['version', '--format', '{{json .}}'],
          cancellation,
        ),
      ]
    : [first];
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
  const endpoint = await dependencies.endpoint?.(base, cancellation);
  const dashHost = dashHostOf(endpoint);
  if (dashHost !== undefined) {
    dependencies.logger.warn(
      `the Docker host over ssh starts with a dash: ${dashHost}`,
    );
    return shown(
      dependencies,
      dashHostDialogOf(dashHost, dependencies.translate),
    );
  }
  const viaSsh = endpoint !== undefined && sshHostOf(endpoint) !== undefined;
  const seen: {queries: QueryResult[]; outcome: FirstCheckOutcome} = {
    queries: [],
    outcome: 'passed',
  };
  async function check(signal: AbortSignal): Promise<CheckResult> {
    seen.queries = await firstQueries(dependencies, executable, signal);
    seen.outcome = firstCheckOutcomeOf(executable, seen.queries, viaSsh);
    const last = seen.queries.at(-1);
    return seen.outcome === 'passed'
      ? {passed: true}
      : {passed: false, errorText: last?.kind === 'ran' ? last.stderr : ''};
  }
  await checkedOrStarted(dependencies.desktop, check, cancellation);
  if (cancellation.aborted) {
    return 'stopped';
  }
  const structured = seen.queries[1];
  if (
    structured?.kind === 'ran' &&
    succeeded(structured) &&
    apiCheckSkipped(structured.stdout)
  ) {
    dependencies.logger.info(API_CHECK_SKIPPED);
  }
  if (seen.outcome === 'passed') {
    return 'proceed';
  }
  const dialog = dialogOf(
    seen.outcome,
    executable.written,
    dependencies.translate,
  );
  return shown(dependencies, dialog);
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
  const program = executable;
  let latest: SecondCheckOutcome = {kind: 'passed'};
  async function check(signal: AbortSignal): Promise<CheckResult> {
    const result = await query(dependencies, program, ['version'], signal);
    latest = secondCheckOutcomeOf(executable, result);
    return latest.kind === 'passed'
      ? {passed: true}
      : {passed: false, errorText: result.kind === 'ran' ? result.stderr : ''};
  }
  await checkedOrStarted(dependencies.desktop, check, cancellation);
  return latest;
}

/** What `docker context show` says: the current context, that the engine has no contexts, or nothing usable. */
export type ContextState =
  {kind: 'context'; name: string} | {kind: 'noContexts'} | {kind: 'unreadable'};

/**
 * What the engine says of its current context. An engine without the command (Podman exits 125) has no contexts: that
 * is no news. A spawn that failed, or a query that did not finish in time, still is.
 */
export async function contextState(
  dependencies: PreflightDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<ContextState> {
  const executable = executableOf(dependencies.dockerPath(), base);
  if (executable.kind === 'spawn') {
    const result = await query(
      dependencies,
      executable,
      ['context', 'show'],
      cancellation,
    );
    if (succeeded(result) && result.kind === 'ran') {
      return {kind: 'context', name: result.stdout.trim()};
    }
    const missing =
      result.kind === 'ran' && !result.timedOut && result.status !== undefined;
    dependencies.logger[missing ? 'debug' : 'warn'](
      `the Docker context could not be read: ${exitText(result)}`,
    );
    return missing ? {kind: 'noContexts'} : {kind: 'unreadable'};
  }
  dependencies.logger.warn('the Docker context could not be read: not found');
  return {kind: 'unreadable'};
}

/** The name of the current Docker context, or undefined for the default one or when it can't be read. */
export async function currentContext(
  dependencies: PreflightDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  const state = await contextState(dependencies, base, cancellation);
  return state.kind === 'context' &&
    state.name !== '' &&
    state.name !== 'default'
    ? state.name
    : undefined;
}

/** The endpoint the Docker context `name` (the default one when empty) points to, or undefined when it can't be read. */
export async function contextEndpoint(
  dependencies: PreflightDependencies,
  base: string | undefined,
  name: string,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  const executable = executableOf(dependencies.dockerPath(), base);
  if (executable.kind !== 'spawn') {
    return undefined;
  }
  const result = await query(
    dependencies,
    executable,
    [
      'context',
      'inspect',
      name === '' ? 'default' : name,
      '--format',
      '{{json .Endpoints.docker.Host}}',
    ],
    cancellation,
  );
  if (!succeeded(result) || result.kind !== 'ran') {
    dependencies.logger.debug(
      `the Docker context's endpoint could not be read: ${exitText(result)}`,
    );
    return undefined;
  }
  try {
    const endpoint: unknown = JSON.parse(result.stdout.trim());
    return typeof endpoint === 'string' ? endpoint : undefined;
  } catch {
    return undefined;
  }
}

/** What the Compose check needs besides what the engine checks do. */
export interface ComposeCheckDependencies extends PreflightDependencies {
  /** `dev.containers.dockerComposePath` as the editor reports it now. */
  composePath(): unknown;
}

/** The Compose that a configuration in `base` runs with now; nothing is shown. */
export function composeRoute(
  dependencies: ComposeCheckDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<ComposeRoute> {
  const docker = executableOf(dependencies.dockerPath(), base);
  return composeRouteOf(
    {
      docker:
        docker.kind === 'spawn'
          ? dependencies.engineFor(docker.file)
          : undefined,
      engineFor: file => dependencies.engineFor(file),
      composePath: () => dependencies.composePath(),
      base,
      logger: dependencies.logger,
    },
    cancellation,
  );
}

/**
 * The check of Compose before a reload, for a Compose configuration: it shows one modal error dialog when no Compose
 * can be used, and resolves `proceed` when one can, `stopped` otherwise. Nothing is remembered: every call resolves
 * Compose again.
 */
export async function composeCheck(
  dependencies: ComposeCheckDependencies,
  base: string | undefined,
  cancellation: AbortSignal,
): Promise<FirstCheckResult> {
  const route = await composeRoute(dependencies, base, cancellation);
  if (cancellation.aborted) {
    return 'stopped';
  }
  if (route.kind === 'plugin' || route.kind === 'standalone') {
    return 'proceed';
  }
  const dialog = composeDialogOf(route, dependencies.translate);
  return shown(dependencies, dialog);
}
