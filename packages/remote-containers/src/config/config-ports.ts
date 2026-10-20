/**
 * @fileoverview The editor adapters of the configuration choice, written over the small parts of the editor's API they
 * use, so that the extension passes the editor's own members and the rows pass fakes: the quick pick with its "Open
 * File" buttons, the warning and information messages, the preview of a file, and the folder listing.
 */

import type {Logger} from 'lib-log';
import type {ConfigFiles} from './discovery.ts';
import type {ConfigSurfaces, PickerAnswer} from './choose-configuration.ts';
import type {EngineDialogPort} from '../engine/preflight.ts';

/** One row of the editor's quick pick. */
interface QuickPickRow {
  label: string;
  description?: string | undefined;
  buttons?:
    | ReadonlyArray<{iconPath?: unknown; tooltip?: string | undefined}>
    | undefined;
}

/** The members of the editor's quick pick the picker uses. */
export interface QuickPickHandle {
  items: readonly QuickPickRow[];
  activeItems: readonly QuickPickRow[];
  readonly selectedItems: readonly QuickPickRow[];
  placeholder: string | undefined;
  canSelectMany: boolean;
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  ignoreFocusOut: boolean;
  onDidAccept(listener: () => void): unknown;
  onDidHide(listener: () => void): unknown;
  onDidTriggerItemButton(
    listener: (event: {item: QuickPickRow}) => void,
  ): unknown;
  show(): void;
  hide(): void;
  dispose(): void;
}

/** The parts of the editor's `window` the surfaces use. */
export interface ConfigEditorHost {
  createQuickPick(): QuickPickHandle;
  showWarningMessage(
    message: string,
    options: {modal: boolean; detail: string},
    ...items: string[]
  ): PromiseLike<string | undefined>;
  /** Opens a file in an editor tab. */
  showTextDocument(
    file: string,
    options: {preview: boolean},
  ): PromiseLike<unknown>;
  /** The editor's icon of that name. */
  iconOf(name: string): unknown;
}

/** The surfaces over the editor, with the engine dialogs given. */
export function configSurfacesOf(
  host: ConfigEditorHost,
  dialogs: Pick<EngineDialogPort, 'showError' | 'revealLog'>,
  logger: Logger,
): ConfigSurfaces {
  return {
    pick: (rows, placeholder, openFileTooltip) =>
      new Promise<PickerAnswer>(resolve => {
        const quick = host.createQuickPick();
        const items = rows.map(entry => ({
          label: entry.label,
          description: entry.description,
          buttons: [
            {iconPath: host.iconOf('go-to-file'), tooltip: openFileTooltip},
          ],
        }));
        function indexOf(candidate: QuickPickRow): number {
          return items.findIndex(
            item =>
              item.label === candidate.label &&
              item.description === candidate.description,
          );
        }
        function answer(given: PickerAnswer): void {
          resolve(given);
          quick.hide();
        }
        quick.placeholder = placeholder;
        quick.canSelectMany = false;
        quick.matchOnDescription = false;
        quick.matchOnDetail = false;
        quick.ignoreFocusOut = false;
        quick.items = items;
        quick.activeItems = items.slice(0, 1);
        quick.onDidAccept(() => {
          const [selected] = quick.selectedItems;
          answer(
            selected === undefined
              ? {kind: 'dismissed'}
              : {kind: 'picked', index: indexOf(selected)},
          );
        });
        quick.onDidTriggerItemButton(event => {
          answer({kind: 'openFile', index: indexOf(event.item)});
        });
        quick.onDidHide(() => {
          resolve({kind: 'dismissed'});
          quick.dispose();
        });
        quick.show();
      }),
    dialogs,
    showWarning: (message, detail, items) =>
      Promise.resolve(
        host.showWarningMessage(message, {modal: true, detail}, ...items),
      ),
    openPreview: async file => {
      try {
        await host.showTextDocument(file, {preview: true});
      } catch (caught) {
        logger.warn(
          `could not open ${file}: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      }
    },
  };
}

/** The parts of the editor's file system the listing uses. */
export interface ConfigFileSystem {
  readDirectory(folder: string): PromiseLike<Array<[string, number]>>;
  readFile(file: string): PromiseLike<Uint8Array>;
  /** Settles when something exists at `path`, and rejects when nothing does. */
  stat(path: string): PromiseLike<unknown>;
}

/** The flags of the editor's `FileType` that a listing tells apart. */
export interface FileTypeFlags {
  File: number;
  Directory: number;
}

/** The files over the editor's file system: a link counts as what it points to. */
export function configFilesOf(
  system: ConfigFileSystem,
  types: FileTypeFlags,
): ConfigFiles {
  return {
    list: async folder => {
      try {
        const entries = await system.readDirectory(folder);
        return entries.map(([name, flags]) => ({
          name,
          kind:
            (flags & types.Directory) !== 0
              ? 'folder'
              : (flags & types.File) !== 0
                ? 'file'
                : 'other',
        }));
      } catch {
        return [];
      }
    },
    exists: async path => {
      try {
        await system.stat(path);
        return true;
      } catch {
        return false;
      }
    },
    read: async file => {
      try {
        return await system.readFile(file);
      } catch {
        return 'unreadable';
      }
    },
  };
}
