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

/** The name of the marker line the CLI preload writes on stderr (ADR-0010 rule 1). */
const PRELOAD_MARKER = 'remote-oss-cli-preload';

/**
 * The run's presentation that a stderr line says, when the whole line is the preload's marker: `echoed` when the
 * preload loaded `node-pty`, so the run's reader is a pty, `plain` when it didn't; undefined for any other line.
 */
function presentationOfMarker(line: string): StdinPresentation | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('marker' in parsed) ||
    parsed.marker !== PRELOAD_MARKER
  ) {
    return undefined;
  }
  const nodePty = 'nodePty' in parsed ? parsed.nodePty : undefined;
  return typeof nodePty === 'object' &&
    nodePty !== null &&
    'loaded' in nodePty &&
    nodePty.loaded === true
    ? 'echoed'
    : 'plain';
}

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
    ): Promise<CliRun> => {
      const spawned = await ports.spawn(
        paths.node,
        ['--require', paths.preload, paths.entry, ...cliArguments],
        {
          shell: false,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...editorEnvironment,
            ELECTRON_RUN_AS_NODE: '1',
            REMOTE_OSS_EDITOR_MODULES: paths.editorModules,
          },
        },
      );
      if (spawned.kind === 'failed') {
        return {kind: 'spawnFailed', message: spawned.message};
      }
      const {process} = spawned;
      process.stdin.on('error', () => undefined);
      let offered = false;
      /** Hands the writer for the CLI's stdin to `onStdin`, once, when the run's presentation is known. */
      function offerStdin(presentation: StdinPresentation): void {
        if (offered || onStdin === undefined) {
          return;
        }
        offered = true;
        // A `plain` run's stdin is a pipe, not a TTY: it does not turn an Enter's CR into the LF a reading shell
        // waits for, so the host does what the TTY driver would. An `echoed` run's stdin reaches a pty, which does
        // it itself.
        function deliver(data: string): void {
          const stdin = process.stdin;
          if (stdin.destroyed) {
            return;
          }
          try {
            stdin.write(
              presentation === 'plain' ? data.replace(/\r/gu, '\n') : data,
            );
          } catch {
            // The CLI ended between the check and the write: nothing to deliver.
          }
        }
        onStdin(deliver, presentation);
      }
      let result: string | undefined;
      function lineOf(
        stream: CliLine['stream'],
      ): ReturnType<typeof lineSplitter> {
        return lineSplitter(line => {
          if (stream === 'stderr') {
            const presentation = presentationOfMarker(line);
            if (presentation !== undefined) {
              offerStdin(presentation);
              return;
            }
          }
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
      offerStdin('plain');
      return {
        kind: 'ran',
        result,
        status: cancellation.aborted ? null : status,
      };
    },
  };
}
