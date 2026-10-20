import {deepStrictEqual} from 'node:assert';
import {
  type RecentEditor,
  recentLabelPortsOf,
} from '../../src/connect/recent-editor.ts';

/** An address of the editor, known by its text. */
function address(text: string) {
  return {toString: () => text};
}

/** The editor over fakes: the window's authority, folders and workspace file, the recent list, and the commands run. */
function editing(
  options: {
    remoteAuthority?: string;
    workspaceFile?: string;
    folders?: string[];
    workspaces?: unknown[];
  } = {},
) {
  const commands: Array<[string, unknown[]]> = [];
  const editor: RecentEditor = {
    env: {remoteAuthority: options.remoteAuthority},
    workspace: {
      workspaceFile:
        options.workspaceFile === undefined
          ? undefined
          : address(options.workspaceFile),
      workspaceFolders: options.folders?.map(folder => ({
        uri: address(folder),
      })),
    },
    commands: {
      executeCommand: (command, ...parameters) => {
        commands.push([command, parameters]);
        return Promise.resolve({workspaces: options.workspaces ?? []});
      },
    },
    // eslint-disable-next-line id-length -- the editor's API names its URI helper Uri
    Uri: {parse: text => ({...address(text), parsed: true})},
  };
  return {ports: recentLabelPortsOf(editor, () => '/home/al'), commands};
}

describe('the Open Recent label over the editor', () => {
  it('names the first folder of a remote window as the folder entry', () => {
    const seen = editing({
      remoteAuthority: 'dev-container+7b7d',
      folders: ['vscode-remote://a/w', 'vscode-remote://a/other'],
    });
    deepStrictEqual(seen.ports.windowEntry(), {
      type: 'folder',
      uri: 'vscode-remote://a/w',
      remoteAuthority: 'dev-container+7b7d',
    });
  });

  it('names the workspace file of a remote workspace window as the workspace entry', () => {
    const seen = editing({
      remoteAuthority: 'dev-container+7b7d',
      workspaceFile: 'vscode-remote://a/w.code-workspace',
      folders: ['vscode-remote://a/w'],
    });
    deepStrictEqual(seen.ports.windowEntry(), {
      type: 'workspace',
      uri: 'vscode-remote://a/w.code-workspace',
      remoteAuthority: 'dev-container+7b7d',
    });
  });

  it('names no entry for a window that is not remote or has no folder', () => {
    deepStrictEqual(
      [
        editing({folders: ['file:///w']}).ports.windowEntry(),
        editing({remoteAuthority: 'dev-container+7b7d'}).ports.windowEntry(),
      ],
      [undefined, undefined],
    );
  });

  it('reads the recent list as the address and the label of each folder and workspace', async () => {
    const seen = editing({
      workspaces: [
        {
          folderUri: address('vscode-remote://a/w'),
          label: '~/w [Dev Container]',
        },
        {workspace: {configPath: address('file:///x.code-workspace')}},
        {label: 'neither'},
      ],
    });
    deepStrictEqual(
      [await seen.ports.recentEntries(), seen.commands],
      [
        [
          {uri: 'vscode-remote://a/w', label: '~/w [Dev Container]'},
          {uri: 'file:///x.code-workspace', label: undefined},
        ],
        [['_workbench.getRecentlyOpened', []]],
      ],
    );
  });

  it('adds an entry through the editor’s command with its address parsed', async () => {
    const seen = editing();
    await seen.ports.addEntry({
      type: 'folder',
      uri: 'vscode-remote://a/w',
      remoteAuthority: 'dev-container+7b7d',
      label: '~/w [Dev Container]',
    });
    const [call] = seen.commands;
    const entry = call?.[1][0] as {uri: unknown};
    deepStrictEqual(
      [call?.[0], JSON.parse(JSON.stringify(entry)), String(entry.uri)],
      [
        '_workbench.addToRecentlyOpened',
        {
          type: 'folder',
          uri: {parsed: true},
          remoteAuthority: 'dev-container+7b7d',
          label: '~/w [Dev Container]',
        },
        'vscode-remote://a/w',
      ],
    );
  });
});
