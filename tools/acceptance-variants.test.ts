import {deepStrictEqual} from 'node:assert';
import {
  mochaArguments,
  runVariants,
  type VariantRun,
  variantRuns,
} from './acceptance-variants.ts';

const VARIANTS: VariantRun[] = [
  {label: 'one', testFile: 'a.test.ts', environment: {}},
  {label: 'two', testFile: 'b.test.ts', environment: {}},
  {label: 'three', testFile: 'c.test.ts', environment: {}},
];

const THE_SECOND: VariantRun = {
  label: 'two',
  testFile: 'b.test.ts',
  environment: {},
};

describe('acceptance-variants (card tooling-14)', () => {
  it('runs the download rows once per download tool, in order', () => {
    deepStrictEqual(
      variantRuns().map(variant => variant.environment.HARNESS_HOST_FETCH),
      ['busybox-wget', 'gnu-wget', 'curl', 'none'],
    );
  });

  it('runs the download rows from fetch-tools.test.ts', () => {
    deepStrictEqual(
      new Set(variantRuns().map(variant => variant.testFile)),
      new Set(['tests/acceptance/server/fetch-tools.test.ts']),
    );
  });

  it("gives mocha the run's spec file last", () => {
    deepStrictEqual(mochaArguments(THE_SECOND).slice(1), [
      '--no-config',
      '--extension=ts',
      'b.test.ts',
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
