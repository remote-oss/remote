/**
 * @fileoverview acceptance-display-reporter: the spec reporter a launch's window runs with, saying the display's
 * visible windows after the end of each of the run's files.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync, type SpawnSyncReturns} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Mocha from 'mocha';
import type {ListedWindow} from '../tests/acceptance/windows/display.ts';
import {
  displayLine,
  displayNoAnswerLine,
  displayReadoutOf,
  HARNESS_SUITE_VARIABLE,
  'module.exports' as DisplayReporter,
} from './acceptance-display-reporter.ts';
import {REPOSITORY_ROOT} from './repository.ts';

/** The windows a stand-in gives instead of the harness display. */
const STOOD_WINDOWS: ListedWindow[] = [
  {
    id: '514',
    name: 'VSCodium - Insiders',
    windowClass: '"VSCodium", "VSCodium"',
    managed: false,
  },
  {id: '4194465', name: '', windowClass: 'none', managed: true},
];

/** The expected line of the stand-in's windows, under a suite and a file. */
const STOOD_LINE =
  'acceptance: display ssh-core/first.test: 2 windows: 514 (VSCodium - Insiders, WM_CLASS "VSCodium", "VSCodium", no WM_STATE), 4194465 (no name, WM_CLASS none, managed)';

/** The reporter's listeners for the end of a suite and the end of the run, on a runner that holds them. */
function reportListeners(standIn: () => ListedWindow[] = () => STOOD_WINDOWS): {
  suiteEnd: (suite: Mocha.Suite) => void;
  runEnd: () => void;
} {
  const listeners = new Map<string, (...passed: unknown[]) => void>();
  const runner = {
    stats: {},
    on: (event: string, listener: (...passed: unknown[]) => void) => {
      listeners.set(event, listener);
    },
    once: (event: string, listener: (...passed: unknown[]) => void) => {
      listeners.set(event, listener);
    },
  } as unknown as Mocha.Runner;
  new DisplayReporter(runner, {
    reporterOptions: {listWindows: standIn},
  });
  const suiteEnd = listeners.get(Mocha.Runner.constants.EVENT_SUITE_END);
  const runEnd = listeners.get(Mocha.Runner.constants.EVENT_RUN_END);
  return {
    suiteEnd: (suite: Mocha.Suite) => {
      suiteEnd?.(suite);
    },
    runEnd: () => {
      runEnd?.();
    },
  };
}

/** Runs `body` with the run's suite named in the reporter's variable, and the lines it prints on the output kept. */
function underSuite(
  suite: string | undefined,
  body: (lines: string[]) => void,
): void {
  const lines: string[] = [];
  const previousWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(String(chunk).trimEnd());
    return true;
  };
  const previousSuite = process.env[HARNESS_SUITE_VARIABLE];
  if (suite === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the run's own variable, cleared for the row
    delete process.env[HARNESS_SUITE_VARIABLE];
  } else {
    process.env[HARNESS_SUITE_VARIABLE] = suite;
  }
  try {
    body(lines);
  } finally {
    process.stdout.write = previousWrite;
    if (previousSuite === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the run's own variable, restored for the run
      delete process.env[HARNESS_SUITE_VARIABLE];
    } else {
      process.env[HARNESS_SUITE_VARIABLE] = previousSuite;
    }
  }
}

/** A mocha run of `specs` with the reporter, as a launch's window runs it, and what it printed. */
function reportedRun(
  specs: readonly string[],
  suite: string,
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      path.join(REPOSITORY_ROOT, 'node_modules', 'mocha', 'bin', 'mocha.js'),
      '--no-config',
      '--extension',
      'ts',
      '--reporter',
      path.join(REPOSITORY_ROOT, 'tools', 'acceptance-display-reporter.ts'),
      ...specs.flatMap(spec => ['--spec', spec]),
    ],
    {
      encoding: 'utf8',
      env: {...process.env, [HARNESS_SUITE_VARIABLE]: suite},
    },
  );
}

describe('acceptance-display-reporter (card #3210)', () => {
  it('card #3210: the line names the suite and the file, with the count and each window, its name, its WM_CLASS and whether the manager manages it', () => {
    deepStrictEqual(
      displayLine(
        'ssh-core',
        '/repo/tests/acceptance/dist-re/first.test.cjs',
        STOOD_WINDOWS,
      ),
      STOOD_LINE,
    );
  });

  it('card #3210: a display that holds no window says none', () => {
    deepStrictEqual(
      displayLine(
        'ssh-core',
        '/repo/tests/acceptance/dist-re/settle.test.cjs',
        [],
      ),
      'acceptance: display ssh-core/settle.test: 0 windows: ',
    );
  });

  it('card #3210: a display that gives no answer says its first line in place of its list', () => {
    deepStrictEqual(
      [
        displayNoAnswerLine(
          'ssh-core',
          '/repo/tests/acceptance/dist-re/first.test.cjs',
          new Error('the display is not visible\nand neither is the window'),
        ),
        displayNoAnswerLine(
          'ssh-core',
          '/repo/tests/acceptance/dist-re/first.test.cjs',
          'a string',
        ),
        displayNoAnswerLine(
          'ssh-core',
          '/repo/tests/acceptance/dist-re/first.test.cjs',
          {code: 1},
        ),
      ],
      [
        'acceptance: display ssh-core/first.test: the display gave no answer: the display is not visible',
        'acceptance: display ssh-core/first.test: the display gave no answer: a string',
        'acceptance: display ssh-core/first.test: the display gave no answer: {"code":1}',
      ],
    );
  });

  it("card #3210: the module's value is the reporter, mocha's spec reporter with the display beside it", () => {
    strictEqual(
      DisplayReporter.prototype instanceof Mocha.reporters.Spec,
      true,
    );
  });

  it('card #3210: the reporter takes its read of the display from its option, standing the harness in for it', () => {
    function standIn(): ListedWindow[] {
      return STOOD_WINDOWS;
    }
    deepStrictEqual(
      displayReadoutOf({reporterOptions: {listWindows: standIn}}) === standIn,
      true,
    );
  });

  it("card #3210: the reporter says the display at the end of a run file, under the run's suite", () => {
    underSuite('ssh-core', lines => {
      reportListeners().suiteEnd({
        file: '/repo/tests/acceptance/dist-re/first.test.cjs',
        parent: {root: true} as unknown as Mocha.Suite,
      } as unknown as Mocha.Suite);
      strictEqual(lines[0], STOOD_LINE);
    });
  });

  it("card #3210: a run that names no suite holds the display's readout to itself", () => {
    underSuite(undefined, lines => {
      reportListeners().suiteEnd({
        file: '/repo/tests/acceptance/dist-re/first.test.cjs',
        parent: {root: true} as unknown as Mocha.Suite,
      } as unknown as Mocha.Suite);
      deepStrictEqual(lines, []);
    });
  });

  it('card #3210: a suite the run file does not hold gives no readout', () => {
    underSuite('ssh-core', lines => {
      const listener = reportListeners().suiteEnd;
      listener({
        file: '/repo/tests/acceptance/dist-re/first.test.cjs',
        parent: {root: false} as unknown as Mocha.Suite,
      } as unknown as Mocha.Suite);
      listener({parent: {root: true}} as unknown as Mocha.Suite);
      listener({
        file: '/repo/tests/acceptance/dist-re/first.test.cjs',
      } as unknown as Mocha.Suite);
      deepStrictEqual(lines, []);
    });
  });

  it('card #3210: a display that gives no answer says so in place of its list', () => {
    underSuite('ssh-core', lines => {
      reportListeners(() => {
        throw new Error('the display is not visible');
      }).suiteEnd({
        file: '/repo/tests/acceptance/dist-re/first.test.cjs',
        parent: {root: true} as unknown as Mocha.Suite,
      } as unknown as Mocha.Suite);
      strictEqual(
        lines[0],
        'acceptance: display ssh-core/first.test: the display gave no answer: the display is not visible',
      );
    });
  });

  it("card #3210: the reporter says the display at the end of the run, under the run's suite", () => {
    underSuite('ssh-core', lines => {
      reportListeners().runEnd();
      strictEqual(
        lines[0],
        'acceptance: display ssh-core/run: 2 windows: 514 (VSCodium - Insiders, WM_CLASS "VSCodium", "VSCodium", no WM_STATE), 4194465 (no name, WM_CLASS none, managed)',
      );
    });
  });

  it('card #3210: a mocha run with it says the display after each of its files, beside the spec report', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'display-reporter-'));
    try {
      writeFileSync(
        path.join(folder, 'first.test.ts'),
        "describe('one', () => { it('a', () => {}); });\n",
      );
      writeFileSync(
        path.join(folder, 'second.test.ts'),
        "describe('two', () => { it('b', () => {}); });\n",
      );
      const result = reportedRun(
        [
          path.join(folder, 'first.test.ts'),
          path.join(folder, 'second.test.ts'),
        ],
        'ssh-core',
      );
      const output = typeof result.stdout === 'string' ? result.stdout : '';
      const first = output.indexOf('acceptance: display ssh-core/first.test');
      const second = output.indexOf('acceptance: display ssh-core/second.test');
      const runEnd = output.indexOf('acceptance: display ssh-core/run');
      deepStrictEqual(
        [
          result.status,
          output.includes('2 passing'),
          first >= 0,
          first < second,
          second >= 0,
          runEnd >= 0,
          runEnd > second,
          output.slice(0, first).includes('one'),
          output.slice(first, second).includes('two'),
        ],
        [0, true, true, true, true, true, true, true, true],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
