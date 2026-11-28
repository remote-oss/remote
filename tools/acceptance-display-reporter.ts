/**
 * @fileoverview acceptance-display-reporter: the file-times reporter that the ssh-core launch's mocha runs with,
 * printing after the end of each of its files, and at the end of the run, the display's visible windows, each with its
 * name, its WM_CLASS and whether the window manager manages it (#3210), so the launch's log says which of its files
 * left which windows on the display, and what the run left there.
 *
 *     acceptance: display <suite>/<file> <windows>
 *
 * The run gives the suite its lines print under in `HARNESS_ACCEPTANCE_SUITE`, and a run that names no suite prints
 * its default report alone. A display that gives no answer at a file's end says so in place of its list.
 */

import path from 'node:path';
import Mocha from 'mocha';
import {
  type ListedWindow,
  listedWindows,
} from '../tests/acceptance/windows/display.ts';
import {'module.exports' as FileTimes} from './acceptance-file-times.ts';

const {
  constants: {EVENT_RUN_END, EVENT_SUITE_END},
} = Mocha.Runner;

/** The variable a launch's run gives for the suite its display lines print under. */
export const HARNESS_SUITE_VARIABLE = 'HARNESS_ACCEPTANCE_SUITE';

/** The line of a file of `suite`: the display's window count, and each window with its name, its WM_CLASS and its managedness. */
export function displayLine(
  suite: string,
  file: string,
  windows: readonly ListedWindow[],
): string {
  const named = windows
    .map(
      each =>
        `${each.id} (${each.name === '' ? 'no name' : each.name}, WM_CLASS ${each.windowClass}, ${
          each.managed ? 'managed' : 'no WM_STATE'
        })`,
    )
    .join(', ');
  return `acceptance: display ${suite}/${path.basename(file, '.cjs')}: ${String(
    windows.length,
  )} windows: ${named}`;
}

/** The line of a file of `suite` whose readout the display does not answer. */
export function displayNoAnswerLine(
  suite: string,
  file: string,
  answer: unknown,
): string {
  const message =
    answer instanceof Error
      ? answer.message
      : typeof answer === 'string'
        ? answer
        : JSON.stringify(answer);
  return `acceptance: display ${suite}/${path.basename(file, '.cjs')}: the display gave no answer: ${
    message.split('\n')[0] ?? ''
  }`;
}

/**
 * The read of the display's windows a reporter's lines take, from its `listWindows` option: the harness's display
 * while the option does not stand one in its place.
 */
export function displayReadoutOf(
  options?: Mocha.MochaOptions,
): () => ListedWindow[] {
  const stoodIn = (options?.reporterOptions ?? {}) as {
    listWindows?: () => ListedWindow[];
  };
  return typeof stoodIn.listWindows === 'function'
    ? stoodIn.listWindows
    : listedWindows;
}

/** The file-times report of a launch's run, and the display's windows after the end of each of the run's files. */
class DisplayReporter extends FileTimes {
  /** Reports the run as the default reporter does, and says the display's windows at each file's end and at the run's end. */
  constructor(runner: Mocha.Runner, options?: Mocha.MochaOptions) {
    super(runner, options);
    const launchSuite = process.env[HARNESS_SUITE_VARIABLE] ?? '';
    if (launchSuite === '') {
      return;
    }
    const readout = displayReadoutOf(options);
    function sayDisplay(file: string): void {
      let line: string;
      try {
        line = displayLine(launchSuite, file, readout());
      } catch (caught) {
        line = displayNoAnswerLine(launchSuite, file, caught);
      }
      console.log(line);
    }
    runner.on(EVENT_SUITE_END, (suite: Mocha.Suite) => {
      if (suite.file === undefined || suite.parent?.root !== true) {
        return;
      }
      sayDisplay(suite.file);
    });
    runner.once(EVENT_RUN_END, () => {
      sayDisplay('run');
    });
  }
}

// Mocha takes a reporter as the module's value: `require` of this module gives the class.
export {DisplayReporter as 'module.exports'};
