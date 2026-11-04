/**
 * @fileoverview What the view's own engine lists: its containers and its volumes, read through the engine's quiet
 * listings and its inspects. A command that fails rejects with the text core shows as the detail of its error dialog.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import {
  inspectArguments,
  LIST_ARGUMENTS,
  type ListedContainer,
  listedContainersOf,
} from './listed-containers.ts';
import {
  type ListedVolume,
  listedVolumesOf,
  VOLUME_LIST_ARGUMENTS,
  volumeInspectArguments,
} from './listed-volumes.ts';

/** What the listings need of their surroundings. */
export interface EngineListingHost {
  /** The engine the view lists with now; none when no Docker program is named. */
  engine(): EngineHost | undefined;
  /** The program `dev.containers.dockerPath` names, as the user wrote it. */
  program(): string;
  cancellation: AbortSignal;
}

/** The queries over `host`'s engine. */
export interface EngineListing {
  /** The stdout of `argv`; a run that doesn't end with 0 rejects with the text of a failed command. */
  printed(argv: readonly string[]): Promise<string>;
  containers(): Promise<ListedContainer[]>;
  volumes(): Promise<ListedVolume[]>;
}

/** The names or ids a listing printed, one on a line. */
function linesOf(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
}

/** The queries over `host`. */
export function engineListingOf(host: EngineListingHost): EngineListing {
  const options = {cancellation: host.cancellation};

  async function printed(argv: readonly string[]): Promise<string> {
    const outcome = await host.engine()?.run(argv, {kind: 'none'}, options);
    if (outcome?.kind === 'failed') {
      throw new Error(outcome.detail);
    }
    if (outcome?.kind !== 'ran' || outcome.status !== 0) {
      throw new Error(`Command failed: ${[host.program(), ...argv].join(' ')}`);
    }
    return outcome.stdout;
  }

  return {
    printed,
    containers: async () => {
      const identifiers = linesOf(await printed(LIST_ARGUMENTS));
      if (identifiers.length === 0) {
        return [];
      }
      const listed = listedContainersOf(
        await printed(inspectArguments(identifiers)),
      );
      if (listed === undefined) {
        throw new Error(
          `Command failed: ${[host.program(), ...inspectArguments(identifiers)].join(' ')}`,
        );
      }
      return listed;
    },
    volumes: async () => {
      const names = linesOf(await printed(VOLUME_LIST_ARGUMENTS));
      if (names.length === 0) {
        return [];
      }
      const listed = listedVolumesOf(
        await printed(volumeInspectArguments(names)),
      );
      if (listed === undefined) {
        throw new Error(
          `Command failed: ${[host.program(), ...volumeInspectArguments(names)].join(' ')}`,
        );
      }
      return listed;
    },
  };
}
