/**
 * @fileoverview The Dev Volumes view of the Remote Explorer: it reads the engine's volumes and containers, has the
 * model build the rows, and hands them to the editor. It rebuilds when the view becomes visible, when Docker's volume
 * or container events say so and on Refresh. A window whose Docker can't be used when the view first fills gets no
 * tree data provider, so core's own placeholder shows and Refresh is not there; Docker lost afterwards blanks the view.
 */

import type {Logger} from 'lib-log';
import type {HeldConnection} from '../connect/connector.ts';
import {commands, contextKeys, views} from '../identifiers.generated.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {EngineListing} from './engine-listing.ts';
import type {ContainerEventsSource} from './targets-events.ts';
import {type TreeItemSpec} from './targets-view.ts';
import {type VolumeRow, volumeRowsOf} from './volumes-model.ts';
import {type ShownView, whenRegistered} from './when-registered.ts';

/** What the editor asks of the tree. */
export interface VolumesProvider {
  /** Calls the listener when the rows have been replaced. */
  onDidChangeTreeData(listener: () => void): {dispose(): void};
  getChildren(node: VolumeRow | undefined): Promise<readonly VolumeRow[]>;
  getTreeItem(node: VolumeRow): TreeItemSpec;
}

/** The tree view the editor made. */
interface EditorTreeView {
  onDidChangeVisibility(listener: (visible: boolean) => void): {
    dispose(): void;
  };
  dispose(): void;
}

/** The parts of the editor the view uses. */
interface VolumesEditor {
  /** The ids of the commands the editor has registered now. */
  commandIds(): PromiseLike<readonly string[]>;
  setContext(key: string, value: boolean): PromiseLike<unknown>;
  createTreeView(viewId: string, provider: VolumesProvider): EditorTreeView;
}

/** Everything the view needs. */
export interface VolumesViewPorts {
  editor: VolumesEditor;
  /** The queries over the engine the window lists with now. */
  listing(): Pick<EngineListing, 'volumes' | 'containers'>;
  /** The Docker events of the window, shared with the other views. */
  events: ContainerEventsSource;
  /** The connection the window holds, from the connector. */
  held(): HeldConnection | undefined;
  now(): number;
  /** Calls the listener when the effective engine changes; the watch behind it runs only while there is a listener. */
  onEngineChange(listener: () => void): {dispose(): void};
  /** Calls the listener when `dev.containers.dockerPath` changes. */
  onDockerPathChange(listener: () => void): {dispose(): void};
  /** Calls the listener when the window's workspace is granted trust. */
  onTrustGranted(listener: () => void): {dispose(): void};
  translate: Translate;
  logger: Logger;
}

/** The text core shows for Refresh, in the error that says the command is not there. */
function refreshMissingError(): Error {
  return new Error(`command '${commands.explorerVolumesRefresh.id}' not found`);
}

/** The tree item of a row. */
export function volumeItemOf(row: VolumeRow): TreeItemSpec {
  return {
    id: row.name,
    label: row.label,
    description: row.description === '' ? undefined : row.description,
    tooltip: row.tooltip,
    contextValue: row.viewItem,
    expanded: false,
    icon: {kind: 'theme', id: row.icon},
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
  const listeners = new Set<() => void>();
  const stopping = new AbortController();
  let current: readonly VolumeRow[] = [];
  let reading: Promise<void> | undefined;
  let visible = false;

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
    if (stopping.signal.aborted) {
      return;
    }
    current = rows ?? [];
    await editor.setContext(
      contextKeys.remoteContainersNoDevVolumes.id,
      rows !== undefined && rows.length === 0,
    );
    listeners.forEach(listener => {
      listener();
    });
    if (visible) {
      events.start();
    }
  }

  const events = ports.events.watch(() => rebuild());

  function rebuild(): Promise<void> {
    reading ??= build().finally(() => {
      reading = undefined;
    });
    return reading;
  }

  function rebuildLogged(): void {
    rebuild().catch((caught: unknown) => {
      logger.error(
        `the Dev Volumes view could not be rebuilt: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    });
  }

  const treeView = editor.createTreeView(views.devVolumes, {
    onDidChangeTreeData: listener => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    getChildren: node => Promise.resolve(node === undefined ? current : []),
    getTreeItem: volumeItemOf,
  });

  let engineChange: {dispose(): void} | undefined;
  const visibility = treeView.onDidChangeVisibility(isVisible => {
    visible = isVisible;
    if (isVisible) {
      events.start();
      rebuildLogged();
      engineChange ??= ports.onEngineChange(engineMayHaveChanged);
    } else {
      events.stop();
      engineChange?.dispose();
      engineChange = undefined;
    }
  });
  /** The window may have another engine now: the events start again and the rows are read again, unless it holds one. */
  function engineMayHaveChanged(): void {
    if (ports.held() !== undefined) {
      return;
    }
    events.stop();
    const stale = reading;
    if (stale === undefined) {
      rebuildLogged();
    } else {
      stale.then(rebuildLogged, rebuildLogged);
    }
  }
  const dockerPath = ports.onDockerPathChange(engineMayHaveChanged);
  const trustGranted = ports.onTrustGranted(engineMayHaveChanged);
  return {
    refresh: rebuild,
    dispose: () => {
      if (stopping.signal.aborted) {
        return;
      }
      stopping.abort();
      events.stop();
      engineChange?.dispose();
      dockerPath.dispose();
      trustGranted.dispose();
      visibility.dispose();
      treeView.dispose();
      listeners.clear();
    },
  };
}

/** Shows the view as soon as core has registered it, looking again every second until it is there. */
export function showVolumesWhenRegistered(
  ports: VolumesViewPorts & {
    setTimer(milliseconds: number, callback: () => void): () => void;
  },
): ShownView {
  return whenRegistered(() => showVolumes(ports), ports, 'Dev Volumes');
}
