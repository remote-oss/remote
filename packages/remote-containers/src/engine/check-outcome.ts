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

/** What a failing query's stderr says: the user may not use the engine, the program isn't there, or the engine failed. */
type StderrOutcome = 'permission' | 'notFound' | 'engineError';

/** The start of a line the Docker CLI writes for its own warnings, which are not its verdict. */
const WARNING_PREFIX = 'WARNING:';

/**
 * The starts of the lines with which the Docker CLI reports its own transport and daemon failures. What follows such a
 * line may be another program's text: the daemon's reply, or an ssh host's stderr.
 */
const ENGINE_FAILURE_PREFIXES: readonly string[] = [
  'Error response from daemon:',
  'error during connect:',
  'failed to connect to the docker API at ',
  'Cannot connect to the Docker daemon at ',
];

/**
 * What a failing query's stderr says: the Docker CLI's own warnings are skipped, a line that starts with one of its
 * transport or daemon prefixes decides an engine failure whatever else stderr holds, and the text rule (permission denied, then not found) applies only to the lines that are left.
 */
function stderrOutcomeOf(stderr: string): StderrOutcome {
  const lines = stderr
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => !line.startsWith(WARNING_PREFIX));
  if (
    lines.some(line =>
      ENGINE_FAILURE_PREFIXES.some(prefix => line.startsWith(prefix)),
    )
  ) {
    return 'engineError';
  }
  if (lines.some(line => /permission denied/i.test(line))) {
    return 'permission';
  }
  return lines.some(line => /not ?found/i.test(line))
    ? 'notFound'
    : 'engineError';
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
  return stderrOutcomeOf(query.stderr);
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
    detail: stderrOutcomeOf(query.stderr) === 'permission' ? 'S104' : 'S144',
  };
}
