/**
 * @fileoverview Extension-host tests with `@vscode/test-cli` (ADR-0002, decision 7, second level): one test-cli
 * configuration per package that has test/integration, and the runner behind `pnpm test:integration`.
 *
 * Tests run from the bundle the build writes, because the extension host loads JavaScript; how test files are
 * bundled is set when the first package needs them. `vscode-test` downloads an editor build, so it starts only when
 * some package has integration tests.
 */

import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {
  isMainModule,
  packageFolders,
  REPOSITORY_ROOT,
  resolveBinary,
} from './repository.ts';

/** One `@vscode/test-cli` configuration: the package under test and its compiled test files. */
export interface IntegrationConfiguration {
  label: string;
  extensionDevelopmentPath: string;
  files: string;
}

/** Starts `vscode-test` with the given arguments and returns its exit code. */
export type TestCliRunner = (cliArguments: string[]) => number;

/** The test-cli configurations of the packages under `<root>/packages` that have a test/integration folder. */
export function integrationConfigurations(
  root: string,
): IntegrationConfiguration[] {
  return packageFolders(root)
    .filter(folder =>
      existsSync(path.join(root, 'packages', folder, 'test', 'integration')),
    )
    .map(folder => {
      const directory = path.join(root, 'packages', folder);
      return {
        label: folder,
        extensionDevelopmentPath: directory,
        files: path.join(
          directory,
          'dist',
          'test',
          'integration',
          '**',
          '*.test.js',
        ),
      };
    });
}

/**
 * The file of the `vscode-test` binary. `@vscode/test-cli` exports no path to it; bin.mjs sits next to the module
 * its main entry resolves to.
 */
export function testCliBinary(): string {
  return path.join(path.dirname(resolveBinary('@vscode/test-cli')), 'bin.mjs');
}

function runTestCli(cliArguments: string[]): number {
  const result = spawnSync(
    process.execPath,
    [testCliBinary(), ...cliArguments],
    {cwd: REPOSITORY_ROOT, stdio: 'inherit'},
  );
  return result.status ?? 1;
}

/**
 * Runs the integration tests of the packages under `root` with `runner`, or reports that there are none, and
 * returns the exit code for the process.
 */
export function runIntegrationTests(
  root: string,
  cliArguments: string[],
  runner: TestCliRunner = runTestCli,
): number {
  if (integrationConfigurations(root).length === 0) {
    console.log(
      'test-integration: no package has test/integration, nothing to run',
    );
    return 0;
  }
  return runner(cliArguments);
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runIntegrationTests(
    REPOSITORY_ROOT,
    process.argv.slice(2),
  );
}
