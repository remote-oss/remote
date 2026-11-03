/**
 * @fileoverview The files the CLI bridge reads and writes for a clone in a volume, inside the bootstrap container where
 * that CLI runs: the configuration is read from the volume, and the override file is written to the container's own
 * temporary folder, readable by its root only, and goes with the container.
 */

import {randomBytes} from 'node:crypto';
import type {BridgeFiles} from '../cli/cli-bridge.ts';
import type {OverrideStore} from '../cli/override-files.ts';
import {type EngineStepPorts, stepOf} from './engine-step.ts';

/** The folder of the override files in the bootstrap container. */
const OVERRIDE_FOLDER = '/tmp/cli-overrides';

/** The bridge's reads, by `cat` in `container`; a file that can't be read rejects with the engine's text. */
export function bootstrapFilesOf(
  ports: EngineStepPorts,
  container: string,
): BridgeFiles {
  return {
    readText: async file => {
      const read = await stepOf(ports, ['exec', container, 'cat', file]);
      if (!read.succeeded) {
        throw new Error(read.detail);
      }
      return read.stdout;
    },
  };
}

/** The override store in `container`: the text goes in on stdin, so it is never on a command line. */
export function bootstrapOverrideStoreOf(
  ports: EngineStepPorts,
  container: string,
): OverrideStore {
  return {
    write: async text => {
      const file = `${OVERRIDE_FOLDER}/${randomBytes(8).toString('hex')}.json`;
      const outcome = await ports.engine.run(
        [
          'exec',
          '--interactive',
          container,
          '/bin/sh',
          '-c',
          'umask 077 && mkdir -p "${0%/*}" && cat > "$0"',
          file,
        ],
        {kind: 'text', text},
        ports.options,
      );
      if (outcome.kind === 'failed' || outcome.status !== 0) {
        throw new Error(
          `the override file could not be written in ${container}`,
        );
      }
      return file;
    },
    remove: async file => {
      await stepOf(ports, ['exec', container, 'rm', '-f', file]);
    },
  };
}
