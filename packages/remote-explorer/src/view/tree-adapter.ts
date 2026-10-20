/**
 * @fileoverview Shows the targets in the Remotes view when core registered it, and turns the editor's configuration
 * events into the one the targets listen for.
 */

import type {Registration} from 'lib-companion';
import type * as vscode from 'vscode';
import {settings} from '../identifiers.generated.ts';
import type {FolderSettings, TargetNode, Targets} from './targets.ts';

const CONFIG_FILE_SETTING = 'remote.SSH.configFile';

/** The part of the editor API the tree uses. */
export type TreeEditor = Pick<
  typeof vscode,
  | 'commands'
  | 'window'
  | 'workspace'
  | 'TreeItem'
  | 'ThemeIcon'
  | 'EventEmitter'
  | 'TreeItemCollapsibleState'
>;

/** Shows the targets in the view when core registered it; otherwise shows nothing and returns undefined. */
export async function showTargets(
  editor: TreeEditor,
  targets: Targets,
  viewId: string,
): Promise<Registration | undefined> {
  const commands = await editor.commands.getCommands(true);
  if (!commands.includes(`${viewId}.focus`)) {
    return undefined;
  }
  const emitter = new editor.EventEmitter<TargetNode | undefined>();
  const subscription = targets.onDidChange(() => {
    emitter.fire(undefined);
  });
  const treeView = editor.window.createTreeView<TargetNode>(viewId, {
    treeDataProvider: {
      onDidChangeTreeData: emitter.event,
      getChildren: async node => [...(await targets.children(node))],
      getTreeItem: node => treeItemOf(editor, targets, node),
    },
    showCollapseAll: true,
  });
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      treeView.dispose();
      subscription.dispose();
      emitter.dispose();
    },
  };
}

/** The subscription that runs `listener` when the configuration file setting changes. */
export function configFileChangesOf(
  editor: Pick<TreeEditor, 'workspace'>,
): (listener: () => void) => Registration {
  return listener =>
    editor.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(CONFIG_FILE_SETTING)) {
        listener();
      }
    });
}

/** The user's values of the two folder settings: a folder value, a profile value and every other source don't count. */
export function folderSettingsOf(
  editor: Pick<TreeEditor, 'workspace'>,
): () => FolderSettings {
  return () => {
    const configuration = editor.workspace.getConfiguration();
    return {
      sortOrder: configuration.inspect(settings.foldersSortOrder.id)
        ?.globalValue,
      collapse: configuration.inspect(settings.collapseRecentFolders.id)
        ?.globalValue,
    };
  };
}

function treeItemOf(
  editor: TreeEditor,
  targets: Targets,
  node: TargetNode,
): vscode.TreeItem {
  const shown = targets.itemOf(node);
  const state = editor.TreeItemCollapsibleState;
  const item = new editor.TreeItem(
    shown.label,
    {
      expanded: state.Expanded,
      collapsed: state.Collapsed,
      none: state.None,
    }[shown.collapsibleState],
  );
  item.id = shown.id;
  item.tooltip = shown.tooltip;
  item.contextValue = shown.contextValue;
  if (shown.description !== undefined) {
    item.description = shown.description;
  }
  if (shown.iconId !== undefined) {
    item.iconPath = new editor.ThemeIcon(shown.iconId);
  }
  return item;
}
