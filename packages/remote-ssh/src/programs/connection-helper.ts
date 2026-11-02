/**
 * @fileoverview The shared connection helper: a program of its own that keeps one SSH connection per host for every
 * window of the user and serves them over a local endpoint until its end policy or a stop ends it. The extension
 * starts it detached, so it outlives the window that started it; it loads nothing of the editor.
 */

import {randomBytes} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {
  helperParameters,
  inheritedEnvironment,
  nodeEndpointPort,
  nodeFilePort,
  nodeTimer,
} from 'lib-helper';
import {helperLogLineOf} from '../diagnostics/helper-log.ts';
import {helperLogFileOf} from '../surfaces/scripted-adapters.ts';
import {
  nodeLauncherFiles,
  nodeProcessSpawner,
  runConnectionHelper,
} from 'lib-ssh';

/** How long a connection to the helper may take to say hello, in milliseconds. */
const HELLO_LIMIT_MILLISECONDS = 2000;

/** Writes a line to the error stream and, in an acceptance run, to the extension's log file. */
const logLine = helperLogLineOf(helperLogFileOf(process.env), {
  write: text => {
    process.stderr.write(text);
  },
  append: (file, text) => {
    appendFileSync(file, text);
  },
});

process.on('exit', code => {
  logLine(`the connection helper exits with ${String(code)}`);
});

runConnectionHelper({
  parameters: helperParameters(process.env),
  port: nodeEndpointPort(),
  clock: Date.now,
  scheduler: {setTimer: nodeTimer},
  files: nodeFilePort,
  launcherFiles: nodeLauncherFiles,
  newNonce: () => randomBytes(16).toString('hex'),
  spawner: nodeProcessSpawner,
  editorEnvironment: inheritedEnvironment(process.env),
  helloLimitMilliseconds: HELLO_LIMIT_MILLISECONDS,
  logLine,
}).catch((caught: unknown) => {
  logLine(
    `the connection helper stopped: ${caught instanceof Error ? caught.message : String(caught)}`,
  );
  process.exitCode = 1;
});
