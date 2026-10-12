/**
 * @fileoverview acceptance-variants: runs the host-variant rows of the server acceptance tests, one host variant
 * after the other.
 *
 *     node tools/acceptance-variants.ts
 *
 * Each download tool of tools/host-variants.ts gets its own mocha run of the download rows, on a host
 * started with that tool (`HARNESS_HOST_FETCH`). A run that fails does not stop the others; the exit status is the
 * first failure's. The rest of the server rows run once, on the default host, in `pnpm test:acceptance:server`.
 */

import {spawn} from 'node:child_process';
import {FETCH_VARIANTS} from './host-variants.ts';
import {isMainModule, REPOSITORY_ROOT, resolveBinary} from './repository.ts';

/** One mocha run of the variant rows: its label, the test file, and the variables that choose the host. */
export interface VariantRun {
  label: string;
  testFile: string;
  environment: Readonly<Record<string, string>>;
}

/** The runs of the download rows, one per download tool. */
export function variantRuns(): VariantRun[] {
  return FETCH_VARIANTS.map(variant => ({
    label: `download tool ${variant}`,
    testFile: 'tests/acceptance/server/fetch-tools.test.ts',
    environment: {HARNESS_HOST_FETCH: variant},
  }));
}

/** The command line of one run's mocha. */
export function mochaArguments(variant: VariantRun): string[] {
  return [
    resolveBinary('mocha/bin/mocha.js'),
    '--no-config',
    '--extension=ts',
    variant.testFile,
  ];
}

/** Runs one variant and gives its exit code. */
function runVariant(variant: VariantRun): Promise<number> {
  return new Promise(resolve => {
    console.log(`acceptance-variants: ${variant.label}`);
    const child = spawn(process.execPath, mochaArguments(variant), {
      cwd: REPOSITORY_ROOT,
      env: {...process.env, ...variant.environment},
      stdio: 'inherit',
    });
    child.on('close', code => {
      resolve(code ?? 1);
    });
    child.on('error', () => {
      resolve(1);
    });
  });
}

/** Runs every variant, one after the other, and gives the first failing exit code, or 0. */
export async function runVariants(
  variants: readonly VariantRun[],
  runOne: (variant: VariantRun) => Promise<number>,
): Promise<number> {
  const codes: number[] = [];
  for (const variant of variants) {
    codes.push(await runOne(variant));
  }
  return codes.find(code => code !== 0) ?? 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await runVariants(variantRuns(), runVariant);
}
