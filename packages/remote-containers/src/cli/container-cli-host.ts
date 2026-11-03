/**
 * @fileoverview The CLI host of a clone in a volume: the dev container CLI runs inside the bootstrap container, on the
 * image's own Node, through `docker exec`. The run's variables reach it by name from the Docker client's environment,
 * so no value is on a command line, and the editor's own environment stays out of it.
 */

import {BOOTSTRAP_CLI} from '../volumes/bootstrap.ts';
import type {CliHost} from './cli-host.ts';
import {nodeCliHost} from './node-cli-host.ts';
import type {NodeCliPorts} from './node-cli-ports.ts';

/** The host whose runs are `docker exec` into `container`, the Docker client run with `engineEnvironment`. */
export function containerCliHost(
  dockerPath: string,
  container: string,
  engineEnvironment: Readonly<Record<string, string | undefined>>,
  ports: NodeCliPorts,
): CliHost {
  return nodeCliHost(
    {
      node: 'node',
      entry: BOOTSTRAP_CLI.entry,
      preload: BOOTSTRAP_CLI.preload,
      editorModules: '',
    },
    {},
    {
      spawn: (program, programArguments, options) =>
        ports.spawn(
          dockerPath,
          [
            'exec',
            '--interactive',
            ...Object.keys(options.env).flatMap(name => ['--env', name]),
            container,
            program,
            ...programArguments,
          ],
          {...options, env: {...engineEnvironment, ...options.env}},
        ),
      killGroup: (processId, signal) => {
        ports.killGroup(processId, signal);
      },
    },
  );
}
