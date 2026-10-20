import {deepStrictEqual} from 'node:assert';
import type {Registration} from 'lib-companion';
import type * as vscode from 'vscode';
import {buildSshRows} from '../../src/model/ssh-group.ts';
import type {TargetItem, TargetNode, Targets} from '../../src/view/targets.ts';
import {
  configFileChangesOf,
  folderSettingsOf,
  showTargets,
  type TreeEditor,
} from '../../src/view/tree-adapter.ts';

const GROUP: TargetNode = {kind: 'sshGroup'};

function itemFor(node: TargetNode): TargetItem {
  const item = ITEMS.get(node);
  if (item === undefined) {
    throw new Error('unknown node');
  }
  return item;
}

function hostNodeOf(
  alias: string,
  connected: boolean,
  ...paths: string[]
): TargetNode {
  const [hostRow] = buildSshRows([alias], new Map([[alias, paths]]), undefined);
  if (hostRow === undefined) {
    throw new Error('no row');
  }
  return {
    kind: 'sshHost',
    hostRow,
    connected,
    folders: hostRow.folders.map(folderRow => ({kind: 'sshFolder', folderRow})),
  };
}

const IDLE = hostNodeOf('idle', false);
const ACTIVE = hostNodeOf('live', true);
const EXPANDED = hostNodeOf('open', false, '/w/x');
const COLLAPSED = hostNodeOf('shut', false, '/w/x');
const FOLDER: TargetNode =
  EXPANDED.kind === 'sshHost' && EXPANDED.folders[0] !== undefined
    ? EXPANDED.folders[0]
    : GROUP;

const ITEMS = new Map<TargetNode, TargetItem>([
  [
    GROUP,
    {
      id: 'ssh-group',
      label: 'SSH',
      tooltip: 'SSH',
      contextValue: 'group',
      collapsibleState: 'expanded',
    },
  ],
  [
    IDLE,
    {
      id: 'ssh-host:idle',
      label: 'idle',
      tooltip: 'idle',
      iconId: 'vm',
      contextValue: 'host',
      collapsibleState: 'none',
    },
  ],
  [
    EXPANDED,
    {
      id: 'ssh-host:open',
      label: 'open',
      tooltip: 'open',
      iconId: 'vm',
      contextValue: 'host',
      collapsibleState: 'expanded',
    },
  ],
  [
    COLLAPSED,
    {
      id: 'ssh-host:shut',
      label: 'shut',
      tooltip: 'shut',
      iconId: 'vm',
      contextValue: 'host',
      collapsibleState: 'collapsed',
    },
  ],
  [
    FOLDER,
    {
      id: 'ssh-folder:0:open',
      label: 'x',
      description: '/w/x',
      tooltip: "'/w/x' on open",
      contextValue: 'folder',
      collapsibleState: 'none',
    },
  ],
  [
    ACTIVE,
    {
      id: 'ssh-host:live',
      label: 'live',
      tooltip: 'live',
      description: 'connected',
      iconId: 'vm-active',
      contextValue: 'host',
      collapsibleState: 'none',
    },
  ],
]);

class FakeTreeItem {
  id?: string;
  tooltip?: string;
  contextValue?: string;
  description?: string;
  iconPath?: FakeThemeIcon;
  label: string;
  collapsibleState: number;
  constructor(label: string, collapsibleState: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class FakeThemeIcon {
  id: string;
  constructor(iconId: string) {
    this.id = iconId;
  }
}

class FakeEmitter {
  fired: unknown[] = [];
  disposals = 0;
  listeners: Array<(value: unknown) => void> = [];
  event = (listener: (value: unknown) => void): Registration => {
    this.listeners.push(listener);
    return {dispose: () => undefined};
  };
  fire(value: unknown): void {
    this.fired.push(value);
  }
  dispose(): void {
    this.disposals += 1;
  }
}

type ConfigEvent = Pick<
  vscode.ConfigurationChangeEvent,
  'affectsConfiguration'
>;

interface Setup {
  editor: TreeEditor;
  targets: Targets;
  created: Array<{viewId: string; options: vscode.TreeViewOptions<TargetNode>}>;
  emitters: FakeEmitter[];
  fireChange(): void;
  disposals: {view: number; subscription: number};
  configListener(): ((event: ConfigEvent) => void) | undefined;
}

function setup(commands: string[]): Setup {
  const created: Setup['created'] = [];
  const emitters: FakeEmitter[] = [];
  const disposals = {view: 0, subscription: 0};
  let change: (() => void) | undefined;
  let config: ((event: ConfigEvent) => void) | undefined;
  class TrackedEmitter extends FakeEmitter {
    constructor() {
      super();
      emitters.push(this);
    }
  }
  const editor = {
    commands: {getCommands: () => Promise.resolve(commands)},
    window: {
      createTreeView: (
        viewId: string,
        options: vscode.TreeViewOptions<TargetNode>,
      ) => {
        created.push({viewId, options});
        return {
          dispose: () => {
            disposals.view += 1;
          },
        };
      },
    },
    workspace: {
      onDidChangeConfiguration: (listener: (event: ConfigEvent) => void) => {
        config = listener;
        return {dispose: () => undefined};
      },
    },
    TreeItem: FakeTreeItem,
    ThemeIcon: FakeThemeIcon,
    EventEmitter: TrackedEmitter,
    TreeItemCollapsibleState: {None: 0, Collapsed: 1, Expanded: 2},
  } as unknown as TreeEditor;
  const targets = {
    children: () => Promise.resolve([GROUP]),
    itemOf: (node: TargetNode) => itemFor(node),
    onDidChange: (listener: () => void) => {
      change = listener;
      return {
        dispose: () => {
          disposals.subscription += 1;
        },
      };
    },
  } as unknown as Targets;
  return {
    editor,
    targets,
    created,
    emitters,
    fireChange: () => {
      change?.();
    },
    disposals,
    configListener: () => config,
  };
}

const FOCUS = ['remoteTargets.focus'];

function providerOf(scenario: Setup): vscode.TreeDataProvider<TargetNode> {
  const provider = scenario.created[0]?.options.treeDataProvider;
  if (provider === undefined) {
    throw new Error('no tree view');
  }
  return provider;
}

describe('the tree of the Remotes view (card explorer-04)', () => {
  it('F-5101.7.E5: without the focus command nothing is created and nothing is returned', async () => {
    const scenario = setup(['other.focus']);
    const shown = await showTargets(
      scenario.editor,
      scenario.targets,
      'remoteTargets',
    );
    deepStrictEqual(
      [shown, scenario.created.length, scenario.emitters.length],
      [undefined, 0, 0],
    );
  });

  it('F-5101.AC-1, AC-7, F-5103.AC-38: F-5101.16: with the focus command the tree view is created once with Collapse All', async () => {
    const scenario = setup(FOCUS);
    await showTargets(scenario.editor, scenario.targets, 'remoteTargets');
    deepStrictEqual(
      scenario.created.map(call => [call.viewId, call.options.showCollapseAll]),
      [['remoteTargets', true]],
    );
  });

  it('F-5101.AC-41, F-5102.AC-33, AC-39, AC-40: F-5102.3.3: the group is an expanded item without icon or description', async () => {
    const scenario = setup(FOCUS);
    await showTargets(scenario.editor, scenario.targets, 'remoteTargets');
    const item = (await providerOf(scenario).getTreeItem(
      GROUP,
    )) as unknown as FakeTreeItem;
    deepStrictEqual(
      Object.entries(item).filter(([, value]) => value !== undefined),
      [
        ['id', 'ssh-group'],
        ['tooltip', 'SSH'],
        ['contextValue', 'group'],
        ['label', 'SSH'],
        ['collapsibleState', 2],
      ],
    );
  });

  it('F-5103.AC-16: F-5102.3.3: an unconnected host is a leaf with the vm icon', async () => {
    const scenario = setup(FOCUS);
    await showTargets(scenario.editor, scenario.targets, 'remoteTargets');
    const item = (await providerOf(scenario).getTreeItem(
      IDLE,
    )) as unknown as FakeTreeItem;
    deepStrictEqual(
      [
        item.collapsibleState,
        item.iconPath,
        item.description,
        item.id,
        item.tooltip,
        item.contextValue,
      ],
      [0, new FakeThemeIcon('vm'), undefined, 'ssh-host:idle', 'idle', 'host'],
    );
  });

  it('F-5102.3.3: a connected host has the active icon and its description', async () => {
    const scenario = setup(FOCUS);
    await showTargets(scenario.editor, scenario.targets, 'remoteTargets');
    const item = (await providerOf(scenario).getTreeItem(
      ACTIVE,
    )) as unknown as FakeTreeItem;
    deepStrictEqual(
      [item.iconPath, item.description],
      [new FakeThemeIcon('vm-active'), 'connected'],
    );
  });

  it('F-5101.16: the provider gives the children the targets give', async () => {
    const scenario = setup(FOCUS);
    await showTargets(scenario.editor, scenario.targets, 'remoteTargets');
    deepStrictEqual(await providerOf(scenario).getChildren(undefined), [GROUP]);
  });

  it('F-5101.AC-10: F-5101.BR-4: a change of the targets fires the emitter once with undefined', async () => {
    const scenario = setup(FOCUS);
    await showTargets(scenario.editor, scenario.targets, 'remoteTargets');
    scenario.fireChange();
    deepStrictEqual(scenario.emitters[0]?.fired, [undefined]);
  });

  it('F-5101.16: disposing twice disposes the view, the subscription and the emitter once each', async () => {
    const scenario = setup(FOCUS);
    const shown = await showTargets(
      scenario.editor,
      scenario.targets,
      'remoteTargets',
    );
    shown?.dispose();
    shown?.dispose();
    deepStrictEqual(
      [
        scenario.disposals.view,
        scenario.disposals.subscription,
        scenario.emitters[0]?.disposals,
      ],
      [1, 1, 1],
    );
  });

  it('F-5101.AC-16, F-5102.AC-17: F-5101.6.5: only a change affecting the configuration file runs the listener', () => {
    const scenario = setup(FOCUS);
    let invocations = 0;
    configFileChangesOf(scenario.editor)(() => {
      invocations += 1;
    });
    const listener = scenario.configListener();
    for (const key of ['remote.SSH.configFile', 'remote.SSH.connectTimeout']) {
      listener?.({
        affectsConfiguration: (section: string) => section === key,
      });
    }
    deepStrictEqual(invocations, 1);
  });

  it('F-5104.BR-7: a host item is expanded, collapsed or a leaf as its state says, and a folder item is a leaf with no icon', async () => {
    const scenario = setup(FOCUS);
    await showTargets(scenario.editor, scenario.targets, 'remoteTargets');
    const items = await Promise.all(
      [EXPANDED, COLLAPSED, IDLE, FOLDER].map(
        async node =>
          (await providerOf(scenario).getTreeItem(
            node,
          )) as unknown as FakeTreeItem,
      ),
    );
    deepStrictEqual(
      items.map(item => [
        item.collapsibleState,
        item.iconPath,
        item.description,
      ]),
      [
        [2, new FakeThemeIcon('vm'), undefined],
        [1, new FakeThemeIcon('vm'), undefined],
        [0, new FakeThemeIcon('vm'), undefined],
        [0, undefined, '/w/x'],
      ],
    );
  });

  it('F-5104.3.3: a folder item carries its id, label, tooltip and context value, and no command', async () => {
    const scenario = setup(FOCUS);
    await showTargets(scenario.editor, scenario.targets, 'remoteTargets');
    const item = (await providerOf(scenario).getTreeItem(
      FOLDER,
    )) as unknown as FakeTreeItem & {command?: unknown};
    deepStrictEqual(
      [item.id, item.label, item.tooltip, item.contextValue, item.command],
      ['ssh-folder:0:open', 'x', "'/w/x' on open", 'folder', undefined],
    );
  });

  it('F-5104.BR-6, BR-12: only the user value of each folder setting counts', () => {
    const inspected: Record<string, unknown> = {
      'remote-explorer.foldersSortOrder': {
        defaultValue: 'most recently used',
        globalValue: 'alphabetical',
        workspaceValue: 'most recently used',
        workspaceFolderValue: 'most recently used',
      },
      'remote-explorer.collapseRecentFolders': {
        defaultValue: false,
        workspaceValue: true,
        workspaceFolderValue: true,
      },
    };
    const editor = {
      workspace: {
        getConfiguration: () => ({
          inspect: (key: string) => inspected[key],
        }),
      },
    } as unknown as TreeEditor;
    deepStrictEqual(folderSettingsOf(editor)(), {
      sortOrder: 'alphabetical',
      collapse: undefined,
    });
  });

  it('F-5104.BR-6: a setting the editor does not know gives nothing', () => {
    const editor = {
      workspace: {
        getConfiguration: () => ({inspect: () => undefined}),
      },
    } as unknown as TreeEditor;
    deepStrictEqual(folderSettingsOf(editor)(), {
      sortOrder: undefined,
      collapse: undefined,
    });
  });
});
