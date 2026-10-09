/**
 * @fileoverview The shared connection helper: a program of its own that keeps one SSH connection per host for every
 * window of the user and serves them over a local endpoint until its end policy or a stop ends it. The extension
 * starts it detached, so it outlives the window that started it; it loads nothing of the editor.
 */

import {randomBytes} from 'node:crypto';
import {
  helperParameters,
  inheritedEnvironment,
  nodeEndpointPort,
  nodeFilePort,
  nodeTimer,
} from 'lib-helper';
import {
  nodeLauncherFiles,
  nodeProcessSpawner,
  runConnectionHelper,
} from 'lib-ssh';

/** How long a connection to the helper may take to say hello, in milliseconds. */
const HELLO_LIMIT_MILLISECONDS = 2000;

/** Writes a line to the error stream, which the extension that started the helper keeps as its log. */
function logLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

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
