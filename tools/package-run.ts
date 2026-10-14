/**
 * @fileoverview The `pnpm package` runner: the identifiers, build and package phases in this one process, in
 * order, and their output written as the run goes. On a terminal the run ends as one styled layout; everywhere
 * else each phase's plain lines are written as the phase ends, byte for byte as today.
 */

import {statSync, type Stats} from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import type {Writable} from 'node:stream';
import {buildPackages} from './build.ts';
import {generateTables} from './identifiers.ts';
import {messageOf, isMainModule, REPOSITORY_ROOT} from './repository.ts';
import {packageExtensions} from './package-extensions.ts';
import {chooseMode, parseOutcome, renderPackageRun} from './package-view.ts';

/** The run's phases: the real tools, or a test's fakes. */
export interface PackagePhases {
  identifiers(root: string): Promise<string[]>;
  build(root: string, folders: string[]): Promise<string[]>;
  package(root: string, folders: string[]): string[];
  stat(file: string): Stats;
}

/** The run's output: the stream the run writes to, the terminal flag, the environment and the arguments it reads. */
export interface PackageOut {
  stream: Writable;
  isTerminal: boolean;
  environment: Readonly<Record<string, string | undefined>>;
  argv: readonly string[];
}

/** The phase names, in run order; the plain lines' and the error lines' prefixes. */
type PhaseName = 'identifiers' | 'build' | 'package';

/** The arguments after the script name that don't start with `--`, the package phase's folders. */
function packageFoldersOf(argv: readonly string[]): string[] {
  return argv.slice(2).filter(argument => !argument.startsWith('--'));
}

/**
 * Runs the three phases in order, timing each, and writes the run: the plain lines as each phase ends, or the
 * styled layout once, when the mode is not `plain`. On a phase's error it writes what it can and sets the exit
 * code, running no later phase.
 */
export async function runPackage(
  root: string,
  phases: PackagePhases,
  output: PackageOut,
): Promise<void> {
  const mode = chooseMode(output.isTerminal, output.environment, output.argv);
  const folders = packageFoldersOf(output.argv);
  const milliseconds = {identifiers: 0, build: 0, package: 0};
  const results: Record<'identifiers' | 'build' | 'package', string[]> = {
    identifiers: [],
    build: [],
    package: [],
  };

  function emit(phase: PhaseName): void {
    if (mode !== 'plain') {
      return;
    }
    for (const outcome of results[phase]) {
      output.stream.write(`${phase}: ${outcome}\n`);
    }
  }

  function finish(phase: PhaseName, caught: unknown): void {
    if (mode === 'plain') {
      process.stderr.write(`${phase}: ${messageOf(caught)}\n`);
    } else {
      const line = `  \u2716 ${phase}: ${messageOf(caught)}`;
      output.stream.write(
        renderPackageRun(
          {
            identifiers: results.identifiers,
            build: results.build,
            packages: [],
            milliseconds,
          },
          mode,
        ),
      );
      output.stream.write(
        `${mode === 'styled' ? `\x1b[31m${line}\x1b[0m` : line}\n`,
      );
    }
    process.exitCode = 1;
  }

  let started = performance.now();
  try {
    results.identifiers = await phases.identifiers(root);
  } catch (caught) {
    finish('identifiers', caught);
    return;
  }
  milliseconds.identifiers = performance.now() - started;
  emit('identifiers');

  started = performance.now();
  try {
    results.build = await phases.build(root, []);
  } catch (caught) {
    finish('build', caught);
    return;
  }
  milliseconds.build = performance.now() - started;
  emit('build');

  started = performance.now();
  try {
    results.package = phases.package(root, folders);
  } catch (caught) {
    finish('package', caught);
    return;
  }
  milliseconds.package = performance.now() - started;
  emit('package');

  if (mode !== 'plain') {
    const packages = results.package.map(line => {
      const file = path.join(root, parseOutcome(line).rest);
      return {line, bytes: phases.stat(file).size};
    });
    output.stream.write(
      renderPackageRun(
        {
          identifiers: results.identifiers,
          build: results.build,
          packages,
          milliseconds,
        },
        mode,
      ),
    );
  }
}

if (isMainModule(import.meta.url)) {
  await runPackage(
    REPOSITORY_ROOT,
    {
      identifiers: generateTables,
      build: buildPackages,
      package: packageExtensions,
      stat: statSync,
    },
    {
      stream: process.stdout,
      isTerminal: process.stdout.isTTY,
      environment: process.env,
      argv: process.argv,
    },
  );
}
