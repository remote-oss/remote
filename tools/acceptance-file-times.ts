/**
 * @fileoverview acceptance-file-times: mocha's default reporter that also prints, when the run ends, how long each test
 * file took, from the start of its first suite to the end of its last, hooks included:
 *
 *     acceptance: file <suite folder>/<file> <seconds>
 *
 * The plain launches run with it, so a run's log holds the minutes the parts table is made from.
 */

import path from 'node:path';
import Mocha from 'mocha';

const {
  constants: {EVENT_RUN_END, EVENT_SUITE_BEGIN, EVENT_SUITE_END},
} = Mocha.Runner;

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
    runner.once(EVENT_RUN_END, () => {
      for (const [file, total] of seconds) {
        console.log(fileTimeLine(file, total));
      }
    });
  }
}

/**
 * Mocha takes a reporter as the module's value: `require` of this module gives the class. The plain launches name the
 * module by its path (acceptance-plain.ts), so no module imports it.
 *
 * @public
 */
export {FileTimes as 'module.exports'};
