import {deepStrictEqual, strictEqual} from 'node:assert';
import type {Stats} from 'node:fs';
import {Writable} from 'node:stream';
import {FIXTURE} from './package-view.fixture.ts';
import {
  runPackage,
  tablesPhase,
  type PackageOut,
  type PackagePhases,
} from './package-run.ts';
import {renderPackageRun} from './package-view.ts';

/** A Stats the fakes report: the rows read the size and nothing else. */
function statsOf(size: number): Stats {
  return {size} as unknown as Stats;
}

/** An output that records its writes, with the run's terminal flag, environment and arguments. */
function outOf(
  options: {
    isTerminal?: boolean;
    environment?: Record<string, string | undefined>;
    argv?: readonly string[];
  } = {},
): {output: PackageOut; writes: string[]} {
  const writes: string[] = [];
  const stream = new Writable({
    write(
      chunk: unknown,
      encoding: BufferEncoding,
      callback: () => void,
    ): void {
      writes.push(String(chunk));
      callback();
    },
  });
  const output: PackageOut = {
    stream,
    isTerminal: options.isTerminal ?? false,
    environment: options.environment ?? {},
    argv: options.argv ?? ['node', 'package-run.ts'],
  };
  return {output, writes};
}

/** The fake phases of the rows: the fixture's outcomes, their order, and the folders the package phase got. */
function fakePhases(
  options: {fail?: 'identifiers' | 'build' | 'package'; size?: number} = {},
): {
  phases: PackagePhases;
  order: string[];
  folders: string[][];
} {
  const order: string[] = [];
  const folders: string[][] = [];
  const size = options.size ?? 1024;
  const phases: PackagePhases = {
    identifiers: () => {
      order.push('identifiers');
      if (options.fail === 'identifiers') {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve([...FIXTURE.identifiers]);
    },
    build: () => {
      order.push('build');
      if (options.fail === 'build') {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve([...FIXTURE.build]);
    },
    package: (directory, argument) => {
      order.push('package');
      folders.push([...argument]);
      if (options.fail === 'package') {
        throw new Error('boom');
      }
      return FIXTURE.packages.map(item => item.line);
    },
    stat: () => statsOf(size),
  };
  return {phases, order, folders};
}

/** The summary lines of a render with their measured timings removed. */
function withoutTiming(text: string): string {
  return text
    .split('\n')
    .map(line => {
      if (line.includes('minted') || line.includes('forged')) {
        return line.replace(/\s+\S+$/, '');
      }
      if (line.includes('ready for liftoff')) {
        return line.replace(/ \u00B7 {2}\S+ total/, ' \u00B7  total');
      }
      return line;
    })
    .join('\n');
}

/** The run the fake phases of a size produce: the fixture's outcomes, the size on every package. */
function runOf(size: number) {
  return {
    identifiers: [...FIXTURE.identifiers],
    build: [...FIXTURE.build],
    packages: FIXTURE.packages.map(item => ({
      line: item.line,
      bytes: size,
    })),
    milliseconds: {identifiers: 1, build: 1, package: 1},
  };
}

/** The stderr a run writes and its exit code, the real ones restored when it ends. */
async function capture(
  work: () => Promise<void>,
): Promise<{errors: string[]; exitCode: string | number | null | undefined}> {
  const previous = process.stderr.write.bind(process.stderr);
  const savedExit = process.exitCode;
  const errors: string[] = [];
  process.stderr.write = (chunk: unknown) => {
    errors.push(String(chunk));
    return true;
  };
  try {
    await work();
  } finally {
    process.stderr.write = previous;
  }
  const exitCode = process.exitCode;
  process.exitCode = savedExit;
  return {errors, exitCode};
}

describe('the phases of a run (tooling-46 §3)', () => {
  it('tooling-46 §3: they run in order, identifiers then build then package, and the package phase gets no folders', async () => {
    const {phases, order, folders} = fakePhases();
    const {output} = outOf();
    await runPackage('/root', phases, output);
    deepStrictEqual(
      {order, folders: folders.flat()},
      {
        order: ['identifiers', 'build', 'package'],
        folders: [],
      },
    );
  });

  it('tooling-46 §3: the arguments after the script name, without the flags, are the package folders', async () => {
    const {phases, folders} = fakePhases();
    const {output} = outOf({
      isTerminal: true,
      argv: [
        'node',
        'package-run.ts',
        'remote-explorer',
        '--plain',
        'remote-ssh',
      ],
    });
    await runPackage('/root', phases, output);
    deepStrictEqual(folders, [['remote-explorer', 'remote-ssh']]);
  });
});

describe('the plain lines of a run (tooling-46 §1)', () => {
  it('tooling-46 §1: every line is the phase name and the outcome, in order, and nothing else', async () => {
    const {phases} = fakePhases();
    const {output, writes} = outOf();
    await runPackage('/root', phases, output);
    strictEqual(
      writes.join(''),
      [
        ...FIXTURE.identifiers.map(line => `identifiers: ${line}\n`),
        ...FIXTURE.build.map(line => `build: ${line}\n`),
        ...FIXTURE.packages.map(item => `package: ${item.line}\n`),
      ].join(''),
    );
  });

  it('tooling-46 §3: --plain keeps them on a terminal', async () => {
    const {phases} = fakePhases();
    const {output, writes} = outOf({
      isTerminal: true,
      argv: ['node', 'package-run.ts', '--plain'],
    });
    await runPackage('/root', phases, output);
    deepStrictEqual(
      [writes[0], writes.at(-1)],
      [
        'identifiers: remote-containers: src/identifiers.generated.ts\n',
        'package: remote-ssh-edit: dist/remote-ssh-edit-0.1.0.vsix\n',
      ],
    );
  });
});

describe('the styled modes of a run (tooling-46 §3)', () => {
  it('tooling-46 §3: styled-mono writes once, the render of the run with the fake sizes and non-negative timings', async () => {
    const {phases} = fakePhases({size: 4096});
    const {output, writes} = outOf({
      isTerminal: true,
      environment: {NO_COLOR: '1'},
    });
    await runPackage('/root', phases, output);
    const written = writes[0] ?? '';
    const expected = renderPackageRun(runOf(4096), 'styled-mono');
    const timed = written
      .split('\n')
      .filter(line => line.includes('minted') || line.includes('forged'))
      .map(line => /(\d+(?:\.\d+)?)(ms|s)$/.exec(line)?.[1]);
    deepStrictEqual(
      [
        writes.length,
        withoutTiming(written),
        timed.every(part => part !== undefined && Number(part) >= 0),
        written.includes('4 KB'),
      ],
      [1, withoutTiming(expected), true, true],
    );
  });

  it('the styled mode is the same layout with its codes', async () => {
    const {phases} = fakePhases({size: 4096});
    const {output, writes} = outOf({isTerminal: true});
    await runPackage('/root', phases, output);
    const written = writes[0] ?? '';
    // eslint-disable-next-line no-control-regex -- the escape is U+001B, the SGR introducer
    const stripped = written.replace(/\x1b\[[0-9;]*m/g, '');
    const expected = renderPackageRun(runOf(4096), 'styled-mono');
    deepStrictEqual(
      [
        writes.length,
        withoutTiming(stripped),
        written.includes('\x1b[1;35m'),
        written.includes('\x1b[32m'),
        written.includes('\x1b[31m'),
      ],
      [1, withoutTiming(expected), true, true, false],
    );
  });
});

describe('an error in a phase (tooling-46 §3)', () => {
  it('tooling-46 §3: a failing build in plain shows the finished lines, stderr the error, no package phase, exit code 1', async () => {
    const {phases, order} = fakePhases({fail: 'build'});
    const {output, writes} = outOf();
    const {errors, exitCode} = await capture(async () => {
      await runPackage('/root', phases, output);
    });
    deepStrictEqual(
      {
        lines: writes.join(''),
        errors,
        order,
        exitCode,
      },
      {
        lines: FIXTURE.identifiers
          .map(line => `identifiers: ${line}\n`)
          .join(''),
        errors: ['build: boom\n'],
        order: ['identifiers', 'build'],
        exitCode: 1,
      },
    );
  });

  it('a failing identifiers phase in plain names the phase and runs no later phase', async () => {
    const {phases, order} = fakePhases({fail: 'identifiers'});
    const {output, writes} = outOf();
    const {errors, exitCode} = await capture(async () => {
      await runPackage('/root', phases, output);
    });
    deepStrictEqual(
      {writes, errors, order, exitCode},
      {
        writes: [],
        errors: ['identifiers: boom\n'],
        order: ['identifiers'],
        exitCode: 1,
      },
    );
  });

  it('a failing package phase in plain names the phase, and ran all three', async () => {
    const {phases, order} = fakePhases({fail: 'package'});
    const {output, writes} = outOf();
    const {errors, exitCode} = await capture(async () => {
      await runPackage('/root', phases, output);
    });
    deepStrictEqual(
      {writes: writes.join(''), errors, order, exitCode},
      {
        writes: [
          ...FIXTURE.identifiers.map(line => `identifiers: ${line}\n`),
          ...FIXTURE.build.map(line => `build: ${line}\n`),
        ].join(''),
        errors: ['package: boom\n'],
        order: ['identifiers', 'build', 'package'],
        exitCode: 1,
      },
    );
  });

  it('tooling-46 §3: a failing build in styled-mono shows the finished phases, then the error line', async () => {
    const {phases} = fakePhases({fail: 'build'});
    const {output, writes} = outOf({
      isTerminal: true,
      environment: {NO_COLOR: '1'},
    });
    const {exitCode} = await capture(async () => {
      await runPackage('/root', phases, output);
    });
    const mono = writes[0] ?? '';
    deepStrictEqual(
      {
        writes: writes.length,
        names: ['remote-containers', 'remote-explorer', 'remote-ssh-edit'].map(
          name => mono.includes(name),
        ),
        buildHeader: mono.includes('BUILD'),
        error: writes[1] ?? '',
        exitCode,
      },
      {
        writes: 2,
        names: [true, true, true],
        buildHeader: false,
        error: '  \u2716 build: boom\n',
        exitCode: 1,
      },
    );
  });

  it('a failing build in styled shows the error line in red', async () => {
    const {phases} = fakePhases({fail: 'build'});
    const {output, writes} = outOf({isTerminal: true});
    const {exitCode} = await capture(async () => {
      await runPackage('/root', phases, output);
    });
    deepStrictEqual(
      {writes: writes.length, error: writes[1] ?? '', exitCode},
      {
        writes: 2,
        error: '\x1b[31m  \u2716 build: boom\x1b[0m\n',
        exitCode: 1,
      },
    );
  });
});

describe('the identifiers phase (tooling-41)', () => {
  it('tooling-41: it writes the identifier tables, then the locale tables, and gives the identifier outcomes', async () => {
    const calls: string[] = [];
    const outcomes = await tablesPhase(
      root => {
        calls.push(`identifiers ${root}`);
        return Promise.resolve(['remote-ssh: table']);
      },
      root => {
        calls.push(`locales ${root}`);
      },
    )('/repo');
    deepStrictEqual(
      {calls, outcomes},
      {
        calls: ['identifiers /repo', 'locales /repo'],
        outcomes: ['remote-ssh: table'],
      },
    );
  });
});
