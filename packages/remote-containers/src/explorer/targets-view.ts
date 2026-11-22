/**
 * @fileoverview The Dev Containers view of the Remote Explorer: it reads the engine's containers and the window's
 * facts, has the model build the tree, and hands the tree to the editor. It rebuilds when the view becomes visible and
 * on Refresh, replaces the whole tree in one change and never shows an empty one in between.
 */

import type {HeldConnection} from '../connect/connector.ts';
import type {EngineHost} from '../engine/engine-host.ts';
import {executableOf} from '../engine/executable.ts';
import {contextKeys, views} from '../identifiers.generated.ts';
import {
  configFileOf,
  isDevContainer,
  localFolderOf,
} from '../lifecycle/labels.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  inspectArguments,
  LIST_ARGUMENTS,
  type ListedContainer,
  listedContainersOf,
} from './listed-containers.ts';
import type {TooltipLine} from './volumes-model.ts';
import {
  type EditorTreeView,
  type TrackedPorts,
  trackedOf,
} from './tracked-view.ts';
import {whenRegistered} from './when-registered.ts';
import {
  type RowIcon,
  type TargetGroup,
  type TargetRow,
  type TargetsTree,
  targetsTreeOf,
  type WelcomeKey,
} from './targets-model.ts';

/** The context key that each welcome of the model switches on. */
const WELCOME_CONTEXT_KEYS: Readonly<Record<WelcomeKey, string>> = {
  needsDockerStartOrInstall:
    contextKeys.remoteContainersNeedsDockerStartOrInstall.id,
  needsSSHCredentials: contextKeys.remoteContainersNeedsSSHCredentials.id,
  noContainersWithFolder: contextKeys.remoteContainersNoContainersWithFolder.id,
  noContainersWithoutFolder:
    contextKeys.remoteContainersNoContainersWithoutFolder.id,
};

/** The icon of a row: a codicon of the editor, or a file of the package's `resources`. */
type TreeIcon = {kind: 'theme'; id: string} | {kind: 'resource'; file: string};

/** The icon of a row of the model. */
function iconOf(icon: RowIcon): TreeIcon {
  switch (icon) {
    case 'vmActive':
      return {kind: 'resource', file: 'vm-active.svg'};
    case 'vmRunning':
      return {kind: 'theme', id: 'vm-running'};
    case 'vm':
      return {kind: 'theme', id: 'vm'};
    case 'folder':
      return {kind: 'theme', id: 'folder'};
    case 'folderActive':
      return {kind: 'resource', file: 'folder-active.svg'};
    default:
      return {kind: 'theme', id: 'vm-outline'};
  }
}

/** What the editor's tree item of a node is made from. */
export interface TreeItemSpec {
  id: string;
  label: string;
  description: string | undefined;
  tooltip: string | readonly TooltipLine[] | undefined;
  contextValue: string | undefined;
  /** Whether the node starts expanded; a node with nothing under it never does. */
  expanded: boolean;
  icon: TreeIcon | undefined;
}

/** A node of the tree: a group header or a row. */
export type TargetsNode = TargetGroup | TargetRow;

/** What the editor asks of the tree. */
export interface TargetsProvider {
  /** Calls the listener when the whole tree has been replaced. */
  onDidChangeTreeData(listener: () => void): {dispose(): void};
  getChildren(node: TargetsNode | undefined): Promise<readonly TargetsNode[]>;
  getTreeItem(node: TargetsNode): TreeItemSpec;
}

/** The parts of the editor the view uses. */
interface TargetsEditor {
  /** The ids of the commands the editor has registered now. */
  commandIds(): PromiseLike<readonly string[]>;
  setContext(key: string, value: boolean): PromiseLike<unknown>;
  createTreeView(viewId: string, provider: TargetsProvider): EditorTreeView;
}

/** Everything the view needs. */
export interface TargetsViewPorts extends TrackedPorts {
  editor: TargetsEditor;
  /** Called once, after the first time the view's data has loaded. */
  loaded(): void;
  /** Whether the Docker host in effect is an `ssh://` one whose host name starts with a dash, which no process may be started for. */
  dashHost?(): Promise<boolean>;
  /** `dev.containers.dockerPath` as the editor reports it now. */
  dockerPath(): unknown;
  /** Whether the window's workspace is trusted now. */
  trusted(): boolean;
  /** The paths of the window's workspace folders. */
  folders(): readonly string[];
  /** The Docker CLI for a program. */
  engineFor(file: string): EngineHost;
  /** Whether a file exists on this machine. */
  exists(file: string): Promise<boolean>;
  now(): number;
  /** Calls `callback` after `milliseconds`; the result stops the wait. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  translate: Translate;
}

/** The view while it is shown. */
export interface TargetsView {
  /** Rebuilds the tree now, or joins the rebuild that is running. */
  refresh(): Promise<void>;
  dispose(): void;
}

/** The tree item a node is shown as: groups start expanded, rows only when something is under them. */
export function specOf(node: TargetsNode): TreeItemSpec {
  if ('rows' in node) {
    return {
      id: node.id,
      label: node.label,
      description: undefined,
      tooltip: undefined,
      contextValue: undefined,
      expanded: true,
      icon: undefined,
    };
  }
  return {
    id: node.id,
    label: node.label,
    description: node.description,
    tooltip: node.tooltip,
    contextValue: node.viewItem,
    expanded: node.children.length > 0,
    icon: iconOf(node.icon),
  };
}

/** The children of a node of `tree`; the root's are its groups. */
function childrenOf(
  tree: TargetsTree,
  node: TargetsNode | undefined,
): readonly TargetsNode[] {
  if (node === undefined) {
    return tree.groups;
  }
  return 'rows' in node ? node.rows : node.children;
}

/**
 * The engine of the connection the window holds, else the one the setting names; none when it names no program. A
 * relative value is the folder's own file, so it names a program only once the folder is trusted.
 */
export function engineOfWindow(
  ports: Pick<
    TargetsViewPorts,
    'dockerPath' | 'folders' | 'engineFor' | 'trusted'
  >,
  held: HeldConnection | undefined,
): EngineHost | undefined {
  if (held !== undefined) {
    return held.engine;
  }
  const executable = executableOf(
    ports.dockerPath(),
    ports.trusted() ? ports.folders()[0] : undefined,
  );
  return executable.kind === 'spawn'
    ? ports.engineFor(executable.file)
    : undefined;
}

/** Shows the view when core registered it; otherwise shows nothing and returns undefined. */
export async function showTargets(
  ports: TargetsViewPorts,
): Promise<TargetsView | undefined> {
  const {editor, logger} = ports;
  const commands = await editor.commandIds();
  if (!commands.includes(`${views.targetsContainers}.focus`)) {
    return undefined;
  }
  let current: TargetsTree | undefined;

  /** Says in the log why the containers could not be listed. */
  function unreachable(reason: string): 'unreachable' {
    logger.info(`the containers could not be listed: ${reason}`);
    return 'unreachable';
  }

  /** The containers the engine lists, or why it can't. */
  async function listedBy(
    engine: EngineHost | undefined,
  ): Promise<readonly ListedContainer[] | 'unreachable'> {
    if (engine === undefined) {
      return unreachable('no Docker program is named');
    }
    if ((await ports.dashHost?.()) === true) {
      return unreachable('the Docker host over ssh starts with a dash');
    }
    const options = {cancellation: tracked.signal};
    const listed = await engine.run(LIST_ARGUMENTS, {kind: 'none'}, options);
    if (listed.kind !== 'ran' || listed.status !== 0) {
      return unreachable(
        listed.kind === 'failed'
          ? listed.detail
          : `exit status ${String(listed.status)}`,
      );
    }
    const wanted = listed.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '');
    if (wanted.length === 0) {
      return [];
    }
    const inspected = await engine.run(
      inspectArguments(wanted),
      {kind: 'none'},
      options,
    );
    if (inspected.kind !== 'ran') {
      return unreachable(inspected.detail);
    }
    return (
      listedContainersOf(inspected.stdout) ??
      unreachable('the engine answered with something that is not a list')
    );
  }

  /** Whether the configuration of a dev container exists on this machine (BR-11). */
  async function hasConfiguration(
    labels: Readonly<Record<string, string>>,
  ): Promise<boolean> {
    const folder = localFolderOf(labels);
    if (folder === undefined) {
      return true;
    }
    const named = configFileOf(labels);
    if (named !== undefined) {
      return ports.exists(named);
    }
    return (
      (await ports.exists(`${folder}/.devcontainer/devcontainer.json`)) ||
      (await ports.exists(`${folder}/.devcontainer.json`))
    );
  }

  /** The ids of the dev containers whose configuration exists. */
  async function withConfigurationOf(
    containers: readonly ListedContainer[],
  ): Promise<ReadonlySet<string>> {
    const found = await Promise.all(
      containers
        .filter(container => isDevContainer(container.labels))
        .map(async container =>
          (await hasConfiguration(container.labels)) ? container.id : undefined,
        ),
    );
    return new Set(found.filter(containerId => containerId !== undefined));
  }

  /** Reads the engine and the window, builds the next tree and swaps it in. */
  async function build(): Promise<TargetsTree> {
    const held = ports.held();
    const containers = await listedBy(engineOfWindow(ports, held));
    const next = targetsTreeOf({
      containers,
      window: {
        folderOpen: ports.folders().length > 0,
        connection:
          held === undefined
            ? undefined
            : {
                containerId: held.containerId,
                hostPath: held.hostPath,
                remoteWorkspaceFolder: held.remoteWorkspaceFolder,
              },
      },
      withConfiguration:
        containers === 'unreachable'
          ? new Set()
          : await withConfigurationOf(containers),
      now: ports.now(),
      translate: ports.translate,
    });
    if (tracked.signal.aborted) {
      return next;
    }
    const replaced = current !== undefined;
    current = next;
    if (!replaced) {
      ports.loaded();
    }
    await Promise.all(
      Object.entries(WELCOME_CONTEXT_KEYS).map(([welcome, key]) =>
        editor.setContext(key, next.welcome === welcome),
      ),
    );
    if (replaced) {
      tracked.fire();
    }
    return next;
  }

  const tracked = trackedOf(ports, 'Dev Containers', build);

  const treeView = editor.createTreeView(views.targetsContainers, {
    onDidChangeTreeData: tracked.onDidChangeTreeData,
    getChildren: async node =>
      childrenOf(current ?? (await tracked.rebuild()), node),
    getTreeItem: specOf,
  });
  tracked.follow(treeView);
  return {
    refresh: async () => {
      await tracked.rebuild();
    },
    dispose: tracked.dispose,
  };
}

/** Shows the view as soon as core has registered it, looking again every second until it is there. */
export function showTargetsWhenRegistered(
  ports: TargetsViewPorts,
): TargetsView {
  return whenRegistered(() => showTargets(ports), ports, 'Dev Containers');
}
