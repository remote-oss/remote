/**
 * @fileoverview What the views of the Remote Explorer that list the engine's objects share: one rebuild at a time, the
 * Docker events that run while the view is visible, and the reads again after a change of the engine, of the Docker
 * program or of the workspace's trust.
 */

import type {Logger} from 'lib-log';
import type {HeldConnection} from '../connect/connector.ts';
import type {ContainerEventsSource} from './targets-events.ts';

/** The tree view the editor made. */
export interface EditorTreeView {
  onDidChangeVisibility(listener: (visible: boolean) => void): {
    dispose(): void;
  };
  dispose(): void;
}

/** What the sharing needs of the view's surroundings. */
export interface TrackedPorts {
  /** The Docker events of the window, shared with the other views. */
  events: ContainerEventsSource;
  /** The connection the window holds, from the connector. */
  held(): HeldConnection | undefined;
  /** Calls the listener when the effective engine changes; the watch behind it runs only while there is a listener. */
  onEngineChange(listener: () => void): {dispose(): void};
  /** Calls the listener when `dev.containers.dockerPath` changes. */
  onDockerPathChange(listener: () => void): {dispose(): void};
  /** Calls the listener when the window's workspace is granted trust. */
  onTrustGranted(listener: () => void): {dispose(): void};
  logger: Logger;
}

/** A view kept current. */
export interface Tracked<Result> {
  /** Ends when the view is disposed; the build gives it to what it runs on the engine. */
  signal: AbortSignal;
  /** Rebuilds now, or joins the rebuild that is running. */
  rebuild: () => Promise<Result>;
  /** Registers a listener of the editor for the rows that were replaced. */
  onDidChangeTreeData: (listener: () => void) => {dispose(): void};
  /** Calls every registered listener. */
  fire: () => void;
  /** Follows the tree view's visibility, and the changes of the engine, the Docker program and the trust. */
  follow: (treeView: EditorTreeView) => void;
  dispose: () => void;
}

/** The view called `name` in the log, whose rows `build` makes; the first build is the caller's. */
export function trackedOf<Result>(
  ports: TrackedPorts,
  name: string,
  build: () => Promise<Result>,
): Tracked<Result> {
  const listeners = new Set<() => void>();
  const stopping = new AbortController();
  let reading: Promise<Result> | undefined;
  let visible = false;
  let engineChange: {dispose(): void} | undefined;
  let subscriptions: Array<{dispose(): void}> = [];
  let followed: EditorTreeView | undefined;

  const events = ports.events.watch(() => rebuild());

  function rebuild(): Promise<Result> {
    reading ??= build()
      .then(result => {
        if (visible) {
          events.start();
        }
        return result;
      })
      .finally(() => {
        reading = undefined;
      });
    return reading;
  }

  function rebuildLogged(): void {
    rebuild().catch((caught: unknown) => {
      ports.logger.error(
        `the ${name} view could not be rebuilt: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    });
  }

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

  return {
    signal: stopping.signal,
    rebuild,
    onDidChangeTreeData: listener => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    fire: () => {
      listeners.forEach(listener => {
        listener();
      });
    },
    follow: treeView => {
      followed = treeView;
      subscriptions = [
        treeView.onDidChangeVisibility(isVisible => {
          visible = isVisible;
          if (isVisible) {
            events.start();
            rebuildLogged();
            // A switch of the Docker context is followed only while the view is shown.
            engineChange ??= ports.onEngineChange(engineMayHaveChanged);
          } else {
            events.stop();
            engineChange?.dispose();
            engineChange = undefined;
          }
        }),
        ports.onDockerPathChange(engineMayHaveChanged),
        ports.onTrustGranted(engineMayHaveChanged),
      ];
    },
    dispose: () => {
      if (stopping.signal.aborted) {
        return;
      }
      stopping.abort();
      events.stop();
      engineChange?.dispose();
      subscriptions.forEach(subscription => {
        subscription.dispose();
      });
      followed?.dispose();
      listeners.clear();
    },
  };
}
