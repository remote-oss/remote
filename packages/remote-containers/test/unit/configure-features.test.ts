import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type ChosenConfiguration,
  configureFeaturesOf,
  type ConfigureFeaturesPorts,
  type FeaturesOutcome,
  onDisk,
  rootPathOf,
  type WindowFolder,
} from '../../src/authoring/configure-features.ts';
import type {PickerAnswer} from '../../src/config/choose-configuration.ts';
import type {Candidate} from '../../src/config/discovery.ts';
import {filesOf} from './authoring-files.fixture.ts';

const LOCAL: WindowFolder = {scheme: 'file', fsPath: '/w/p', path: '/w/p'};
const VIRTUAL: WindowFolder = {scheme: 'memfs', fsPath: '/v', path: '/v'};
const REMOTE: WindowFolder = {
  scheme: 'vscode-remote',
  fsPath: '/remote/p',
  path: '/remote/p',
};

interface Scene {
  calls: string[];
  chosen: ChosenConfiguration[];
  ports: ConfigureFeaturesPorts;
}

/** The command over a window with `folders`, whose file system holds `contents`, with the answers of the user. */
function sceneOf(
  folders: readonly WindowFolder[],
  contents: Record<string, string>,
  answers: {
    modal?: string;
    pick?: PickerAnswer;
    error?: string;
    remoteName?: string;
    stored?: Candidate;
    mirrored?: Candidate[];
    stray?: Record<string, string>;
  } = {},
): Scene {
  const calls: string[] = [];
  const chosen: ChosenConfiguration[] = [];
  const sink = new MemorySink();
  const files = filesOf(contents);
  const host = filesOf(answers.stray ?? {});
  return {
    calls,
    chosen,
    ports: {
      window: {folders: () => folders, remoteName: () => answers.remoteName},
      filesOf: () => files,
      hostFiles: host,
      compare: (left, right) => left.localeCompare(right),
      ...(answers.stored === undefined
        ? {}
        : {stored: () => Promise.resolve(answers.stored)}),
      ...(answers.mirrored === undefined
        ? {}
        : {mirrored: () => Promise.resolve(answers.mirrored ?? [])}),
      surfaces: {
        pick: (rows, placeholder) => {
          calls.push(
            `pick ${placeholder}: ${rows.map(entry => `${entry.label} (${entry.description})`).join(', ')}`,
          );
          return Promise.resolve(answers.pick ?? {kind: 'dismissed'});
        },
        openPreview: file => {
          calls.push(`preview ${file}`);
          return Promise.resolve();
        },
        showModal: (detail, buttons) => {
          calls.push(`modal ${detail} [${buttons.join('|')}]`);
          return Promise.resolve(answers.modal);
        },
        showError: (message, detail, items) => {
          calls.push(`error ${message}|${detail} [${items.join('|')}]`);
          return Promise.resolve(answers.error);
        },
        revealLog: () => {
          calls.push('log');
        },
      },
      addFiles: () => {
        calls.push('addFiles');
        return Promise.resolve();
      },
      features: configuration => {
        chosen.push(configuration);
        return Promise.resolve({kind: 'written', file: configuration.file});
      },
      translate: template => template,
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
  };
}

/** Runs the command of `scene`. */
async function runCommand(scene: Scene): Promise<FeaturesOutcome | undefined> {
  return configureFeaturesOf(scene.ports)();
}

const MAIN = '/w/p/.devcontainer/devcontainer.json';

describe('the Configure Container Features command: its file (card containers-150, F-0807)', () => {
  it('tells roots on a disk from virtual ones, and gives a folder’s path in its own file system', () => {
    deepStrictEqual(
      [LOCAL, VIRTUAL, REMOTE].map(folder => [
        onDisk(folder),
        rootPathOf(folder),
      ]),
      [
        [true, '/w/p'],
        [false, '/v'],
        [true, '/remote/p'],
      ],
    );
  });

  it('F-0807 7.E1, AC-6: with no configuration it shows the modal with Add Files..., and Cancel does nothing more', async () => {
    const scene = sceneOf([LOCAL], {});
    deepStrictEqual(
      [await runCommand(scene), scene.calls],
      [
        {kind: 'cancelled'},
        ['modal No container configuration file found. [Add Files...]'],
      ],
    );
  });

  it('F-0807 AC-8: Add Files... hands over to the wizard that adds the files', async () => {
    const scene = sceneOf([LOCAL], {}, {modal: 'Add Files...'});
    deepStrictEqual(
      [await runCommand(scene), scene.calls.slice(1)],
      [{kind: 'adding'}, ['addFiles']],
    );
  });

  it('F-0807 AC-47: an empty window gets the same modal', async () => {
    const scene = sceneOf([], {});
    await runCommand(scene);
    deepStrictEqual(scene.calls, [
      'modal No container configuration file found. [Add Files...]',
    ]);
  });

  it('F-0807 AC-65, BR-20: a file two levels below .devcontainer is no configuration', async () => {
    const scene = sceneOf([LOCAL], {
      '/w/p/.devcontainer/a/b/devcontainer.json': '{}',
    });
    await runCommand(scene);
    deepStrictEqual(scene.calls, [
      'modal No container configuration file found. [Add Files...]',
    ]);
  });

  it('F-0807 AC-64, BR-20: a file one level below .devcontainer is the configuration, with no selector', async () => {
    const file = '/w/p/.devcontainer/a/devcontainer.json';
    const scene = sceneOf([LOCAL], {[file]: '{"image": "x"}'});
    await runCommand(scene);
    deepStrictEqual(
      [scene.calls, scene.chosen.map(each => [each.file, each.text])],
      [[], [[file, '{"image": "x"}']]],
    );
  });

  it('F-0807 AC-38, BR-14: a root dotfile is the configuration', async () => {
    const file = '/w/p/.devcontainer.json';
    const scene = sceneOf([LOCAL], {[file]: '{}'});
    await runCommand(scene);
    deepStrictEqual(
      scene.chosen.map(each => each.file),
      [file],
    );
  });

  it('F-0807 AC-24, AC-39: several configurations are picked among with the dotfile first, and Escape ends the run', async () => {
    const scene = sceneOf([LOCAL], {
      '/w/p/.devcontainer.json': '{}',
      [MAIN]: '{"name": "Main one"}',
      '/w/p/.devcontainer/a/devcontainer.json': '{}',
    });
    deepStrictEqual(
      [await runCommand(scene), scene.calls, scene.chosen],
      [
        {kind: 'cancelled'},
        [
          'pick Select a devcontainer.json file.: Project Root (.devcontainer.json), Main one (.devcontainer/devcontainer.json), a (.devcontainer/a/devcontainer.json)',
        ],
        [],
      ],
    );
  });

  it('F-0807 AC-24: the file the user picks is the one used, and Open File opens it and ends the run', async () => {
    const contents = {
      '/w/p/.devcontainer.json': '{"a": 1}',
      [MAIN]: '{"b": 2}',
    };
    const picked = sceneOf([LOCAL], contents, {
      pick: {kind: 'picked', index: 1},
    });
    await runCommand(picked);
    const opened = sceneOf([LOCAL], contents, {
      pick: {kind: 'openFile', index: 1},
    });
    const outcome = await runCommand(opened);
    deepStrictEqual(
      [
        picked.chosen.map(each => each.file),
        outcome,
        opened.calls.slice(1),
        opened.chosen,
      ],
      [[MAIN], {kind: 'cancelled'}, [`preview ${MAIN}`], []],
    );
  });

  it('F-0807 AC-42, BR-16: a configuration only in the store of user data is the one used, read from this machine', async () => {
    const file = '/g/store/slot/.devcontainer/devcontainer.json';
    const scene = sceneOf(
      [LOCAL],
      {},
      {
        stored: {
          file,
          relative: '~/store',
          place: {kind: 'stored', slot: 'slot'},
        },
        stray: {[file]: '{"stored": true}'},
      },
    );
    await runCommand(scene);
    deepStrictEqual(
      scene.chosen.map(each => [each.file, each.text]),
      [[file, '{"stored": true}']],
    );
  });

  it('F-0807 BR-16: a remote window does not look in the store of user data', async () => {
    const file = '/g/store/slot/.devcontainer/devcontainer.json';
    const scene = sceneOf(
      [REMOTE],
      {},
      {
        remoteName: 'ssh-remote',
        stored: {
          file,
          relative: '~/store',
          place: {kind: 'stored', slot: 'slot'},
        },
        stray: {[file]: '{}'},
      },
    );
    await runCommand(scene);
    deepStrictEqual(scene.chosen, []);
  });

  const MIRRORED = '/roots/one/github.com/o/n/.devcontainer/devcontainer.json';

  it('F-0807 AC-66, AC-67, BR-21: a configuration only under a root of repositoryConfigurationPaths is the one used, read from this machine, with no modal', async () => {
    const scene = sceneOf(
      [LOCAL],
      {},
      {
        mirrored: [{file: MIRRORED, relative: MIRRORED, place: {kind: 'main'}}],
        stray: {[MIRRORED]: '{"mirrored": true}'},
      },
    );
    await runCommand(scene);
    deepStrictEqual(
      [scene.chosen.map(each => [each.file, each.text]), scene.calls],
      [[[MIRRORED, '{"mirrored": true}']], []],
    );
  });

  it('F-0807 AC-68, BR-21: a mirrored file beside the folder’s own gives the pick, the mirrored one first with its path and the folder’s own with its relative path; the one picked is the one written', async () => {
    const scene = sceneOf(
      [LOCAL],
      {[MAIN]: '{"own": true}'},
      {
        mirrored: [{file: MIRRORED, relative: MIRRORED, place: {kind: 'main'}}],
        stray: {[MIRRORED]: '{"mirrored": true}'},
        pick: {kind: 'picked', index: 1},
      },
    );
    await runCommand(scene);
    deepStrictEqual(
      [scene.calls[0], scene.chosen.map(each => each.file)],
      [
        `pick Select a devcontainer.json file.: Main (${MIRRORED}), Main (.devcontainer/devcontainer.json)`,
        [MAIN],
      ],
    );
  });

  it('F-0302 BR-12: a window of several folders, and a remote window, look up no mirrored file', async () => {
    const asked: string[] = [];
    const mirrored = [
      {file: MIRRORED, relative: MIRRORED, place: {kind: 'main' as const}},
    ];
    const several = sceneOf(
      [LOCAL, {...LOCAL, fsPath: '/w/q', path: '/w/q'}],
      {},
      {mirrored, stray: {[MIRRORED]: '{}'}},
    );
    const remote = sceneOf(
      [REMOTE],
      {},
      {remoteName: 'ssh-remote', mirrored, stray: {[MIRRORED]: '{}'}},
    );
    for (const scene of [several, remote]) {
      await runCommand(scene);
      asked.push(...scene.chosen.map(each => each.file));
    }
    deepStrictEqual(asked, []);
  });

  it('F-0807 AC-58, AC-60, BR-19: a configuration only on a virtual root is never read: the modal shows', async () => {
    const scene = sceneOf([VIRTUAL], {
      '/v/.devcontainer/devcontainer.json': '{}',
    });
    await runCommand(scene);
    deepStrictEqual(
      [scene.calls, scene.chosen],
      [['modal No container configuration file found. [Add Files...]'], []],
    );
  });

  it('F-0807 AC-59: with a disk root that has one and a virtual root, the disk root’s file is the one used', async () => {
    const scene = sceneOf([LOCAL, VIRTUAL], {[MAIN]: '{}'});
    await runCommand(scene);
    deepStrictEqual(
      scene.chosen.map(each => each.file),
      [MAIN],
    );
  });

  it('F-0807 AC-53, 7.E4: a file that is not JSON gives the error dialog, opens the file and goes no further', async () => {
    const scene = sceneOf([LOCAL], {[MAIN]: 'this is not json'});
    deepStrictEqual(
      [await runCommand(scene), scene.calls, scene.chosen],
      [
        {kind: 'failed', detail: 'the configuration cannot be read'},
        [
          `preview ${MAIN}`,
          "error |Failed to read Dev Container configuration '.devcontainer/devcontainer.json' file. [Show Log]",
        ],
        [],
      ],
    );
  });

  it('F-0807 7.E4: Show Log on that dialog reveals the log', async () => {
    const scene = sceneOf([LOCAL], {[MAIN]: '[1]'}, {error: 'Show Log'});
    await runCommand(scene);
    deepStrictEqual(scene.calls.at(-1), 'log');
  });

  it('F-0807: a file that cannot be read is told as one that is not JSON', async () => {
    const scene = sceneOf([LOCAL], {});
    scene.ports.filesOf = () => ({
      ...filesOf({[MAIN]: '{}'}),
      read: () => Promise.reject(new Error('denied')),
    });
    const outcome = await runCommand(scene);
    deepStrictEqual(outcome?.kind, 'failed');
  });

  it('F-0807 AC-24: a file the pick cannot read is listed under the name of its place', async () => {
    const scene = sceneOf([LOCAL], {
      '/w/p/.devcontainer.json': '{}',
      [MAIN]: '{}',
    });
    scene.ports.filesOf = () => ({
      ...filesOf({'/w/p/.devcontainer.json': '{}', [MAIN]: '{}'}),
      read: () => Promise.reject(new Error('denied')),
    });
    await runCommand(scene);
    deepStrictEqual(scene.calls, [
      'pick Select a devcontainer.json file.: Project Root (.devcontainer.json), Main (.devcontainer/devcontainer.json)',
    ]);
  });

  it('F-0807 AC-2: a window of a host reads the files of its own root', async () => {
    const file = '/remote/p/.devcontainer/devcontainer.json';
    const scene = sceneOf([REMOTE], {[file]: '{}'}, {remoteName: 'ssh-remote'});
    await runCommand(scene);
    deepStrictEqual(
      scene.chosen.map(each => each.file),
      [file],
    );
  });

  it('a call made while another runs returns at once', async () => {
    const scene = sceneOf([LOCAL], {[MAIN]: '{}'});
    let release: ((value: FeaturesOutcome) => void) | undefined;
    function waiting(): Promise<FeaturesOutcome> {
      return new Promise<FeaturesOutcome>(resolve => {
        release = resolve;
      });
    }
    scene.ports.features = waiting;
    const command = configureFeaturesOf(scene.ports);
    const first = command();
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await command();
    release?.({kind: 'unchanged'});
    deepStrictEqual([second, await first], [undefined, {kind: 'unchanged'}]);
  });
});
