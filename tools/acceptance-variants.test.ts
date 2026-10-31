import {deepStrictEqual} from 'node:assert';
import {
  mochaArguments,
  runVariants,
  type VariantRun,
  variantRuns,
} from './acceptance-variants.ts';

const VARIANTS: VariantRun[] = [
  {label: 'one', testFiles: ['a.test.ts'], environment: {}},
  {label: 'two', testFiles: ['b.test.ts', 'c.test.ts'], environment: {}},
  {label: 'three', testFiles: ['c.test.ts'], environment: {}},
];

const THE_SECOND: VariantRun = {
  label: 'two',
  testFiles: ['b.test.ts', 'c.test.ts'],
  environment: {},
};

describe('acceptance-variants (card tooling-14)', () => {
  it('runs the download rows once per download tool, in order', () => {
    deepStrictEqual(
      variantRuns().flatMap(variant =>
        variant.environment.HARNESS_HOST_FETCH === undefined
          ? []
          : [variant.environment.HARNESS_HOST_FETCH],
      ),
      ['busybox-wget', 'gnu-wget', 'curl', 'none'],
    );
  });

  it('runs the shell rows once per login shell, in order', () => {
    deepStrictEqual(
      variantRuns().flatMap(variant =>
        variant.environment.HARNESS_HOST_SHELL === undefined
          ? []
          : [variant.environment.HARNESS_HOST_SHELL],
      ),
      [
        '/bin/sh',
        '/bin/bash',
        '/bin/zsh',
        '/usr/bin/dash',
        '/usr/bin/fish',
        '/bin/tcsh',
        '/bin/csh',
        '/bin/mksh',
      ],
    );
  });

  it('runs the shell runs, then the download runs, then the host-base run', () => {
    deepStrictEqual(
      variantRuns().map(variant => variant.label.split(' ')[0]),
      [
        ...Array<string>(8).fill('login'),
        ...Array<string>(4).fill('download'),
        'host',
      ],
    );
  });

  it('tooling-70: runs the shell-sensitive, install and probe rows once on the Ubuntu 26.04 host', () => {
    deepStrictEqual(
      variantRuns().filter(variant => variant.label.startsWith('host')),
      [
        {
          label: 'host base ubuntu-26.04',
          testFiles: [
            'tests/acceptance/server/login-shell-variant.test.ts',
            'tests/acceptance/server/login-shells.test.ts',
            'tests/acceptance/server/start.test.ts',
            'tests/acceptance/server/shared-session.test.ts',
            'tests/acceptance/server/install.test.ts',
            'tests/acceptance/server/probe.test.ts',
          ],
          environment: {HARNESS_HOST_BASE: 'ubuntu-26.04'},
        },
      ],
    );
  });

  it('runs the download rows from fetch-tools.test.ts', () => {
    deepStrictEqual(
      new Set(
        variantRuns()
          .filter(variant => variant.label.startsWith('download'))
          .flatMap(variant => variant.testFiles),
      ),
      new Set(['tests/acceptance/server/fetch-tools.test.ts']),
    );
  });

  it('runs the shell-sensitive rows on every login shell', () => {
    deepStrictEqual(
      variantRuns().find(variant => variant.label.startsWith('login'))
        ?.testFiles,
      [
        'tests/acceptance/server/login-shell-variant.test.ts',
        'tests/acceptance/server/login-shells.test.ts',
        'tests/acceptance/server/start.test.ts',
        'tests/acceptance/server/shared-session.test.ts',
      ],
    );
  });

  it('gives mocha the test files of the variant last', () => {
    deepStrictEqual(mochaArguments(THE_SECOND).slice(1), [
      '--no-config',
      '--extension=ts',
      'b.test.ts',
      'c.test.ts',
    ]);
  });

  it('runs the variants one after the other', async () => {
    const order: string[] = [];
    await runVariants(VARIANTS, variant => {
      order.push(`start ${variant.label}`);
      return new Promise(resolve => {
        setImmediate(() => {
          order.push(`end ${variant.label}`);
          resolve(0);
        });
      });
    });
    deepStrictEqual(order, [
      'start one',
      'end one',
      'start two',
      'end two',
      'start three',
      'end three',
    ]);
  });

  it('gives 0 when every variant passes', async () => {
    deepStrictEqual(await runVariants(VARIANTS, () => Promise.resolve(0)), 0);
  });

  it('gives the first failing exit code and still runs the rest', async () => {
    const started: string[] = [];
    const code = await runVariants(VARIANTS, variant => {
      started.push(variant.label);
      return Promise.resolve(
        variant.label === 'two' ? 3 : variant.label === 'three' ? 4 : 0,
      );
    });
    deepStrictEqual([code, started], [3, ['one', 'two', 'three']]);
  });
});
