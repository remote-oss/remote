/**
 * @fileoverview Show Container Log, for a container row of the Dev Containers view: a new terminal, titled with the
 * container's image reference, that follows the container's log. The terminal stays open when the log ends. A call
 * without a container row does nothing at all.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import {containerRowOf} from './row-actions.ts';

/**
 * What the terminal's shell runs: the engine program and the container's id are the script's positional words, so
 * nothing of either is ever read as part of the script. `tail` keeps the tab open, with no exit message, once the log
 * has ended.
 */
const LOG_SCRIPT = '"$0" logs --follow "$1"; exec tail -f /dev/null';

/** What the editor's terminal is asked for. */
export interface LogTerminalOptions {
  name: string;
  shellPath: string;
  shellArgs: string[];
}

/** What Show Container Log needs of its surroundings. */
export interface ContainerLogPorts {
  /** The engine the view lists with now; none when no Docker program is named. */
  engine(): EngineHost | undefined;
  /** The engine program as it is spawned. */
  engineFile(): string;
  /** Makes a terminal; it is not shown until asked. */
  createTerminal(options: LogTerminalOptions): {show(): void};
  cancellation: AbortSignal;
}

/** The command: follows the log of the container it is given. */
export function containerLogOf(
  ports: ContainerLogPorts,
): (argument: unknown) => Promise<void> {
  return async argument => {
    const target = containerRowOf(argument);
    if (target === undefined) {
      return;
    }
    const outcome = await ports
      .engine()
      ?.run(
        ['inspect', '--format', '{{.Config.Image}}', target.id],
        {kind: 'none'},
        {cancellation: ports.cancellation},
      );
    const image =
      outcome?.kind === 'ran' && outcome.status === 0
        ? outcome.stdout.trim()
        : '';
    ports
      .createTerminal({
        name: image === '' ? target.label : image,
        shellPath: '/bin/sh',
        shellArgs: ['-c', LOG_SCRIPT, ports.engineFile(), target.id],
      })
      .show();
  };
}
