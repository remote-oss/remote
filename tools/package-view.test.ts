import {deepStrictEqual, ok, strictEqual, throws} from 'node:assert';
import {readFileSync} from 'node:fs';
import {FIXTURE} from './package-view.fixture.ts';
import {
  chooseMode,
  displayWidth,
  formatTiming,
  parseOutcome,
  renderPackageRun,
  sizeBar,
  type PackageRun,
} from './package-view.ts';

/** The golden of the fixture run in `styled-mono`, written from the card's rules and reviewed against the mock-up. */
const GOLDEN = readFileSync(
  new URL('./fixtures/package-view.golden.txt', import.meta.url),
  'utf8',
);

/**
 * The SGR codes a `styled` render paints: an escape, a bracket, the codes and a letter, a `m`.
 */
// eslint-disable-next-line no-control-regex -- the escape is U+001B, the SGR introducer
const SGR_CODES = /\x1b\[[0-9;]*m/g;

/** The text with every SGR sequence removed. */
function withoutCodes(text: string): string {
  return text.replace(SGR_CODES, '');
}

/** The lines the box borders make, the title box and the closing box, with their codes removed. */
function boxLinesOf(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.replace(SGR_CODES, ''))
    .filter(
      line =>
        line.includes('\u2502') ||
        line.startsWith('  \u256d') ||
        line.startsWith('  \u2570'),
    );
}

describe('the mode of a run (tooling-46 §4.1)', () => {
  it('tooling-46 §4.1: not a terminal, a CI, a dumb terminal, --plain, NO_COLOR, and nothing', () => {
    const ciEnvironment: Record<string, string | undefined> = {};
    ciEnvironment.CI = '1';
    deepStrictEqual(
      [
        chooseMode(false, {}, []),
        chooseMode(true, ciEnvironment, []),
        chooseMode(true, {TERM: 'dumb'}, []),
        chooseMode(true, {}, ['node', 'package-run.ts', '--plain']),
        chooseMode(true, {NO_COLOR: '1'}, []),
        chooseMode(true, {}, []),
      ],
      ['plain', 'plain', 'plain', 'plain', 'styled-mono', 'styled'],
    );
  });
});

describe('the width of a line (tooling-46 §4.2)', () => {
  it('tooling-46 §4.2: a symbol is two columns, an SGR sequence none, a narrow mark one', () => {
    deepStrictEqual(
      [
        displayWidth('\u{1F4E6} a'),
        displayWidth('\x1b[36mab\x1b[0m'),
        displayWidth('\u2460'),
      ],
      [4, 2, 1],
    );
  });
});

describe('the split of an outcome (tooling-46 §4.4)', () => {
  it('splits at the first ": ", keeping the rest', () => {
    deepStrictEqual(
      parseOutcome('remote-ssh: dist/askpass.js, dist/connection-helper.js'),
      {
        name: 'remote-ssh',
        rest: 'dist/askpass.js, dist/connection-helper.js',
      },
    );
  });

  it('names the line when it has no ": "', () => {
    throws(
      () => parseOutcome('a line without a separator'),
      /an outcome without a ": ": a line without a separator/,
    );
  });
});

describe('the timing of a run (tooling-46 §4.4)', () => {
  it('tooling-46 §4.4: rounded ms under a second, two decimals for a phase, one for the total', () => {
    deepStrictEqual(
      [
        formatTiming(42),
        formatTiming(1310),
        formatTiming(42 + 1310 + 1548, 'total'),
        formatTiming(999),
        formatTiming(1000),
        formatTiming(1000, 'total'),
      ],
      ['42ms', '1.31s', '2.9s', '999ms', '1.00s', '1.0s'],
    );
  });
});

const FILLED = '\u2588';
const HOLLOW = '\u2591';

describe('the bar of a package (tooling-46 §4.4)', () => {
  it('tooling-46 §4.4: the share of the largest, at least one filled cell, twelve total', () => {
    deepStrictEqual(
      [sizeBar(503, 503), sizeBar(71, 503), sizeBar(1, 503), sizeBar(0, 503)],
      [
        FILLED.repeat(12),
        FILLED.repeat(2).concat(HOLLOW.repeat(10)),
        FILLED.concat(HOLLOW.repeat(11)),
        HOLLOW.repeat(12),
      ],
    );
  });

  it('a largest of zero keeps every cell hollow', () => {
    strictEqual(sizeBar(5, 0), '\u2591'.repeat(12));
  });
});

describe('the fixture run in styled-mono (tooling-46 §4.4)', () => {
  it('tooling-46 §4.4: it is the golden text', () => {
    strictEqual(renderPackageRun(FIXTURE, 'styled-mono'), GOLDEN);
  });
});

describe('the fixture run in styled (tooling-46 §4.2, §4.3)', () => {
  const styled = renderPackageRun(FIXTURE, 'styled');
  const mono = renderPackageRun(FIXTURE, 'styled-mono');

  it('tooling-46 §4.2: it carries no U+FE0F', () => {
    ok(!styled.includes('\uFE0F'));
  });

  it('tooling-46 §4.2: every box line is the same width, the inner width plus the borders and the indent', () => {
    deepStrictEqual(
      boxLinesOf(styled).map(line => displayWidth(line)),
      Array(10).fill(60),
    );
  });

  it('tooling-46 §4.3: its codes are the mono text', () => {
    strictEqual(withoutCodes(styled), mono);
  });

  it('tooling-46 §4.3: the napping block is gray', () => {
    deepStrictEqual(
      mono
        .split('\n')
        .filter(
          line =>
            line.startsWith('  \u{1F4A4}') ||
            (line.startsWith('      ') && line.charAt(6) !== ' '),
        )
        .map(line => {
          const other = styled
            .split('\n')
            .find(candidate => withoutCodes(candidate) === line);
          return other?.startsWith('\x1b[90m') ?? false;
        }),
      Array(5).fill(true),
    );
  });

  it('tooling-46 §4.3: the closing box is green', () => {
    const heading = mono
      .split('\n')
      .findIndex(line => line.includes('ready for liftoff'));
    const lines = styled.split('\n');
    deepStrictEqual(
      [-1, 0, 1, 2].map(offset => {
        const line = lines[heading + offset];
        return line?.startsWith('  \x1b[32m') ?? false;
      }),
      [true, true, true, true],
    );
  });
});

describe('the shapes of a run (tooling-46 §4.4)', () => {
  const singular: PackageRun = {
    identifiers: ['remote-ssh: src/identifiers.generated.ts'],
    build: [
      'remote-ssh: dist/extension.js',
      'lib-wsl: no src/extension.ts, skipped',
    ],
    packages: [{line: 'remote-ssh: dist/remote-ssh-0.1.0.vsix', bytes: 1024}],
    milliseconds: {identifiers: 1, build: 1, package: 1},
  };

  it('tooling-46 §4.4: one of each renders the singular forms', () => {
    const text = renderPackageRun(singular, 'styled-mono');
    deepStrictEqual(
      [
        '1 identifier file minted',
        '1 bundle forged',
        '1 package napping (no src/extension.ts)',
        '1 extension ready for liftoff',
      ].map(phrase => text.includes(phrase)),
      [true, true, true, true],
    );
  });

  it('tooling-46 §4.4: a build without a skipped package shows no napping block', () => {
    const text = renderPackageRun(
      {
        identifiers: [],
        build: [
          'remote-ssh: dist/extension.js',
          'remote-ssh-edit: dist/extension.js',
        ],
        packages: [],
        milliseconds: {identifiers: 0, build: 1, package: 0},
      },
      'styled-mono',
    );
    deepStrictEqual(
      [text.includes('\u{1F4A4}'), text.includes('napping')],
      [false, false],
    );
  });

  it('a package under a kilobyte shows its bytes, and an empty phase renders nothing', () => {
    const text = renderPackageRun(
      {
        identifiers: [],
        build: [],
        packages: [
          {line: 'remote-ssh: dist/remote-ssh-0.1.0.vsix', bytes: 512},
        ],
        milliseconds: {identifiers: 0, build: 0, package: 1},
      },
      'styled-mono',
    );
    deepStrictEqual(
      [
        text.includes('512 B'),
        text.includes('\u2460'),
        text.includes('\u2461'),
        text.includes('\u2462'),
      ],
      [true, false, false, true],
    );
  });
});
