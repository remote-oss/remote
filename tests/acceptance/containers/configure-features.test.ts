/**
 * @fileoverview Configure Container Features up to the pick (card containers-150, part B): where the command is offered,
 * which configuration file it works on, and what it says when there is none or the file cannot be read.
 */

import {deepStrictEqual} from 'node:assert';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  activeEditorTextOf,
  closeWindow,
  inWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  openMemoryWindow,
  openWorkspaceWindow,
  writeMemoryFile,
} from '../windows/folder-windows.ts';
import {
  acceptQuickPick,
  answerDialog,
  detailedQuickPickRows,
  dialogOf,
  editorTabs,
  paletteRows,
  pressEscape,
  pressQuickPickTitleButton,
  quickPickFacts,
  quickPickRows,
  rememberPage,
  toggleQuickPickRow,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  FEATURES_PLACEHOLDER,
  screenWith,
  storeRoot,
} from '../windows/authoring-support.ts';

const COMMAND = 'remote-containers.configureContainerFeatures';
const TITLE = 'Dev Containers: Configure Container Features...';
const NO_FILE = 'No container configuration file found.';

/** A folder of the run named `label` with the files `contents` by relative path. */
function folderWith(
  label: string,
  contents: Readonly<Record<string, string>> = {},
): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  mkdirSync(folder, {recursive: true});
  for (const [relative, text] of Object.entries(contents)) {
    const file = path.join(folder, relative);
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, text);
  }
  return folder;
}

/** The files below `folder` by relative path with their text, for comparing a folder before and after. */
function treeOf(folder: string): Record<string, string> {
  const tree: Record<string, string> = {};
  function walk(current: string): void {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        tree[`${path.relative(folder, full)}/`] = '';
        walk(full);
      } else {
        tree[path.relative(folder, full)] = readFileSync(full, 'utf8');
      }
    }
  }
  walk(folder);
  return tree;
}

/** Runs the command in window `name` without waiting: its dialogs and picks answer it. */
function startCommand(name: string): void {
  inWindow(name, COMMAND).catch(() => undefined);
}

/** A `.code-workspace` file of the run named `label` listing `folders`. */
function workspaceFile(label: string, folders: readonly object[]): string {
  const file = path.join(
    variable('HARNESS_RUN_FOLDER'),
    `${label}.code-workspace`,
  );
  writeFileSync(file, JSON.stringify({folders}));
  return file;
}

describe('Configure Container Features: its file (card containers-150, part B)', function () {
  this.timeout(600_000);

  it('F-0807 AC-1, AC-3, AC-4 (c150-offered): the Command Palette offers the command in a window with a folder and in a workspace with a disk root and a virtual one, and not where every root is virtual', async () => {
    const folder = folderWith('c150-offered');
    const local = await openFolderWindow(folder);
    const memory = await openMemoryWindow();
    const mixedFile = workspaceFile('c150-offered-mixed', [
      {path: folder},
      {uri: 'memfs:/'},
    ]);
    try {
      const inFolder = await paletteRows(local, 'Configure Container Features');
      await closeWindow(memory).catch(() => undefined);
      const virtualOnly = await openMemoryWindow();
      const inVirtual = await paletteRows(
        virtualOnly,
        'Configure Container Features',
      );
      await closeWindow(virtualOnly).catch(() => undefined);
      const mixed = await openWorkspaceWindow(mixedFile);
      const inMixed = await paletteRows(mixed, 'Configure Container Features');
      await closeWindow(mixed).catch(() => undefined);
      deepStrictEqual(
        [
          inFolder.includes(TITLE),
          inVirtual.includes(TITLE),
          inMixed.includes(TITLE),
        ],
        [true, false, true],
      );
    } finally {
      await closeWindow(local).catch(() => undefined);
    }
  });

  it('F-0807 AC-6, AC-7, AC-8 (c150-no-file): with no configuration file a modal says so with Cancel and Add Files..., Cancel creates nothing, and Add Files... opens the pick of where to add them', async () => {
    const folder = folderWith('c150-no-file', {'README.md': 'x\n'});
    const before = treeOf(folder);
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      const dialog = await waitForDialog(window, 60_000);
      await answerDialog(window, 'Cancel');
      const afterCancel = treeOf(folder);
      startCommand(window);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Add Files...');
      await waitFor(
        'the pick of where to add the files',
        async () =>
          (await quickPickFacts(window))?.title ===
          'Add Dev Container Configuration Files',
        60_000,
      );
      const rows = (await quickPickRows(window)).map(each => each.label);
      await pressEscape(window);
      deepStrictEqual(
        {
          detail: dialog.details,
          buttons: dialog.buttons,
          afterCancel,
          rows,
        },
        {
          detail: NO_FILE,
          buttons: ['Cancel', 'Add Files...'],
          afterCancel: before,
          rows: [
            'Add configuration to workspace',
            'Add configuration to user data folder',
          ],
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-47 (c150-empty-window): an empty window gets the same modal', async () => {
    startCommand('local');
    const dialog = await waitForDialog('local', 60_000);
    await answerDialog('local', 'Cancel');
    deepStrictEqual(
      [dialog.details, dialog.buttons],
      [NO_FILE, ['Cancel', 'Add Files...']],
    );
  });

  it('F-0807 AC-65 (c150-too-deep): a configuration two levels below .devcontainer is no configuration: the modal shows', async () => {
    const folder = folderWith('c150-too-deep', {
      '.devcontainer/a/b/devcontainer.json': '{"image": "x"}\n',
    });
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      const dialog = await waitForDialog(window, 60_000);
      await answerDialog(window, 'Cancel');
      deepStrictEqual(dialog.details, NO_FILE);
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-24, AC-29, AC-39 (c150-selector): with several configuration files a pick lists the dotfile first with an Open File button on each, and Escape writes nothing and opens no other pick', async () => {
    const folder = folderWith('c150-selector', {
      '.devcontainer.json': '{"image": "x"}\n',
      '.devcontainer/devcontainer.json': '{"name": "Main one"}\n',
      '.devcontainer/a/devcontainer.json': '{"image": "y"}\n',
    });
    const before = treeOf(folder);
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      await waitFor(
        'the pick of the configuration file',
        async () =>
          (await quickPickFacts(window))?.placeholder ===
          'Select a devcontainer.json file.',
        60_000,
      );
      const rows = (await detailedQuickPickRows(window)).map(each => [
        each.label,
        each.description,
        each.buttons,
      ]);
      await pressEscape(window);
      await new Promise(resolve => setTimeout(resolve, 3000));
      deepStrictEqual(
        {
          rows,
          afterEscape: await quickPickFacts(window),
          dialog: await dialogOf(window),
          tree: treeOf(folder),
        },
        {
          rows: [
            ['Project Root', '.devcontainer.json', ['Open File']],
            ['Main one', '.devcontainer/devcontainer.json', ['Open File']],
            ['a', '.devcontainer/a/devcontainer.json', ['Open File']],
          ],
          afterEscape: undefined,
          dialog: undefined,
          tree: before,
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-53 (c150-not-json): a configuration file that is not JSON gives an error dialog, opens no pick and stays as it was', async () => {
    const folder = folderWith('c150-not-json', {
      '.devcontainer/devcontainer.json': 'this is not json\n',
    });
    const before = treeOf(folder);
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      const dialog = await waitForDialog(window, 60_000);
      await answerDialog(window, dialog.buttons[0] ?? 'Cancel');
      deepStrictEqual(
        {
          detail: dialog.details,
          picker: await quickPickFacts(window),
          tree: treeOf(folder),
          created: existsSync(path.join(folder, '.devcontainer.json')),
        },
        {
          detail:
            "Failed to read Dev Container configuration '.devcontainer/devcontainer.json' file.",
          picker: undefined,
          tree: before,
          created: false,
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-58, AC-60 (c150-mixed-virtual): in a workspace of a disk root and a virtual root, a configuration only on the virtual root is never used: the modal shows and neither root is changed', async () => {
    const folder = folderWith('c150-mixed-virtual', {'README.md': 'x\n'});
    const before = treeOf(folder);
    const file = workspaceFile('c150-mixed-virtual', [
      {path: folder},
      {uri: 'memfs:/'},
    ]);
    const window = await openWorkspaceWindow(file);
    await rememberPage(window);
    try {
      await writeMemoryFile(
        window,
        '/.devcontainer/devcontainer.json',
        '{"image": "x"}\n',
      );
      startCommand(window);
      const dialog = await waitForDialog(window, 60_000);
      await answerDialog(window, 'Cancel');
      await inWindow(
        window,
        'acceptance.agent.openUri',
        'memfs:/.devcontainer/devcontainer.json',
      );
      deepStrictEqual(
        [
          dialog.details,
          treeOf(folder),
          await quickPickFacts(window),
          await activeEditorTextOf(window),
        ],
        [NO_FILE, before, undefined, '{"image": "x"}\n'],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-61, AC-62 (ruling-1971-workspace-check): in a saved workspace with a virtual root and no configuration, Add Files... asks whether to go on with the problem of the workspace file, Cancel creates nothing and Continue goes to the where-to step', async () => {
    const folder = folderWith('c150-mixed-add', {'README.md': 'x\n'});
    const before = treeOf(folder);
    const file = workspaceFile('c150-mixed-add', [
      {path: path.basename(folder)},
      {uri: 'memfs:/'},
    ]);
    const window = await openWorkspaceWindow(file);
    await rememberPage(window);
    try {
      startCommand(window);
      const modal = await waitForDialog(window, 60_000);
      await answerDialog(window, 'Add Files...');
      const problem = await waitForDialog(window, 60_000);
      await answerDialog(window, 'Cancel');
      const afterCancel = treeOf(folder);
      startCommand(window);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Add Files...');
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Continue');
      await waitFor(
        'the where-to step',
        async () => (await quickPickFacts(window)) !== undefined,
        60_000,
      );
      const facts = await quickPickFacts(window);
      await pressEscape(window);
      deepStrictEqual(
        {
          modal: modal.details,
          problem: problem.details,
          buttons: problem.buttons,
          afterCancel,
          where: facts?.placeholder,
        },
        {
          modal: NO_FILE,
          problem:
            "The workspace could fail to open in a container: Workspace contains folder 'memfs:/' not on the local file system.",
          buttons: ['Cancel', 'Continue'],
          afterCancel: before,
          where: 'Where would you like to create your container configuration?',
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-59 (c150-mixed-disk): in a workspace of a disk root that has a configuration and a virtual root that has none, the pick opens on the disk root’s file', async () => {
    const folder = folderWith('c150-mixed-disk', {
      '.devcontainer/devcontainer.json': '{"image": "x"}\n',
    });
    const before = treeOf(folder);
    const file = workspaceFile('c150-mixed-disk', [
      {path: path.basename(folder)},
      {uri: 'memfs:/'},
    ]);
    const window = await openWorkspaceWindow(file);
    await rememberPage(window);
    try {
      startCommand(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      const title = (await quickPickFacts(window))?.title;
      await pressEscape(window);
      deepStrictEqual([title, treeOf(folder)], ['Select Features', before]);
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it("F-0807 AC-52 (c150-dockerfile): with a Dockerfile and no configuration, Add Files... then the workspace row lists From 'Dockerfile' with the line that refers to the existing one", async () => {
    const folder = folderWith('c150-dockerfile', {
      Dockerfile: `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`,
    });
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Add Files...');
      await waitFor(
        'the pick of where to add the files',
        async () =>
          (await quickPickFacts(window))?.title ===
          'Add Dev Container Configuration Files',
        60_000,
      );
      await acceptQuickPick(window);
      await waitFor(
        'the pick of what the configuration starts from',
        async () =>
          (await detailedQuickPickRows(window)).some(
            each => each.label === "From 'Dockerfile'",
          ),
        60_000,
      );
      const dockerfileRow = (await detailedQuickPickRows(window)).find(
        each => each.label === "From 'Dockerfile'",
      );
      await pressEscape(window);
      deepStrictEqual(
        dockerfileRow?.detail,
        "Refer to the existing 'Dockerfile' in the container configuration",
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  /** The Feature of the run's index the rows check, and the key it is written under. */
  const GIT_FEATURE = 'Git (from source)';

  /** The keys of `"features"` in the JSON file `file`, each as its last path segment. */
  function featureNames(file: string): string[] {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      features?: Record<string, unknown>;
    };
    return Object.keys(parsed.features ?? {}).map(
      key => key.split('/').slice(-1)[0] ?? key,
    );
  }

  it('F-0807 AC-9, AC-13, AC-38 (c150-dotfile): with a root dotfile as the only configuration the pick opens at once with Finish and no Back, Finish rewrites the dotfile in place, creates no .devcontainer, and opens it as a preview', async () => {
    const folder = folderWith('c150-dotfile', {
      '.devcontainer.json': '{\n    "image": "x"\n}\n',
    });
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      const facts = await quickPickFacts(window);
      await toggleQuickPickRow(window, GIT_FEATURE);
      await pressQuickPickTitleButton(window, 'Finish');
      await waitFor(
        'the dotfile to gain the Feature',
        () => featureNames(path.join(folder, '.devcontainer.json')).length > 0,
        60_000,
      );
      await new Promise(resolve => setTimeout(resolve, 2000));
      const tabs = await editorTabs(window);
      deepStrictEqual(
        {
          title: facts?.title,
          buttons: facts?.titleButtons,
          names: featureNames(path.join(folder, '.devcontainer.json')),
          folderCreated: existsSync(path.join(folder, '.devcontainer')),
          text: readFileSync(path.join(folder, '.devcontainer.json'), 'utf8')
            .split('\n')
            .slice(0, 3),
          activeTab: tabs.find(each => each.active),
        },
        {
          title: 'Select Features',
          buttons: ['Finish'],
          names: ['git:1'],
          folderCreated: false,
          text: ['{', '    "image": "x",', '    "features": {'],
          activeTab: {
            label: '.devcontainer',
            active: true,
            preview: true,
            dirty: false,
          },
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-64 (c150-nested): a configuration one level below .devcontainer is the one written, and no .devcontainer/devcontainer.json is made', async () => {
    const folder = folderWith('c150-nested', {
      '.devcontainer/a/devcontainer.json': '{"image": "x"}\n',
    });
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      await toggleQuickPickRow(window, GIT_FEATURE);
      await pressQuickPickTitleButton(window, 'Finish');
      const nested = path.join(folder, '.devcontainer/a/devcontainer.json');
      await waitFor(
        'the nested file to gain the Feature',
        () => featureNames(nested).length > 0,
        60_000,
      );
      deepStrictEqual(
        [
          featureNames(nested),
          existsSync(path.join(folder, '.devcontainer/devcontainer.json')),
          await dialogOf(window),
        ],
        [['git:1'], false, undefined],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-42 (c150-user-data): a folder with no configuration of its own and one in the user data folder opens the pick on it at once, and only that file is rewritten', async () => {
    const folder = folderWith('c150-user-data', {'README.md': 'x\n'});
    const slot = path.join(storeRoot(), 'c150-user-data', '.devcontainer');
    mkdirSync(slot, {recursive: true});
    const stored = path.join(slot, 'devcontainer.json');
    writeFileSync(stored, '{"image": "x"}\n');
    writeFileSync(
      path.join(slot, '.devcontainer-internal.json'),
      `// Maintained by the Dev Container extension\n${JSON.stringify({rootFolder: folder})}\n`,
    );
    const before = treeOf(folder);
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      await toggleQuickPickRow(window, GIT_FEATURE);
      await pressQuickPickTitleButton(window, 'Finish');
      await waitFor(
        'the stored file to gain the Feature',
        () => featureNames(stored).length > 0,
        60_000,
      );
      deepStrictEqual(
        [featureNames(stored), treeOf(folder)],
        [['git:1'], before],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      rmSync(path.dirname(slot), {recursive: true, force: true});
    }
  });

  it('F-0807 AC-56 (c150-read-only): a read-only configuration file is left as it was when Finish is pressed', async () => {
    const folder = folderWith('c150-read-only', {
      '.devcontainer/devcontainer.json': '{"image": "x"}\n',
    });
    const file = path.join(folder, '.devcontainer/devcontainer.json');
    chmodSync(file, 0o444);
    const window = await openFolderWindow(folder);
    try {
      startCommand(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      await toggleQuickPickRow(window, GIT_FEATURE);
      await pressQuickPickTitleButton(window, 'Finish');
      const dialog = await waitForDialog(window, 60_000);
      await answerDialog(window, dialog.buttons[0] ?? 'Cancel');
      deepStrictEqual(readFileSync(file, 'utf8'), '{"image": "x"}\n');
    } finally {
      await closeWindow(window).catch(() => undefined);
      chmodSync(file, 0o644);
    }
  });
});
