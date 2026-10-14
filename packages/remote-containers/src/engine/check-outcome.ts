import type {Executable} from './executable.ts';
import {isBelowMinimum, serverApiOf} from './version-reply.ts';

/** What one query to the engine came to: it ran, or it could not be spawned. */
export type QueryResult =
  | {
      kind: 'ran';
      status: number | undefined;
      stdout: string;
      stderr: string;
      /** Whether the check's own timer ended the query. */
      timedOut: boolean;
    }
  | {kind: 'failed'; detail: string};

/** How the first check ended. */
export type FirstCheckOutcome =
  'passed' | 'notFound' | 'permission' | 'tooOld' | 'engineError';

/** The detail of a failed second check: the text id of the dialog's reason. */
type SecondCheckFailure = 'S339' | 'S104' | 'S144';

/** How the second check ended. */
export type SecondCheckOutcome =
  {kind: 'passed'} | {kind: 'failed'; detail: SecondCheckFailure};

/** The engine refused: the stderr says the user may not use it. */
function isPermissionDenied(stderr: string): boolean {
  return /permission denied/i.test(stderr);
}

/** The outcome of one query that does not pass, or undefined when it exited 0 in time. */
function failureOf(
  query: QueryResult,
): Exclude<FirstCheckOutcome, 'passed' | 'tooOld'> | undefined {
  if (query.kind === 'failed') {
    return /\bENOENT\b/.test(query.detail) ? 'notFound' : 'engineError';
  }
  if (query.timedOut) {
    return 'engineError';
  }
  if (query.status === 0) {
    return undefined;
  }
  if (isPermissionDenied(query.stderr)) {
    return 'permission';
  }
  return /not ?found/i.test(query.stderr) ? 'notFound' : 'engineError';
}

/**
 * Classifies the first check from its queries in the order they ran: the client version, then the structured
 * version. Only the stderr of a failing query is read; the API version of the structured reply decides `tooOld`.
 */
export function firstCheckOutcomeOf(
  executable: Executable,
  queries: readonly QueryResult[],
): FirstCheckOutcome {
  if (executable.kind === 'notFound') {
    return 'notFound';
  }
  for (const query of queries) {
    const failure = failureOf(query);
    if (failure !== undefined) {
      return failure;
    }
  }
  const structured = queries.at(1);
  return structured?.kind === 'ran' &&
    isBelowMinimum(serverApiOf(structured.stdout))
    ? 'tooOld'
    : 'passed';
}

/** Classifies the second check, which runs the full version query once inside the resolve. */
export function secondCheckOutcomeOf(
  executable: Executable,
  query: QueryResult,
): SecondCheckOutcome {
  if (executable.kind === 'notFound' || query.kind === 'failed') {
    return {kind: 'failed', detail: 'S339'};
  }
  if (query.timedOut) {
    return {kind: 'failed', detail: 'S144'};
  }
  if (query.status === 0) {
    return {kind: 'passed'};
  }
  return {
    kind: 'failed',
    detail: isPermissionDenied(query.stderr) ? 'S104' : 'S144',
  };
}
