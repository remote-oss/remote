/**
 * @fileoverview What the rows of Switch Container (card containers-166) share: folders with several configurations, the
 * windows connected through them, the switch itself, and the state of the containers that a switch leaves.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  inWindow,
  runLabelArguments,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  chooseQuickPickItem,
  editorTabs,
  paletteRows,
  statusItem,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';

/** The command under test. */
export const SWITCH = 'remote-containers.switchContainer';

/** What a configuration file holds besides the run's image and labels: its name, or any properties. */
export type ConfigurationFile = string | Record<string, unknown> | undefined;

/** The folders and windows of the rows of one `describe`, and what is done with them. */
export function switchScene(): {
  /** A folder of the run holding the configurations `files` (path to name or properties), each on the run's image. */
  folderOf: (label: string, files: Record<string, ConfigurationFile>) => string;
  /** Opens `folder` and connects it through the configuration the picker lists as `label`, or the only one. */
  connected: (folder: string, label?: string) => Promise<string>;
  /** Opens a local window on `folder`, which the scene closes when the row ends. */
  opening: (folder: string) => Promise<string>;
  /** Switches `window` to the configuration the picker lists as `label`; done once the window shows its name. */
  switchTo: (window: string, label: string) => Promise<void>;
  /** What identifies the connection of `window`: its title, its indicator and its tabs. */
  stateOf: (
    window: string,
  ) => Promise<{title: string; indicator: string; tabs: string[]}>;
  /** Waits until the palette of `window` lists an entry of this extension; the palette fills late in a new window. */
  waitForOwnEntry: (window: string) => Promise<boolean>;
  /** Closes the windows and removes the containers of the row that ended. */
  cleanUp: () => Promise<void>;
} {
  const opened: string[] = [];
  const folders: string[] = [];

  function folderOf(
    label: string,
    files: Record<string, ConfigurationFile>,
  ): string {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(folder, relative);
      mkdirSync(path.dirname(file), {recursive: true});
      const properties =
        typeof content === 'object'
          ? content
          : content === undefined
            ? {}
            : {name: content};
      writeFileSync(
        file,
        JSON.stringify({
          ...properties,
          image: variable('HARNESS_DEVCONTAINER_IMAGE'),
          runArgs: runLabelArguments(),
        }),
      );
    }
    folders.push(folder);
    return folder;
  }

  async function connected(folder: string, label?: string): Promise<string> {
    const window = await opening(folder);
    const running = inWindow(window, 'remote-containers.reopenInContainer');
    if (label !== undefined) {
      await waitForQuickPick(window, 60_000);
      await chooseQuickPickItem(window, label);
    }
    await running.catch(() => undefined);
    await connectedToContainer(window, 300_000);
    await new Promise(resolve => setTimeout(resolve, 3000));
    return window;
  }

  async function opening(folder: string): Promise<string> {
    const window = await openFolderWindow(folder);
    opened.push(window);
    return window;
  }

  async function switchTo(window: string, label: string): Promise<void> {
    const running = inWindow(window, SWITCH);
    await waitForQuickPick(window, 60_000);
    await chooseQuickPickItem(window, label);
    await running.catch(() => undefined);
    await waitFor(
      `window ${window} to show Dev Container: ${label}`,
      async () => {
        try {
          return (
            (await statusItem(window, 'status.host')).text ===
            `Dev Container: ${label}`
          );
        } catch {
          return false;
        }
      },
      300_000,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  async function stateOf(
    window: string,
  ): Promise<{title: string; indicator: string; tabs: string[]}> {
    return {
      title: await windowTitle(window),
      indicator: (await statusItem(window, 'status.host')).text,
      tabs: (await editorTabs(window)).map(each => each.label),
    };
  }

  async function waitForOwnEntry(window: string): Promise<boolean> {
    await waitFor(
      `the palette of ${window} to list the entries of Dev Containers`,
      async () =>
        (await paletteRows(window, 'Dev Containers: Reopen in Container')).some(
          each => each === 'Dev Containers: Reopen in Container',
        ),
      60_000,
    );
    return true;
  }

  async function cleanUp(): Promise<void> {
    for (const window of opened.splice(0)) {
      await closeWindow(window).catch(() => undefined);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  }

  return {
    folderOf,
    connected,
    opening,
    switchTo,
    stateOf,
    waitForOwnEntry,
    cleanUp,
  };
}
