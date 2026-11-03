/**
 * @fileoverview The two commands that clean up Docker: "Clean Up Dev Containers..." and "Clean Up Dev Volumes...". The
 * steps they take, in order, over what the editor and the engine do for them. Nothing here touches the editor or the
 * engine itself.
 */

import type {CleanUpRow} from './clean-up-scans.ts';

/** What the commands need of the editor and the engine. */
export interface CleanUpPorts {
  /** The rows of the stopped containers; a failing engine rejects. */
  scanContainers(): Promise<CleanUpRow[]>;
  /** The rows of the unused volumes; a failing engine rejects. */
  scanVolumes(): Promise<CleanUpRow[]>;
  /**
   * Shows the multi-select picker with `placeholder` and `rows`, none checked, and gives the rows the user checked, or
   * none when the pick was dismissed.
   */
  pick(
    placeholder: string,
    rows: readonly CleanUpRow[],
  ): Promise<readonly CleanUpRow[] | undefined>;
  /** Removes the containers `identifiers` with one command; a failing engine rejects. */
  removeContainers(identifiers: readonly string[]): Promise<void>;
  /** Removes the volumes `names` with one command; a failing engine rejects. */
  removeVolumes(names: readonly string[]): Promise<void>;
  /** Shows a modal dialog with `text` and one OK button, and gives when it was closed. */
  complete(text: string): Promise<void>;
  /** The texts of the pickers and the dialogs. */
  texts: {
    containersPlaceholder: string;
    volumesPlaceholder: string;
    nothingLeft: string;
    noUnusedVolumes: string;
  };
  /** Writes one line to the log. */
  report(line: string): void;
}

/** Each target once, in the order the rows give them: a container with two rows is removed once. */
function targetsOf(rows: readonly CleanUpRow[]): string[] {
  return [...new Set(rows.map(entry => entry.target))];
}

/**
 * "Clean Up Dev Containers...": the containers picker when a container is stopped, then, once they are removed, the
 * volumes picker when a volume is unused, else the completion dialog. A failing engine rejects, and so does a removal
 * that fails, which ends the command before any further picker.
 */
export async function cleanUpDevContainers(ports: CleanUpPorts): Promise<void> {
  const containers = await ports.scanContainers();
  const chained = containers.length > 0;
  if (chained) {
    const chosen = await ports.pick(
      ports.texts.containersPlaceholder,
      containers,
    );
    if (chosen === undefined) {
      return;
    }
    if (chosen.length > 0) {
      await ports.removeContainers(targetsOf(chosen));
    }
  }
  const volumes = await ports.scanVolumes();
  if (volumes.length === 0) {
    await ports.complete(ports.texts.nothingLeft);
    return;
  }
  await removeChosen(
    ports,
    await ports.pick(ports.texts.volumesPlaceholder, volumes),
  );
  // A volumes picker that came first and alone ends with the dialog, also when dismissed; one chained after the
  // containers' ends silently.
  if (!chained) {
    await ports.complete(ports.texts.nothingLeft);
  }
}

/** Removes the volumes of the rows the user checked; nothing for a dismissed pick or no row. */
async function removeChosen(
  ports: CleanUpPorts,
  chosen: readonly CleanUpRow[] | undefined,
): Promise<void> {
  if (chosen !== undefined && chosen.length > 0) {
    await ports.removeVolumes(targetsOf(chosen));
  }
}

/**
 * "Clean Up Dev Volumes...": the volumes picker when a volume is unused, else a dialog that says none is. An engine that
 * cannot be asked is logged and shows nothing; a removal that fails rejects.
 */
export async function pruneVolumes(ports: CleanUpPorts): Promise<void> {
  let volumes: CleanUpRow[];
  try {
    volumes = await ports.scanVolumes();
  } catch (caught) {
    ports.report(
      `the unused volumes could not be listed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return;
  }
  if (volumes.length === 0) {
    await ports.complete(ports.texts.noUnusedVolumes);
    return;
  }
  await removeChosen(
    ports,
    await ports.pick(ports.texts.volumesPlaceholder, volumes),
  );
}
