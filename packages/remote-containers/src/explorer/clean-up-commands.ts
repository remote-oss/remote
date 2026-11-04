/**
 * @fileoverview The two Clean Up commands over the view's own engine: the scans that read Docker's containers and
 * volumes, the batch removals, and the texts of the pickers and dialogs. A Docker command that fails rejects with the
 * text core shows as the detail of its error dialog.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  type CleanUpPorts,
  cleanUpDevContainers,
  pruneVolumes,
} from './clean-up.ts';
import {containerRowsOf, volumeRowsOf} from './clean-up-scans.ts';
import {engineListingOf} from './engine-listing.ts';

/** The English template of each text of Clean Up, by its string id. */
const CLEAN_UP_TEMPLATES = {
  S315: 'Select stopped dev containers to delete',
  S320: 'Select unused dev volumes to delete',
  S366: 'There are no stopped dev containers or unused dev volumes to delete.',
  S367: 'There are no unused dev volumes to delete.',
} as const;

/** What the commands need of their surroundings. */
export interface CleanUpHost {
  /** The engine the view lists with now; none when no Docker program is named. */
  engine(): EngineHost | undefined;
  /** The program `dev.containers.dockerPath` names, as the user wrote it. */
  program(): string;
  /** Shows the multi-select picker, none checked, and gives the indexes the user checked, or none when it was dismissed. */
  pickMany(
    placeholder: string,
    items: ReadonlyArray<{label: string; description?: string}>,
  ): Promise<readonly number[] | undefined>;
  /** Shows a modal dialog with only `detail` and an OK button, and gives when it was closed. */
  showDone(detail: string): Promise<void>;
  /** Reads the engine again and rebuilds the view. */
  refresh(): Promise<void>;
  report(line: string): void;
  translate: Translate;
  cancellation: AbortSignal;
}

/** The two commands. */
export interface CleanUpCommands {
  devContainers(): Promise<void>;
  volumes(): Promise<void>;
}

/** The commands over `host`. */
export function cleanUpCommandsOf(host: CleanUpHost): CleanUpCommands {
  const {printed, containers, volumes} = engineListingOf(host);

  const ports: CleanUpPorts = {
    scanContainers: async () => containerRowsOf(await containers()),
    scanVolumes: async () => volumeRowsOf(await volumes(), await containers()),
    pick: async (placeholder, rows) => {
      const indexes = await host.pickMany(placeholder, rows);
      return indexes?.flatMap(index => {
        const chosen = rows[index];
        return chosen === undefined ? [] : [chosen];
      });
    },
    removeContainers: async identifiers => {
      try {
        await printed(['rm', ...identifiers]);
      } finally {
        await host.refresh();
      }
    },
    removeVolumes: async names => {
      await printed(['volume', 'rm', ...names]);
    },
    complete: text => host.showDone(text),
    texts: {
      containersPlaceholder: host.translate(CLEAN_UP_TEMPLATES.S315),
      volumesPlaceholder: host.translate(CLEAN_UP_TEMPLATES.S320),
      nothingLeft: host.translate(CLEAN_UP_TEMPLATES.S366),
      noUnusedVolumes: host.translate(CLEAN_UP_TEMPLATES.S367),
    },
    report: line => {
      host.report(line);
    },
  };
  return {
    devContainers: () => cleanUpDevContainers(ports),
    volumes: () => pruneVolumes(ports),
  };
}
