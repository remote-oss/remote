import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {openAddressOf} from '../../src/cli-bin/open-address.ts';
import {openArgumentsOf} from '../../src/cli-bin/open-arguments.ts';
import {openPathOf} from '../../src/cli-bin/open-path.ts';
import {
  type OpenPlan,
  type OpenPorts,
  openPlanOf,
} from '../../src/cli-bin/open-plan.ts';
import {devContainerTargetOf} from '../../src/authority/payload.ts';
import {editorEnvironmentOf} from '../../src/cli-bin/editor-environment.ts';

describe('the arguments of devcontainer open (card containers-211)', () => {
  it('F-1201 AC-32, AC-49: the folder defaults to the current one, and a second positional argument is unknown', () => {
    deepStrictEqual(
      [
        openArgumentsOf([]),
        openArgumentsOf(['real']),
        openArgumentsOf(['real', 'trail']),
      ],
      [
        {kind: 'open', path: '.', config: undefined},
        {kind: 'open', path: 'real', config: undefined},
        {kind: 'unknown', argument: 'trail'},
      ],
    );
  });

  it('F-1201 AC-34: --config takes the next argument or follows an equals sign; a missing value is named', () => {
    deepStrictEqual(
      [
        openArgumentsOf(['--config', 'c.json', 'real']),
        openArgumentsOf(['real', '--config=c.json']),
        openArgumentsOf(['real', '--config']),
      ],
      [
        {kind: 'open', path: 'real', config: 'c.json'},
        {kind: 'open', path: 'real', config: 'c.json'},
        {kind: 'missing', option: 'config'},
      ],
    );
  });

  it('F-1201 AC-31, AC-39: --help is help, --disable-telemetry is accepted and changes nothing, any other option is unknown by its name', () => {
    deepStrictEqual(
      [
        openArgumentsOf(['--help']),
        openArgumentsOf(['--disable-telemetry', 'real']),
        openArgumentsOf(['--label=a=b']),
        openArgumentsOf(['-x']),
      ],
      [
        {kind: 'help'},
        {kind: 'open', path: 'real', config: undefined},
        {kind: 'unknown', argument: 'label'},
        {kind: 'unknown', argument: 'x'},
      ],
    );
  });
});

describe('the folder devcontainer open means (card containers-211)', () => {
  it('F-1201 AC-45, BR-20: on POSIX a relative path is resolved against the current folder, .. is resolved and one trailing slash is dropped', () => {
    deepStrictEqual(
      ['dotdot/sub/../../real', 'real/', '.', 'link'].map(argument =>
        openPathOf(argument, '/parent', path.posix),
      ),
      ['/parent/real', '/parent/real', '/parent', '/parent/link'],
    );
  });

  it('F-1201 AC-45, BR-20: an absolute path stays as typed, less one trailing slash, and the root stays', () => {
    deepStrictEqual(
      ['/parent/dotdot/../real/.', '/parent/real/', '/'].map(argument =>
        openPathOf(argument, '/elsewhere', path.posix),
      ),
      ['/parent/dotdot/../real/.', '/parent/real', '/'],
    );
  });

  it('F-1201 AC-50, BR-20: on Windows the same rules hold over backslashes, a trailing backslash stays and a drive’s root keeps its slash', () => {
    const folder = 'C:\\work\\folder';
    deepStrictEqual(
      [
        'dotdot\\sub\\..\\..\\real',
        'dotdot/sub/../../real',
        'trail/',
        'trail\\',
        `${folder}\\dotdot\\..\\real\\.`,
        'C:/work/folder/trail/',
        'C:/',
      ].map(argument => openPathOf(argument, folder, path.win32)),
      [
        `${folder}\\real`,
        `${folder}\\real`,
        `${folder}\\trail`,
        `${folder}\\trail\\`,
        `${folder}\\dotdot\\..\\real\\.`,
        'C:/work/folder/trail',
        'C:/',
      ],
    );
  });
});

/** The machine of the plan's rows: the folders and files by path, and the text of the files. */
function portsOf(
  files: Readonly<Record<string, string>>,
  folders: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
): OpenPorts {
  return {
    current: '/work',
    flavor: path.posix,
    environment,
    kindOf: target =>
      Promise.resolve(
        folders.includes(target)
          ? 'folder'
          : target in files
            ? 'file'
            : 'missing',
      ),
    readText: file => Promise.resolve(files[file]),
  };
}

const PLAIN = '/work/proj';
const DEFAULT_FILE = `${PLAIN}/.devcontainer/devcontainer.json`;

/** The plan for `open` with `argv`, over `ports`. */
async function planOf(
  argv: readonly string[],
  ports: OpenPorts,
): Promise<OpenPlan | {kind: 'refused'; message: string}> {
  const parsed = openArgumentsOf(argv);
  if (parsed.kind !== 'open') {
    throw new Error('not an open');
  }
  return openPlanOf(parsed, ports);
}

describe('the plan of devcontainer open (card containers-211)', () => {
  it('F-1201 AC-32: a folder with a default configuration and no workspaceFolder opens /workspaces/<name>', async () => {
    deepStrictEqual(
      await planOf(
        ['proj'],
        portsOf({[DEFAULT_FILE]: '{"image": "x"}'}, [PLAIN]),
      ),
      {
        kind: 'launch',
        folder: PLAIN,
        configFile: undefined,
        workspacePath: '/workspaces/proj',
      },
    );
  });

  it('F-1201 AC-32: a root .devcontainer.json is found when .devcontainer/devcontainer.json is not', async () => {
    deepStrictEqual(
      (
        await planOf(
          ['proj'],
          portsOf({[`${PLAIN}/.devcontainer.json`]: '{}'}, [PLAIN]),
        )
      ).kind,
      'launch',
    );
  });

  it('F-1201 AC-33, BR-19: workspaceFolder is substituted with the folder, its basename and the environment, an unknown variable and containerEnv give nothing, and empty segments go', async () => {
    const text =
      '{"workspaceFolder": "/w//${localWorkspaceFolderBasename}/${localEnv:C211_SET}/${containerEnv:HOME}/${localEnv:C211_UNSET:dflt}/x${localWorkspaceFolder}"}';
    const plan = await planOf(
      ['proj'],
      portsOf({[DEFAULT_FILE]: text}, [PLAIN], {C211_SET: 'set'}),
    );
    deepStrictEqual(
      plan.kind === 'launch' ? plan.workspacePath : plan,
      '/w/proj/set/dflt/x/work/proj',
    );
  });

  it('F-1201 AC-42: a Compose configuration without workspaceFolder opens /', async () => {
    const plan = await planOf(
      ['proj'],
      portsOf(
        {[DEFAULT_FILE]: '{"dockerComposeFile": "c.yml", "service": "app"}'},
        [PLAIN],
      ),
    );
    deepStrictEqual(plan.kind === 'launch' ? plan.workspacePath : plan, '/');
  });

  it('F-1201 AC-43: comments and trailing commas are read', async () => {
    const plan = await planOf(
      ['proj'],
      portsOf(
        {[DEFAULT_FILE]: '// a\n{ /* b */ "workspaceFolder": "/here", }'},
        [PLAIN],
      ),
    );
    deepStrictEqual(
      plan.kind === 'launch' ? plan.workspacePath : plan,
      '/here',
    );
  });

  it('F-1201 AC-34, AC-44, AC-35: each configuration that is missing, empty, no object or not valid is refused with its file named', async () => {
    const refusals = await Promise.all(
      [
        {},
        {[DEFAULT_FILE]: ''},
        {[DEFAULT_FILE]: '[1]'},
        {[DEFAULT_FILE]: '{"workspaceFolder": "/x"'},
      ].map(files => planOf(['proj'], portsOf(files, [PLAIN]))),
    );
    deepStrictEqual(
      refusals.map(each =>
        each.kind === 'refused' ? each.message : each.kind,
      ),
      [
        '/work/proj has no dev container configuration file',
        `${DEFAULT_FILE} holds no configuration`,
        `${DEFAULT_FILE} holds no configuration`,
        `${DEFAULT_FILE} is not valid JSON with comments`,
      ],
    );
  });

  it('F-1201 AC-34: --config names the file the plan carries, and a file that cannot be read is refused', async () => {
    const other = '/work/other.json';
    deepStrictEqual(
      await Promise.all([
        planOf(
          ['proj', '--config', 'other.json'],
          portsOf({[other]: '{}'}, [PLAIN]),
        ),
        planOf(['proj', '--config', 'other.json'], portsOf({}, [PLAIN])),
      ]),
      [
        {
          kind: 'launch',
          folder: PLAIN,
          configFile: other,
          workspacePath: '/workspaces/proj',
        },
        {
          kind: 'refused',
          message: `${other} cannot be read`,
        },
      ],
    );
  });

  it('F-1201 AC-35, AC-48: a path that is not there, a file that is no workspace file and a workspace file are told apart; a workspace file means its folder', async () => {
    const files = {
      [DEFAULT_FILE]: '{}',
      [`${PLAIN}/proj.code-workspace`]: '{}',
      [`${PLAIN}/notes.txt`]: 'x',
    };
    const ports = portsOf(files, [PLAIN]);
    const results = await Promise.all(
      ['nowhere', 'proj/notes.txt', 'proj/proj.code-workspace'].map(argument =>
        planOf([argument], ports),
      ),
    );
    deepStrictEqual(results, [
      {kind: 'refused', message: '/work/nowhere does not exist'},
      {
        kind: 'refused',
        message:
          '/work/proj/notes.txt is neither a folder nor a .code-workspace file',
      },
      {
        kind: 'launch',
        folder: PLAIN,
        configFile: undefined,
        workspacePath: '/workspaces/proj',
      },
    ]);
  });

  it('F-1201 AC-34: a configuration that exists as a file but cannot be read is refused', async () => {
    const ports: OpenPorts = {
      ...portsOf({[DEFAULT_FILE]: '{}'}, [PLAIN]),
      readText: () => Promise.resolve(undefined),
    };
    deepStrictEqual(await planOf(['proj'], ports), {
      kind: 'refused',
      message: `${DEFAULT_FILE} cannot be read`,
    });
  });
});

describe('the address devcontainer open hands the editor (card containers-211)', () => {
  function plan(override: Partial<OpenPlan>): OpenPlan {
    return {
      kind: 'launch',
      folder: '/work/sp ace',
      configFile: undefined,
      workspacePath: '/workspaces/sp ace',
      ...override,
    };
  }
  function hexOf(address: string): string {
    return /dev-container%2B([0-9a-f]+)\//.exec(address)?.[1] ?? '';
  }

  it('F-1201 AC-32, AC-46, BR-17: without --config the authority’s hex is the folder as it is, and the path is percent-encoded', () => {
    const address = openAddressOf(plan({}));
    deepStrictEqual(
      [
        address.startsWith('vscode-remote://dev-container%2B'),
        Buffer.from(hexOf(address), 'hex').toString('utf8'),
        address.endsWith('/workspaces/sp%20ace'),
      ],
      [true, '/work/sp ace', true],
    );
  });

  it('F-1201 AC-34, BR-17: with --config the hex is the compact JSON of the folder and the file, and the connector reads it as a local folder target', () => {
    const address = openAddressOf(plan({configFile: '/work/c.json'}));
    const text = Buffer.from(hexOf(address), 'hex').toString('utf8');
    deepStrictEqual(
      [text, devContainerTargetOf(hexOf(address))],
      [
        '{"hostPath":"/work/sp ace","configFile":{"$mid":1,"path":"/work/c.json","scheme":"file"}}',
        {
          kind: 'folder',
          hostPath: '/work/sp ace',
          localDocker: false,
          configFile: {$mid: 1, path: '/work/c.json', scheme: 'file'},
        },
      ],
    );
  });

  it('F-1201 AC-42, AC-46: the root path is a slash, and $ and quotes are encoded', () => {
    deepStrictEqual(
      [
        openAddressOf(plan({workspacePath: '/'})).endsWith('/'),
        openAddressOf(plan({workspacePath: "/workspaces/d$'q"})).endsWith(
          "/workspaces/d%24'q",
        ),
      ],
      [true, true],
    );
  });
});

describe('the environment of the editor devcontainer open starts (card containers-211)', () => {
  it('F-1201 AC-36, BR-16: the Node mode and every variable of a window are left out, the rest stays', () => {
    deepStrictEqual(
      editorEnvironmentOf({
        ELECTRON_RUN_AS_NODE: '1',
        VSCODE_IPC_HOOK_CLI: '/tmp/hook',
        VSCODE_PID: '4',
        PATH: '/bin',
        HOME: '/home/u',
      }),
      {PATH: '/bin', HOME: '/home/u'},
    );
  });
});
