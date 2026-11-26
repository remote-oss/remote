/**
 * @fileoverview The CLI host of a dev container opened from a Remote - SSH window: the dev container CLI runs on the
 * SSH host, on the `node` of the editor's server there, started through the host's exec server. The run's environment
 * is the host's own, so that what the configuration reads of it (`${localEnv}`) is the host's. The CLI is the leader of
 * a process group of its own there, which an abort signals so that its `docker` children end with it.
 */

import {
  type ExecServer,
  GROUP_SCRIPT,
  signalGroupOnHost,
  spawnOnHost,
} from 'lib-server';
import type {CliHost} from './cli-host.ts';
import {nodeCliHost} from './node-cli-host.ts';
import type {NodeCliPorts} from './node-cli-ports.ts';
import type {PlacedCli} from './cli-paths.ts';

/** The CLI at `placed`, run through `server`; a host whose environment can't be read fails the run's start. */
export function execServerCliHost(
  server: Pick<ExecServer, 'spawn' | 'env'>,
  placed: PlacedCli,
): CliHost {
  /** Asks the group to end, as `kill` does; a group that is gone, or a host that can't be asked, is not an error. */
  function endGroup(groupId: number): Promise<void> {
    return signalGroupOnHost(server, groupId, 'TERM');
  }
  const ports: NodeCliPorts = {
    spawn: async (program, programArguments, options) => {
      const spawned = await spawnOnHost(server, {
        script: GROUP_SCRIPT,
        command: [program, ...programArguments],
        environment: options.env,
        cancellation: new AbortController().signal,
        endById: endGroup,
      });
      if (spawned.kind === 'failed') {
        return {kind: 'failed', message: spawned.detail};
      }
      const {process} = spawned;
      /** Settles when `stream` has been read to its end: the host may report the exit before its output has come. */
      function drained(stream: NodeJS.ReadableStream): Promise<void> {
        return new Promise(resolve => {
          stream.once('end', resolve);
        });
      }
      const outputs = Promise.all([
        drained(process.stdout),
        drained(process.stderr),
      ]);
      return {
        kind: 'spawned',
        process: {
          processId: process.processId,
          stdin: process.stdin,
          stdout: process.stdout,
          stderr: process.stderr,
          exited: Promise.all([process.exited, outputs]).then(
            ([status]) => status ?? null,
          ),
        },
      };
    },
    killGroup: (groupId, signal) => {
      void (
        signal === 'SIGTERM'
          ? endGroup(groupId)
          : signalGroupOnHost(server, groupId, 'KILL')
      ).catch(() => undefined);
    },
  };
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: async (cliArguments, onLine, cancellation, onStdin, environment) => {
      let hostEnvironment;
      try {
        hostEnvironment = (await server.env()).env;
      } catch (caught) {
        return {
          kind: 'spawnFailed',
          message: caught instanceof Error ? caught.message : String(caught),
        };
      }
      return nodeCliHost(placed, hostEnvironment, ports).run(
        cliArguments,
        onLine,
        cancellation,
        onStdin,
        environment,
      );
    },
  };
}
