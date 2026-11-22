/**
 * @fileoverview The Dev Volumes view of the Remote Explorer: it reads the engine's volumes and containers, has the
 * model build the rows, and hands them to the editor. It rebuilds when the view becomes visible, when Docker's volume
 * or container events say so and on Refresh. A window whose Docker can't be used when the view first fills gets no
 * tree data provider, so core's own placeholder shows and Refresh is not there; Docker lost afterwards blanks the view.
 */

import {commands, contextKeys, views} from '../identifiers.generated.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {EngineListing} from './engine-listing.ts';
import {type TreeItemSpec} from './targets-view.ts';
import {type VolumeRow, volumeRowsOf} from './volumes-model.ts';
import {
  type EditorTreeView,
  type TrackedPorts,
  trackedOf,
} from './tracked-view.ts';
import {type ShownView, whenRegistered} from './when-registered.ts';

/** What the editor asks of the tree. */
export interface VolumesProvider {
  /** Calls the listener when the rows have been replaced. */
  onDidChangeTreeData(listener: () => void): {dispose(): void};
  getChildren(node: VolumeRow | undefined): Promise<readonly VolumeRow[]>;
  getTreeItem(node: VolumeRow): TreeItemSpec;
}

/** The parts of the editor the view uses. */
interface VolumesEditor {
  /** The ids of the commands the editor has registered now. */
  commandIds(): PromiseLike<readonly string[]>;
  setContext(key: string, value: boolean): PromiseLike<unknown>;
  createTreeView(viewId: string, provider: VolumesProvider): EditorTreeView;
}

/** Everything the view needs. */
export interface VolumesViewPorts extends TrackedPorts {
  editor: VolumesEditor;
  /** The queries over the engine the window lists with now. */
  listing(): Pick<EngineListing, 'volumes' | 'containers'>;
  now(): number;
  translate: Translate;
}

/** The text core shows for Refresh, in the error that says the command is not there. */
function refreshMissingError(): Error {
  return new Error(`command '${commands.explorerVolumesRefresh.id}' not found`);
}

/** The tree item of a entry. */
export function volumeItemOf(entry: VolumeRow): TreeItemSpec {
  return {
    id: entry.name,
    label: entry.label,
    description: entry.description === '' ? undefined : entry.description,
    tooltip: entry.tooltip,
    contextValue: entry.viewItem,
    expanded: false,
    icon: {kind: 'theme', id: entry.icon},
  };
}

/** Shows the view when core registered it; otherwise shows nothing and returns undefined. */
export async function showVolumes(
  ports: VolumesViewPorts,
): Promise<ShownView | undefined> {
  const {editor, logger} = ports;
  const known = await editor.commandIds();
  if (!known.includes(`${views.devVolumes}.focus`)) {
    return undefined;
  }
  let current: readonly VolumeRow[] = [];

  /** The rows the engine's volumes make, or none when the engine can't be asked. */
  async function read(): Promise<readonly VolumeRow[] | undefined> {
    try {
      const listing = ports.listing();
      const [volumes, containers] = await Promise.all([
        listing.volumes(),
        listing.containers(),
      ]);
      return volumeRowsOf({
        volumes,
        containers,
        now: ports.now(),
        translate: ports.translate,
      });
    } catch (caught) {
      logger.info(
        `the volumes could not be listed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
      return undefined;
    }
  }

  const first = await read();
  if (first === undefined) {
    return {
      refresh: () => Promise.reject(refreshMissingError()),
      dispose: () => undefined,
    };
  }
  current = first;
  await editor.setContext(
    contextKeys.remoteContainersNoDevVolumes.id,
    first.length === 0,
  );

  /** Reads the engine again and swaps the rows in: Docker lost since the start gives no rows and no welcome. */
  async function build(): Promise<void> {
    const rows = await read();
    if (tracked.signal.aborted) {
      return;
    }
    current = rows ?? [];
    await editor.setContext(
      contextKeys.remoteContainersNoDevVolumes.id,
      rows?.length === 0,
    );
    tracked.fire();
  }

  const tracked = trackedOf(ports, 'Dev Volumes', build);
  tracked.follow(
    editor.createTreeView(views.devVolumes, {
      onDidChangeTreeData: tracked.onDidChangeTreeData,
      getChildren: node => Promise.resolve(node === undefined ? current : []),
      getTreeItem: volumeItemOf,
    }),
  );
  return {refresh: tracked.rebuild, dispose: tracked.dispose};
}

/** Shows the view as soon as core has registered it, looking again every second until it is there. */
export function showVolumesWhenRegistered(
  ports: VolumesViewPorts & {
    setTimer(milliseconds: number, callback: () => void): () => void;
  },
): ShownView {
  return whenRegistered(() => showVolumes(ports), ports, 'Dev Volumes');
}
