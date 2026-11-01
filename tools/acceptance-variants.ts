/**
 * @fileoverview acceptance-variants: runs the host-variant rows of the server acceptance tests, one host variant
 * after the other.
 *
 *     node tools/acceptance-variants.ts
 *
 * Each login shell of tools/host-variants.ts gets its own mocha run of the shell-sensitive rows, on a host started
 * with that shell (`HARNESS_HOST_SHELL`), and each download tool one of the download rows (`HARNESS_HOST_FETCH`). The
 * Ubuntu 26.04 host (`HARNESS_HOST_BASE`) gets one run of the shell-sensitive rows and the install and probe rows. A run
 * that fails does not stop the others; the exit status is the first failure's. The rest of the server rows run once,
 * on the default host, in `pnpm test:acceptance:server`.
 */

import {spawn} from 'node:child_process';
import {
  FETCH_VARIANTS,
  VARIANT_HOST_BASES,
  SHELL_VARIANTS,
} from './host-variants.ts';
import {isMainModule, REPOSITORY_ROOT, resolveBinary} from './repository.ts';

/** One mocha run of the variant rows: its label, the test files, and the variables that choose the host. */
export interface VariantRun {
  label: string;
  testFiles: readonly string[];
  environment: Readonly<Record<string, string>>;
}

/** The rows that depend on the login shell, which every shell goes through. */
const SHELL_ROWS: readonly string[] = [
  'tests/acceptance/server/login-shell-variant.test.ts',
  'tests/acceptance/server/login-shells.test.ts',
  'tests/acceptance/server/start.test.ts',
  'tests/acceptance/server/shared-session.test.ts',
];

/** The rows a host base other than Alpine's goes through: the shell-sensitive ones, the install and the probe. */
const HOST_BASE_ROWS: readonly string[] = [
  ...SHELL_ROWS,
  'tests/acceptance/server/install.test.ts',
  'tests/acceptance/server/probe.test.ts',
];

/**
 * The runs of the login-shell rows, one per shell, then the download rows, one per download tool, then the host-base
 * rows, one per base other than Alpine's (the default host of every other run).
 */
export function variantRuns(): VariantRun[] {
  return [
    ...SHELL_VARIANTS.map(shell => ({
      label: `login shell ${shell}`,
      testFiles: SHELL_ROWS,
      environment: {HARNESS_HOST_SHELL: shell},
    })),
    ...FETCH_VARIANTS.map(variant => ({
      label: `download tool ${variant}`,
      testFiles: ['tests/acceptance/server/fetch-tools.test.ts'],
      environment: {HARNESS_HOST_FETCH: variant},
    })),
    ...VARIANT_HOST_BASES.map(base => ({
      label: `host base ${base}`,
      testFiles: HOST_BASE_ROWS,
      environment: {HARNESS_HOST_BASE: base},
    })),
  ];
}

/** The command line of one run's mocha. */
export function mochaArguments(variant: VariantRun): string[] {
  return [
    resolveBinary('mocha/bin/mocha.js'),
    '--no-config',
    '--extension=ts',
    ...variant.testFiles,
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
