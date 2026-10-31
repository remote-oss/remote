/**
 * @fileoverview The Details (Containers) view of the Remote Explorer: it shows the container the window is connected to.
 * It reads the container through the connection's engine, has the model build the tree, and hands the tree and the
 * section's title to the editor. It reads when the view becomes visible, when the window's connection changes and on
 * Refresh, replaces the whole tree in one change and never shows an empty one in between.
 */

import type {Logger} from 'lib-log';
import type {HeldConnection} from '../connect/connector.ts';
import {contextKeys, views} from '../identifiers.generated.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  type DetailsRow,
  detailsTreeOf,
  shownContainerOf,
} from './details-model.ts';
import {inspectArguments} from './listed-containers.ts';
import type {ContainerEventsSource} from './targets-events.ts';
import type {TreeItemSpec} from './targets-view.ts';
import {whenRegistered} from './when-registered.ts';

/** What the editor asks of the tree. */
export interface DetailsProvider {
  /** Calls the listener when the whole tree has been replaced. */
  onDidChangeTreeData(listener: () => void): {dispose(): void};
  getChildren(node: DetailsRow | undefined): Promise<readonly DetailsRow[]>;
  getTreeItem(node: DetailsRow): TreeItemSpec;
}

/** The tree view the editor made. */
interface DetailsTreeView {
  onDidChangeVisibility(listener: (visible: boolean) => void): {
    dispose(): void;
  };
  /** Sets the section's title; none brings back the name the view was registered with. */
  setTitle(title: string | undefined): void;
  dispose(): void;
}

/** The parts of the editor the view uses. */
interface DetailsEditor {
  /** The ids of the commands the editor has registered now. */
  commandIds(): PromiseLike<readonly string[]>;
  setContext(key: string, value: boolean): PromiseLike<unknown>;
  createTreeView(viewId: string, provider: DetailsProvider): DetailsTreeView;
}

/** Everything the view needs. */
export interface DetailsViewPorts {
  editor: DetailsEditor;
  /** The connection the window holds, from the connector. */
  held(): HeldConnection | undefined;
  /** Calls the listener when the connection the window holds is made, replaced or given back. */
  onHeldChanged(listener: () => void): () => void;
  /** The Docker events of the window, shared with the other views. */
  events: ContainerEventsSource;
  /** Calls `callback` after `milliseconds`; the result stops the wait. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  translate: Translate;
  logger: Logger;
}

/** The view while it is shown. */
export interface DetailsView {
  /** Reads the container again now, or joins the read that is running. */
  refresh(): Promise<void>;
  dispose(): void;
}

/** The tree item a row is shown as: a row with rows under it starts expanded. */
export function detailsSpecOf(node: DetailsRow): TreeItemSpec {
  return {
    id: node.id,
    label: node.label,
    description: node.description === '' ? undefined : node.description,
    tooltip: undefined,
    contextValue: node.viewItem,
    expanded: node.children.length > 0,
    icon: undefined,
  };
}

/** Shows the view when core registered it; otherwise shows nothing and returns undefined. */
export async function showDetails(
  ports: DetailsViewPorts,
): Promise<DetailsView | undefined> {
  const {editor, logger} = ports;
  const commands = await editor.commandIds();
  if (!commands.includes(`${views.detailsContainers}.focus`)) {
    return undefined;
  }
  const listeners = new Set<() => void>();
  const stopping = new AbortController();
  let current: readonly DetailsRow[] = [];
  let reading: Promise<void> | undefined;
  let visible = false;

  /** The container the window holds, read through the connection's engine; none when it can't be read. */
  async function shownBy(held: HeldConnection) {
    const inspected = await held.engine.run(
      inspectArguments([held.containerId]),
      {kind: 'none'},
      {cancellation: stopping.signal},
    );
    if (inspected.kind !== 'ran' || inspected.status !== 0) {
      logger.info(
        `the container could not be read: ${
          inspected.kind === 'failed'
            ? inspected.detail
            : `exit status ${String(inspected.status)}`
        }`,
      );
      return undefined;
    }
    return shownContainerOf(inspected.stdout);
  }

  /** Reads the container, builds the next tree and swaps it in with the title. */
  async function build(): Promise<void> {
    const held = ports.held();
    const shown = held === undefined ? undefined : await shownBy(held);
    const next =
      shown === undefined ? undefined : detailsTreeOf(shown, ports.translate);
    await editor.setContext(
      contextKeys.remoteContainersShowDetails.id,
      held !== undefined,
    );
    if (stopping.signal.aborted) {
      return;
    }
    current = next?.sections ?? [];
    treeView.setTitle(next?.title);
    listeners.forEach(listener => {
      listener();
    });
    if (visible && held !== undefined) {
      events.start();
    }
  }

  const events = ports.events.watch(() => read());

  function read(): Promise<void> {
    reading ??= build().finally(() => {
      reading = undefined;
    });
    return reading;
  }

  function readLogged(): void {
    read().catch((caught: unknown) => {
      logger.error(
        `the Details view could not be updated: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    });
  }

  const treeView = editor.createTreeView(views.detailsContainers, {
    onDidChangeTreeData: listener => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    getChildren: node => Promise.resolve(node?.children ?? current),
    getTreeItem: detailsSpecOf,
  });
  const visibility = treeView.onDidChangeVisibility(isVisible => {
    visible = isVisible;
    if (isVisible) {
      events.start();
      readLogged();
    } else {
      events.stop();
    }
  });
  const unsubscribe = ports.onHeldChanged(readLogged);
  readLogged();
  return {
    refresh: read,
    dispose: () => {
      if (stopping.signal.aborted) {
        return;
      }
      stopping.abort();
      events.stop();
      unsubscribe();
      visibility.dispose();
      treeView.dispose();
      listeners.clear();
    },
  };
}

/** Shows the view as soon as core has registered it, looking again every second until it is there. */
export function showDetailsWhenRegistered(
  ports: DetailsViewPorts,
): DetailsView {
  return whenRegistered(() => showDetails(ports), ports, 'Details');
}
