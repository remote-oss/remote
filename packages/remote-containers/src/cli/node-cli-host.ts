/**
 * @fileoverview The CLI host over a spawned `node`: the CLI runs as the leader of its own process group, with the
 * editor's environment, and an abort signals the whole group so that its `docker` children end with it.
 */

import {lineSplitter} from '../line-splitter.ts';
import type {
  CliHost,
  CliLine,
  CliRun,
  StdinOf,
  StdinPresentation,
} from './cli-host.ts';
import type {CliPaths} from './cli-paths.ts';
import type {NodeCliPorts, SpawnedCli} from './node-cli-ports.ts';

/** How long the CLI has to end after SIGTERM before it is killed. */
const KILL_AFTER_MILLISECONDS = 5000;

/** The CLI host: `node` is the editor's own executable, run as plain Node. */
export function nodeCliHost(
  paths: CliPaths & {node: string},
  editorEnvironment: Readonly<Record<string, string | undefined>>,
  ports: NodeCliPorts,
): CliHost {
  /** Ends the group: SIGTERM now, SIGKILL after a while if it has not ended; a gone group is not an error. */
  function terminate(process: SpawnedCli, ended: Promise<unknown>): void {
    const {processId} = process;
    function signal(name: 'SIGTERM' | 'SIGKILL'): void {
      try {
        if (processId !== undefined) {
          ports.killGroup(processId, name);
        }
      } catch {
        // The group is already gone, which is what the signal was for.
      }
    }
    signal('SIGTERM');
    const timer = setTimeout(() => {
      signal('SIGKILL');
    }, KILL_AFTER_MILLISECONDS);
    void ended.then(() => {
      clearTimeout(timer);
    });
  }

  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: async (
      cliArguments: readonly string[],
      onLine: (line: CliLine) => void,
      cancellation: AbortSignal,
      onStdin?: StdinOf,
      presentation?: StdinPresentation,
    ): Promise<CliRun> => {
      const spawned = await ports.spawn(
        paths.node,
        ['--require', paths.preload, paths.entry, ...cliArguments],
        {
          shell: false,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {...editorEnvironment, ELECTRON_RUN_AS_NODE: '1'},
        },
      );
      if (spawned.kind === 'failed') {
        return {kind: 'spawnFailed', message: spawned.message};
      }
      const {process} = spawned;
      if (onStdin !== undefined) {
        // The CLI's stdin is a pipe, not a TTY: it does not turn an Enter's CR into the LF a reading shell waits
        // for, so the host does what the TTY driver would.
        function deliver(data: string): void {
          const stdin = process.stdin;
          if (stdin.destroyed) {
            return;
          }
          try {
            stdin.write(data.replace(/\r/gu, '\n'));
          } catch {
            // The CLI ended between the check and the write: nothing to deliver.
          }
        }
        process.stdin.on('error', () => undefined);
        onStdin(deliver, presentation ?? 'plain');
      }
      let result: string | undefined;
      function lineOf(
        stream: CliLine['stream'],
      ): ReturnType<typeof lineSplitter> {
        return lineSplitter(line => {
          if (stream === 'stdout' && result === undefined) {
            result = line;
          }
          onLine({stream, line});
        });
      }
      const printed = lineOf('stdout');
      const errors = lineOf('stderr');
      process.stdout.on('data', (chunk: Buffer) => {
        printed.push(chunk);
      });
      process.stderr.on('data', (chunk: Buffer) => {
        errors.push(chunk);
      });
      function end(): void {
        terminate(process, process.exited);
      }
      if (cancellation.aborted) {
        end();
      }
      cancellation.addEventListener('abort', end, {once: true});
      const status = await process.exited;
      cancellation.removeEventListener('abort', end);
      printed.flush();
      errors.flush();
      return {
        kind: 'ran',
        result,
        status: cancellation.aborted ? null : status,
      };
    },
  };
}
