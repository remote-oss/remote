/**
 * @fileoverview The tunnels conformance run's rows and their verdict: each row runs against the started stack, prints
 * one line, and the run fails on any red the known-red list doesn't excuse on a pull request.
 */

import {
  type KnownRed,
  type LaunchOutcome,
  verdictOf,
} from '../../tools/known-reds.ts';
import type {Stack} from './stack.ts';

/** The launch name the run's known-red entries carry. */
export const CONFORMANCE_LAUNCH = 'tunnels-conformance';

/** One row: the suite file it belongs to, its title, and its check, which throws when the row is red. */
export interface ConformanceRow {
  file: string;
  title: string;
  check(stack: Stack): Promise<void>;
}

/** Runs `rows` against `stack` one after another, writing a line for each, and gives what the run ended with. */
export async function runRows(
  rows: readonly ConformanceRow[],
  stack: Stack,
  write: (line: string) => void,
): Promise<LaunchOutcome> {
  const outcome: LaunchOutcome = {ended: true, failures: [], passes: []};
  for (const each of rows) {
    try {
      await each.check(stack);
      outcome.passes.push({file: each.file, title: each.title});
      write(`${CONFORMANCE_LAUNCH}: ok ${each.title}`);
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : String(failure);
      outcome.failures.push({
        kind: 'test',
        file: each.file,
        title: each.title,
        message,
      });
      write(`${CONFORMANCE_LAUNCH}: FAIL ${each.title}: ${message}`);
    }
  }
  return outcome;
}

/**
 * Whether the run passes: on a pull request a red the list names for this launch is excused, and on every other event
 * the list changes nothing. The lines say what was excused and which listed rows are green now.
 */
export function verdictLinesOf(
  outcome: LaunchOutcome,
  knownReds: readonly KnownRed[],
  pullRequest: boolean,
): {passes: boolean; lines: string[]} {
  const verdict = verdictOf(
    CONFORMANCE_LAUNCH,
    outcome,
    pullRequest ? knownReds : [],
  );
  return {
    passes: verdict.passes,
    lines: [
      ...verdict.excused.map(
        ({entry}) =>
          `${CONFORMANCE_LAUNCH}: excused on #${String(entry.card)}: ${entry.title}`,
      ),
      ...verdict.nowGreen.map(
        entry =>
          `${CONFORMANCE_LAUNCH}: now green, remove its entry from tools/known-reds.json (#${String(entry.card)}): ${entry.title}`,
      ),
    ],
  };
}
