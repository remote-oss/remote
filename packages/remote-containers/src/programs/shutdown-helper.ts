/**
 * @fileoverview The shutdown helper: a program of its own that every window of the editor instance shares. It keeps
 * the connections the windows tell it about and, ten seconds after the last connection to a container ends, stops the
 * container when no other connection uses it. The extension starts it detached, so it outlives the window that started
 * it; it loads nothing of the editor.
 */

import {execFile} from 'node:child_process';
import {inheritedEnvironment, nodeTimer, runHelper} from 'lib-helper';
import {
  createShutdownRegistry,
  type DockerResult,
} from '../shutdown/registry.ts';
import type {EngineCoordinates} from '../shutdown/protocol.ts';
import {createShutdownHandler} from '../shutdown/shutdown-handler.ts';

/** Writes a line to the error stream, which the extension that started the helper keeps as its log. */
function logLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Runs the engine's `docker` with its environment added to the helper's; the result is never a rejection. */
function runDocker(
  engine: EngineCoordinates,
  argv: readonly string[],
): Promise<DockerResult> {
  return new Promise(resolve => {
    execFile(
      engine.dockerPath,
      [...argv],
      {env: {...inheritedEnvironment(process.env), ...engine.environment}},
      (failure, stdout) => {
        resolve({
          status:
            failure === null
              ? 0
              : typeof failure.code === 'number'
                ? failure.code
                : undefined,
          stdout,
        });
      },
    );
  });
}

runHelper(
  createShutdownHandler(
    createShutdownRegistry({runDocker, setTimer: nodeTimer, logLine}),
  ),
  logLine,
).catch((caught: unknown) => {
  logLine(
    `the shutdown helper stopped: ${caught instanceof Error ? caught.message : String(caught)}`,
  );
  process.exitCode = 1;
});
