import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {WindowFolder} from '../../src/authoring/configure-features.ts';
import {
  addFilesForFeatures,
  type FeaturesAddFilesPorts,
} from '../../src/authoring/features-add-files.ts';

const LOCAL: WindowFolder = {scheme: 'file', fsPath: '/w/p', path: '/w/p'};
const OTHER: WindowFolder = {scheme: 'file', fsPath: '/w/q', path: '/w/q'};
const VIRTUAL: WindowFolder = {scheme: 'memfs', fsPath: '/v', path: '/v'};
const REMOTE: WindowFolder = {
  scheme: 'vscode-remote',
  fsPath: '/h/p',
  path: '/h/p',
};

/** The hand-off over fakes: what each port is asked is in `calls`. */
async function handOff(
  folders: readonly WindowFolder[],
  options: {
    remoteName?: string;
    workspaceFile?: {scheme: string; fsPath: string};
    workspaceText?: string;
    proceed?: boolean;
  } = {},
): Promise<string[]> {
  const calls: string[] = [];
  const ports: FeaturesAddFilesPorts = {
    window: {
      folders: () => folders,
      remoteName: () => options.remoteName,
      workspaceFile: () => options.workspaceFile,
    },
    informModal: text => {
      calls.push(`inform ${text}`);
      return Promise.resolve();
    },
    addConfiguration: (folder, roots) => {
      calls.push(`wizard ${folder} [${roots.join(',')}]`);
      return Promise.resolve();
    },
    addHostConfiguration: folder => {
      calls.push(`host wizard ${folder}`);
      return Promise.resolve();
    },
    readWorkspaceFile: () =>
      Promise.resolve({
        kind: 'text',
        text: options.workspaceText ?? '{"folders": [{"path": "p"}]}',
      }),
    confirmModal: text => {
      calls.push(`confirm ${text}`);
      return Promise.resolve(options.proceed ?? true);
    },
    translate: template => template,
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
  };
  await addFilesForFeatures(ports);
  return calls;
}

describe('the hand-off of Add Files... in Configure Container Features (card containers-150, F-0807)', () => {
  it('F-0807 AC-8: a local folder gets the wizard for it', async () => {
    deepStrictEqual(await handOff([LOCAL]), ['wizard /w/p []']);
  });

  it('F-0807 AC-51, 6.5 step 5: an SSH window gets the wizard on the host, with no choice of location', async () => {
    deepStrictEqual(await handOff([REMOTE], {remoteName: 'ssh-remote'}), [
      'host wizard /h/p',
    ]);
  });

  it('F-0807 AC-51: the same holds for a WSL and a tunnel window, and a window of several folders does nothing', async () => {
    deepStrictEqual(
      [
        await handOff([REMOTE], {remoteName: 'wsl'}),
        await handOff([REMOTE], {remoteName: 'tunnel'}),
        await handOff([REMOTE, REMOTE], {remoteName: 'ssh-remote'}),
      ],
      [['host wizard /h/p'], ['host wizard /h/p'], []],
    );
  });

  it('F-0807 AC-8: a dev container window gets the wizard for its folder in the container', async () => {
    deepStrictEqual(await handOff([REMOTE], {remoteName: 'dev-container'}), [
      'wizard /h/p []',
    ]);
  });

  it('F-0807 AC-50: an unsaved workspace of several folders is told to be saved first', async () => {
    deepStrictEqual(
      await handOff([LOCAL, OTHER], {
        workspaceFile: {scheme: 'untitled', fsPath: '/u/Untitled'},
      }),
      [
        'inform You need to first save your workspace in a folder containing all its workspace folders.',
      ],
    );
  });

  it('F-0807 AC-50: so is an unsaved mixed workspace', async () => {
    deepStrictEqual(
      await handOff([LOCAL, VIRTUAL], {
        workspaceFile: {scheme: 'untitled', fsPath: '/u/Untitled'},
      }),
      [
        'inform You need to first save your workspace in a folder containing all its workspace folders.',
      ],
    );
  });

  it('F-0807 AC-62: a saved workspace whose folder list has no problem gets the wizard beside its file, with its roots', async () => {
    deepStrictEqual(
      await handOff([LOCAL, OTHER], {
        workspaceFile: {scheme: 'file', fsPath: '/w/a.code-workspace'},
        workspaceText: '{"folders": [{"path": "p"}, {"path": "q"}]}',
      }),
      ['wizard /w [/w/p,/w/q]'],
    );
  });

  it('F-0807 AC-62: a saved workspace with a problem asks first, and Cancel creates nothing', async () => {
    deepStrictEqual(
      await handOff([LOCAL, VIRTUAL], {
        workspaceFile: {scheme: 'file', fsPath: '/w/a.code-workspace'},
        workspaceText: '{"folders": [{"path": "p"}, {"uri": "memfs:/v"}]}',
        proceed: false,
      }),
      [
        "confirm The workspace could fail to open in a container: Workspace contains folder 'memfs:/v' not on the local file system.",
      ],
    );
  });

  it('F-0807 AC-62: Continue goes on to the wizard', async () => {
    const calls = await handOff([LOCAL, VIRTUAL], {
      workspaceFile: {scheme: 'file', fsPath: '/w/a.code-workspace'},
      workspaceText: '{"folders": [{"path": "p"}, {"uri": "memfs:/v"}]}',
    });
    deepStrictEqual(calls.at(-1), 'wizard /w [/w/p]');
  });

  it('F-0807 AC-47: a window with no folder does nothing here', async () => {
    deepStrictEqual(await handOff([]), []);
  });

  it('F-0807: a single virtual folder gets no wizard', async () => {
    deepStrictEqual(await handOff([VIRTUAL]), []);
  });
});
