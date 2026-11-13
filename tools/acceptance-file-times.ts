/**
 * @fileoverview acceptance-file-times: mocha's default reporter that also prints, when the run ends, how long each test
 * file took, from the start of its first suite to the end of its last, hooks included:
 *
 *     acceptance: file <suite folder>/<file> <seconds>
 *
 * The plain launches run with it, so a run's log holds the minutes the parts table is made from. When
 * REMOTE_OSS_ACCEPTANCE_OUTCOME names a file, it also writes the run's outcome there at its end: each failed row or hook
 * with its message, each passed row, and that the run ended (tools/known-reds.ts reads it).
 */

import {writeFileSync} from 'node:fs';
import path from 'node:path';
import Mocha from 'mocha';
import {
  OUTCOME_VARIABLE,
  type LaunchOutcome,
  type OutcomeRow,
} from './known-reds.ts';

const {
  constants: {
    EVENT_RUN_END,
    EVENT_SUITE_BEGIN,
    EVENT_SUITE_END,
    EVENT_TEST_FAIL,
    EVENT_TEST_PASS,
  },
} = Mocha.Runner;

/** The row `runnable` is, by its file (suite folder and name) and its own title. */
export function outcomeRowOf(runnable: Mocha.Runnable): OutcomeRow {
  const file = runnable.file ?? '';
  return {
    file: `${path.basename(path.dirname(file))}/${path.basename(file)}`,
    title: runnable.title,
  };
}

/** The first line of what failed `runnable`. */
function firstLineOf(failure: unknown): string {
  const text =
    failure instanceof Error
      ? failure.message
      : typeof failure === 'string'
        ? failure
        : JSON.stringify(failure);
  return text.split('\n')[0] ?? '';
}

/** The line of one file: its suite folder and name, and its seconds to one decimal. */
export function fileTimeLine(file: string, seconds: number): string {
  return `acceptance: file ${path.basename(path.dirname(file))}/${path.basename(file)} ${seconds.toFixed(1)}`;
}

/** Mocha's default report, and the time of each file of the run's top-level suites. */
class FileTimes extends Mocha.reporters.Spec {
  /** Reports `runner`'s run as the default reporter does, and keeps each file's time for the end. */
  constructor(runner: Mocha.Runner, options?: Mocha.MochaOptions) {
    super(runner, options);
    const started = new Map<string, number>();
    const seconds = new Map<string, number>();
    runner.on(EVENT_SUITE_BEGIN, (suite: Mocha.Suite) => {
      if (suite.file !== undefined && suite.parent?.root === true) {
        started.set(suite.file, performance.now());
      }
    });
    runner.on(EVENT_SUITE_END, (suite: Mocha.Suite) => {
      const begun =
        suite.file === undefined ? undefined : started.get(suite.file);
      if (
        suite.file !== undefined &&
        begun !== undefined &&
        suite.parent?.root === true
      ) {
        seconds.set(
          suite.file,
          (seconds.get(suite.file) ?? 0) + (performance.now() - begun) / 1000,
        );
      }
    });
    const outcome: LaunchOutcome = {ended: false, failures: [], passes: []};
    runner.on(EVENT_TEST_PASS, (test: Mocha.Test) => {
      outcome.passes.push(outcomeRowOf(test));
    });
    runner.on(EVENT_TEST_FAIL, (runnable: Mocha.Runnable, failure: unknown) => {
      outcome.failures.push({
        ...outcomeRowOf(runnable),
        kind:
          (runnable as Mocha.Hook | Mocha.Test).type === 'hook'
            ? 'hook'
            : 'test',
        message: firstLineOf(failure),
      });
    });
    runner.once(EVENT_RUN_END, () => {
      for (const [file, total] of seconds) {
        console.log(fileTimeLine(file, total));
      }
      const outcomeFile = process.env[OUTCOME_VARIABLE];
      if (outcomeFile !== undefined && outcomeFile !== '') {
        writeFileSync(outcomeFile, JSON.stringify({...outcome, ended: true}));
      }
    });
  }
}

// Mocha takes a reporter as the module's value: `require` of this module gives the class.
export {FileTimes as 'module.exports'};
