/**
 * @fileoverview The `devcontainer` command of a user's shell: a program of its own that the launchers of `cli-bin` run
 * on the editor's Node. It gives the launcher its machine: the disk, the processes, the terminal.
 */

import {execFile, spawn} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {cliPathsOf} from '../cli/cli-paths.ts';
import {editorEnvironmentOf} from '../cli-bin/editor-environment.ts';
import {EDITOR_PROGRAM_VARIABLE} from '../cli-bin/launcher-scripts.ts';
import {runLauncher} from '../cli-bin/launcher.ts';
import {decodeConfiguration} from '../config/configuration-text.ts';

const execFileAsync = promisify(execFile);
const started = Date.now();

/** The extension's install folder: the launcher program is `dist/cli-launcher.js` inside it. */
const extensionPath = path.dirname(path.dirname(process.argv[1] ?? ''));
const cliEntry = cliPathsOf(extensionPath, '').entry;

runLauncher(process.argv.slice(2), {
  current: process.cwd(),
  flavor: process.platform === 'win32' ? path.win32 : path.posix,
  environment: process.env,
  kindOf: async target => {
    try {
      return (await stat(target)).isDirectory() ? 'folder' : 'file';
    } catch {
      return 'missing';
    }
  },
  readText: async file => {
    try {
      return decodeConfiguration(await readFile(file));
    } catch {
      return undefined;
    }
  },
  extensionPath,
  elapsed: () => Date.now() - started,
  system: {
    nodeVersion: process.version,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
  },
  stdout: text => process.stdout.write(text),
  stderr: text => process.stderr.write(text),
  cliOutput: async argv =>
    (await execFileAsync(process.execPath, [cliEntry, ...argv])).stdout,
  runCli: argv =>
    new Promise(resolve => {
      spawn(process.execPath, [cliEntry, ...argv], {stdio: 'inherit'}).on(
        'close',
        code => {
          resolve(code ?? 1);
        },
      );
    }),
  launchEditor: address => {
    spawn(
      process.env[EDITOR_PROGRAM_VARIABLE] ?? process.execPath,
      ['--folder-uri', address],
      {
        detached: true,
        stdio: 'ignore',
        env: editorEnvironmentOf(process.env),
      },
    ).unref();
  },
}).then(
  status => {
    process.exitCode = status;
  },
  (failure: unknown) => {
    process.stderr.write(
      `${failure instanceof Error ? failure.message : String(failure)}\n`,
    );
    process.exitCode = 1;
  },
);
