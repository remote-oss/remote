/**
 * @fileoverview acceptance-plain: the launches that start the editor plainly, as a user does, with no test run in it.
 * One editor process, one user-data folder and the run's extensions folder, which holds our VSIX files and the window
 * agent's. The agent opens, reloads and closes the windows; a Node mocha run makes the assertions, from the record, the
 * agent's events and the host's state.
 */

import {spawn, spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {type Launch} from './acceptance-launches.ts';
import {resolveBinary} from './repository.ts';

/** The extensions under test that use proposed API, enabled for them on the command line. */
const PROPOSED_API_EXTENSIONS: readonly string[] = ['remote-oss.remote-ssh'];

/** What every run's editor is started with: the run's own folders, the proposed API of the extensions, no trust prompt. */
export function editorArguments(runFolder: string): string[] {
  return [
    `--user-data-dir=${path.join(runFolder, 'user-data')}`,
    `--extensions-dir=${path.join(runFolder, 'extensions')}`,
    ...PROPOSED_API_EXTENSIONS.map(
      extensionId => `--enable-proposed-api=${extensionId}`,
    ),
    '--disable-workspace-trust',
  ];
}

/** The script, record and log files of a launch: the run's own, or a failing connect's. */
export function launchFiles(
  runFolder: string,
  label: string,
): {script: string; record: string; logFile: string} {
  return {
    script: path.join(runFolder, `${label}-script.json`),
    record: path.join(runFolder, `${label}-record.jsonl`),
    logFile: path.join(runFolder, `${label}-log.txt`),
  };
}

/**
 * Packages the window agent into a VSIX in the run's folder: its bundle and its manifest, with the repository and
 * licence fields `vsce` asks for. Returns the VSIX file.
 */
export async function packageWindowAgent(
  root: string,
  runFolder: string,
): Promise<string> {
  const source = path.join(root, 'tests', 'acceptance', 'window-agent');
  const folder = path.join(runFolder, 'window-agent');
  mkdirSync(folder, {recursive: true});
  await build({
    entryPoints: [path.join(source, 'src', 'extension.ts')],
    outfile: path.join(folder, 'extension.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    logLevel: 'warning',
  });
  const manifest = JSON.parse(
    readFileSync(path.join(source, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
  delete manifest.private;
  writeFileSync(
    path.join(folder, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        license: 'MIT',
        repository: {type: 'git', url: 'https://example.invalid/agent.git'},
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(folder, 'LICENSE'), 'MIT\n');
  const vsix = path.join(runFolder, 'window-agent.vsix');
  const result = spawnSync(
    process.execPath,
    [
      resolveBinary('@vscode/vsce/vsce'),
      'package',
      '--no-dependencies',
      '--skip-license',
      '--allow-missing-repository',
      '--allow-star-activation',
      '--out',
      vsix,
    ],
    {cwd: folder, encoding: 'utf8'},
  );
  if (result.status !== 0) {
    throw new Error(
      `vsce package of the window agent failed: ${result.stderr.trim()}`,
    );
  }
  return vsix;
}

/** A program to start: its file, its arguments and its environment. */
export interface Program {
  file: string;
  programArguments: string[];
  environment: Record<string, string | undefined>;
}

/** The editor of a launch with no runner: the window it opens first, if it has a folder, and the run's folders. */
export function plainEditorOf(
  executable: string,
  runFolder: string,
  launch: Launch,
  environment: Readonly<Record<string, string | undefined>>,
): Program {
  return {
    file: executable,
    programArguments: [
      ...editorArguments(runFolder),
      '--new-window',
      ...(launch.folderUri === undefined
        ? []
        : ['--folder-uri', launch.folderUri]),
    ],
    // The harness may itself run under an extension host, where the editor's program is a plain Node.js.
    environment: {...environment, ELECTRON_RUN_AS_NODE: undefined},
  };
}

/** The Node mocha run of a launch with no runner: the test files of its suite folder, without the repository's config. */
export function plainTestsOf(
  root: string,
  launch: Launch,
  environment: Readonly<Record<string, string | undefined>>,
): Program {
  return {
    file: process.execPath,
    programArguments: [
      resolveBinary('mocha/bin/mocha.js'),
      '--no-config',
      '--extension',
      'ts',
      '--spec',
      path.join(root, 'tests', 'acceptance', launch.suite, '*.test.ts'),
    ],
    environment: {...environment},
  };
}

/** A started program that can be stopped, with everything it started. */
export interface Started {
  stop(): void;
}

/** Starts a program detached, in a group of its own, so that stopping it stops the processes it started too. */
export function startDetached(program: Program): Started {
  const child = spawn(program.file, program.programArguments, {
    env: program.environment,
    detached: true,
    stdio: 'ignore',
  });
  // A program that cannot start has no process group to stop; the error must not end the harness unhandled.
  child.on('error', () => undefined);
  child.unref();
  return {
    stop: () => {
      if (child.pid === undefined) {
        return;
      }
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // The group is already gone.
      }
    },
  };
}

/** What a plain launch needs of the run: its folder, the editor's program, and the variables its processes share. */
export interface PlainRun {
  runFolder: string;
  executable: string;
  environment: Readonly<Record<string, string | undefined>>;
}

/** What starting the editor and running the tests are, replaced by a test. */
export interface PlainSteps {
  start: (program: Program) => Started;
  runTests: (program: Program) => Promise<{exitCode: number; output: string}>;
}

/**
 * Runs a launch with no runner: starts the editor, runs the Node tests against it, and stops the editor whatever the
 * tests' outcome. The launch has a script, record and log of its own.
 */
export async function runPlainLaunch(
  root: string,
  session: PlainRun,
  launch: Launch,
  steps: PlainSteps,
): Promise<{exitCode: number; output: string}> {
  const files = launchFiles(session.runFolder, launch.label);
  const environment = {
    ...session.environment,
    REMOTE_OSS_ACCEPTANCE_SCRIPT: files.script,
    REMOTE_OSS_ACCEPTANCE_RECORD: files.record,
    REMOTE_OSS_ACCEPTANCE_LOG: files.logFile,
    ...launch.environment,
  };
  const editor = steps.start(
    plainEditorOf(session.executable, session.runFolder, launch, environment),
  );
  try {
    return await steps.runTests(plainTestsOf(root, launch, environment));
  } finally {
    editor.stop();
  }
}
