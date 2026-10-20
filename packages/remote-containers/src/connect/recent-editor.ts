/**
 * @fileoverview The editor's side of the Open Recent label: the window's own folder or workspace file and the editor's
 * list of recent entries, read and added through the editor's internal commands, behind the ports the label takes. The
 * editor's module is handed in, so nothing here imports it.
 */

import type {RecentLabelPorts, StoredEntry} from './recent-label.ts';

/** An address of the editor: its text is the key an entry is found by. */
interface Address {
  toString(): string;
}

/** An entry of the editor's recent list, as `_workbench.getRecentlyOpened` gives it. */
interface EditorEntry {
  folderUri?: Address;
  workspace?: {configPath: Address};
  label?: string;
}

/** The parts of the editor's API the adapter uses; the `vscode` namespace has them. */
export interface RecentEditor {
  env: {remoteAuthority: string | undefined};
  workspace: {
    workspaceFile: Address | undefined;
    workspaceFolders: ReadonlyArray<{uri: Address}> | undefined;
  };
  commands: {
    executeCommand(
      command: string,
      ...parameters: unknown[]
    ): PromiseLike<unknown>;
  };
  Uri: {parse(address: string): Address};
}

/** The ports of the label over the editor; the host's home folder is handed in. */
export function recentLabelPortsOf(
  editor: RecentEditor,
  homeFolder: () => string,
): RecentLabelPorts {
  return {
    homeFolder,
    windowEntry: () => {
      const remoteAuthority = editor.env.remoteAuthority;
      const workspaceFile = editor.workspace.workspaceFile;
      const folder = editor.workspace.workspaceFolders?.[0];
      if (remoteAuthority === undefined) {
        return undefined;
      }
      if (workspaceFile !== undefined) {
        return {
          type: 'workspace',
          uri: workspaceFile.toString(),
          remoteAuthority,
        };
      }
      return folder === undefined
        ? undefined
        : {type: 'folder', uri: folder.uri.toString(), remoteAuthority};
    },
    recentEntries: async () => {
      const recent = (await editor.commands.executeCommand(
        '_workbench.getRecentlyOpened',
      )) as {workspaces: EditorEntry[]};
      return recent.workspaces.flatMap((entry): StoredEntry[] => {
        const address = entry.folderUri ?? entry.workspace?.configPath;
        return address === undefined
          ? []
          : [{uri: address.toString(), label: entry.label}];
      });
    },
    addEntry: async entry => {
      await editor.commands.executeCommand('_workbench.addToRecentlyOpened', {
        ...entry,
        uri: editor.Uri.parse(entry.uri),
      });
    },
  };
}
