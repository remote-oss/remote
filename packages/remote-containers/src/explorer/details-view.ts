/**
 * @fileoverview The Details (Containers) view of the Remote Explorer: it shows the container the window is connected to.
 * It reads the container through the connection's engine, has the model build the tree, and hands the tree and the
 * section's title to the editor. It reads when the view becomes visible, when the window's connection changes and on
 * Refresh, replaces the whole tree in one change and never shows an empty one in between.
 */

import type {Logger} from 'lib-log';
import type {HeldConnection} from '../connect/connector.ts';
import type {EngineHost} from '../engine/engine-host.ts';
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
  /** Gives the view the focus. */
  focus(): PromiseLike<unknown>;
}

/** How long a Show Details choice lasts in a window that holds a connection, in milliseconds. */
export const CHOICE_MILLISECONDS = 10_000;

/** Everything the view needs. */
export interface DetailsViewPorts {
  editor: DetailsEditor;
  /** The connection the window holds, from the connector. */
  held(): HeldConnection | undefined;
  /** The engine the Dev Containers view lists with, which reads a container the window does not hold. */
  engine(): EngineHost | undefined;
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
  /**
   * Reads the container again, after the read that is running; a chosen container that can't be read any more then
   * leaves zero rows under the view's own name, where an event or a new visibility keeps the rows shown.
   */
  refresh(): Promise<void>;
  /**
   * Shows the container `containerId` under the title `label`, expanded, and gives the view the focus unless the user
   * has collapsed it. In a window that holds a connection the choice lasts ten seconds, and the view then shows the
   * window's own container again; in one that holds none it holds until the next choice. It also ends when the
   * connection the window holds changes; a refresh keeps it.
   */
  showContainer(containerId: string, label: string): Promise<void>;
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
  /** Whether the read that is running answers a Refresh. */
  let readingRefresh = false;
  let visible = false;
  /** Whether the view is in the Remote Explorer now: the window holds a connection or a Show Details chose a container. */
  let present = false;
  /** Whether the view reported itself hidden while it was in the Remote Explorer: the user collapsed it. */
  let hidden = false;
  /** The container a Show Details chose, in place of the one the window holds. */
  let chosen: {containerId: string; label: string} | undefined;
  /** What the tree shows of the chosen container: its id, and the title it was given (none for the view's own name). */
  let rendered: {containerId: string; title: string | undefined} | undefined;
  /** Stops the wait that ends a choice in a window that holds a connection. */
  let stopChoiceTimer: (() => void) | undefined;
  /** Counts the Show Details calls; the tree's ids carry it, so that each one shows every row expanded again. */
  let generation = 0;
  /** Whether a Refresh asked for the next read, which then empties the tree when the container can't be read. */
  let refreshAsked = false;

  /** The container `containerId`, read through `engine`; none when it can't be read. */
  async function shownBy(engine: EngineHost, containerId: string) {
    const inspected = await engine.run(
      inspectArguments([containerId]),
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

  /**
   * Reads the container, builds the next tree and swaps it in with the title. A chosen container that can't be read
   * any more (it was removed) keeps the rows shown, unless the read answers a Refresh, which empties them.
   */
  async function build(): Promise<void> {
    const emptying = refreshAsked;
    refreshAsked = false;
    readingRefresh = emptying;
    const held = ports.held();
    const choice = chosen;
    const engine = choice === undefined ? held?.engine : ports.engine();
    const containerId = choice?.containerId ?? held?.containerId;
    const shown =
      engine === undefined || containerId === undefined
        ? undefined
        : await shownBy(engine, containerId);
    if (
      shown === undefined &&
      !emptying &&
      choice !== undefined &&
      rendered?.containerId === choice.containerId &&
      chosen === choice
    ) {
      return;
    }
    const next =
      shown === undefined ? undefined : detailsTreeOf(shown, ports.translate);
    const showing = held !== undefined || choice !== undefined;
    await editor.setContext(
      contextKeys.remoteContainersShowDetails.id,
      showing,
    );
    if (stopping.signal.aborted) {
      return;
    }
    current = next?.sections ?? [];
    const title =
      choice === undefined
        ? next?.title
        : shown === undefined && emptying
          ? undefined
          : choice.label;
    rendered =
      choice === undefined
        ? undefined
        : {containerId: choice.containerId, title};
    present = showing;
    if (!showing) {
      hidden = false;
    }
    treeView.setTitle(title);
    listeners.forEach(listener => {
      listener();
    });
    if (visible && showing) {
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
    getTreeItem: node => ({
      ...detailsSpecOf(node),
      id: `${String(generation)}/${node.id}`,
    }),
  });
  const visibility = treeView.onDidChangeVisibility(isVisible => {
    visible = isVisible;
    hidden = !isVisible && present;
    if (isVisible) {
      events.start();
      readLogged();
    } else {
      events.stop();
    }
  });
  /** Ends the choice, and with it the wait that was to end it. */
  function endChoice(): void {
    stopChoiceTimer?.();
    stopChoiceTimer = undefined;
    chosen = undefined;
  }
  const unsubscribe = ports.onHeldChanged(() => {
    endChoice();
    readLogged();
  });
  readLogged();
  return {
    refresh: async () => {
      if (reading !== undefined && readingRefresh) {
        await reading;
        return;
      }
      refreshAsked = true;
      // A read that started before the Refresh does not answer it.
      await reading?.catch(() => undefined);
      await read();
    },
    showContainer: async (containerId, label) => {
      stopChoiceTimer?.();
      stopChoiceTimer = undefined;
      chosen = {containerId, label};
      generation += 1;
      if (ports.held() !== undefined) {
        stopChoiceTimer = ports.setTimer(CHOICE_MILLISECONDS, () => {
          endChoice();
          readLogged();
        });
      }
      // A read that started before the choice is waited for, so that the next one is of the choice.
      await reading?.catch(() => undefined);
      await read();
      if (!hidden) {
        await editor.focus();
      }
    },
    dispose: () => {
      if (stopping.signal.aborted) {
        return;
      }
      stopping.abort();
      stopChoiceTimer?.();
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
  let shown: DetailsView | undefined;
  const handle = whenRegistered(
    async () => {
      shown = await showDetails(ports);
      return shown;
    },
    ports,
    'Details',
  );
  return {
    ...handle,
    // A choice before core has registered the view has nothing to show it in.
    showContainer: async (containerId, label) => {
      await shown?.showContainer(containerId, label);
    },
  };
}
