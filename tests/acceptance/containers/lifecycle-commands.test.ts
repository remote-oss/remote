import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  reopenStarted,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  type ShownDialog,
  statusItem,
  waitForDialog,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  containerOf,
  inWorkspace,
  labelsOf,
  mark,
  ORDER_FILE,
  untilLabels,
  workspaceOf,
} from './lifecycle-support.ts';

const execFileAsync = promisify(execFile);

/** The string of the editor's table that the failed-setup dialog shows, and F-0410's three buttons, sorted. */
const S034 = 'An error occurred setting up the container.';
const RECOVERY_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Retry',
];

/** How long a connect that ends in a dialog takes. */
const DIALOG_MILLISECONDS = 180_000;

/** How long a dialog left alone is watched (the same wait as F-0410 AC-2's row). */
const IDLE_MILLISECONDS = 35_000;

/** A dialog's details and sorted buttons. */
function sayingAndButtons(dialog: ShownDialog): {
  details: string;
  buttons: string[];
} {
  return {details: dialog.details, buttons: [...dialog.buttons].sort()};
}

/** Opens `folder`, starts Reopen in Container, and gives the window's name and the dialog that ends the connect. */
async function failedConnect(
  folder: string,
): Promise<{name: string; dialog: ShownDialog}> {
  const name = await openFolderWindow(folder);
  await reopenStarted(name);
  return {name, dialog: await waitForDialog(name, DIALOG_MILLISECONDS)};
}

/** Runs `docker` with `programArguments` and gives its trimmed standard output. */
async function docker(...programArguments: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', programArguments);
  return stdout.trim();
}

/** The text of `fileName` in `folder` on the host, or an empty string when the command has not written it. */
function hostFile(folder: string, fileName: string): string {
  try {
    return readFileSync(path.join(folder, fileName), 'utf8');
  } catch {
    return '';
  }
}

describe('F-0415 the command forms, the failures and the metadata (card containers-44)', function () {
  this.timeout(900_000);

  it('F-0415 AC-1 (c1): initializeCommand in its string, array and object forms runs on the host in the local folder, under the host’s name and user', async () => {
    const whoCommand = 'echo "$(hostname) $(id -un)" > init-who';
    const forms: Array<[string, unknown]> = [
      ['c44-init-string', whoCommand],
      ['c44-init-array', ['sh', '-c', whoCommand]],
      ['c44-init-object', {first: whoCommand}],
    ];
    const seen: string[] = [];
    for (const [folderName, command] of forms) {
      const folder = devContainerFolder(folderName, {
        name: folderName,
        initializeCommand: command,
      });
      try {
        const name = await openFolderWindow(folder);
        await reopenInContainer(name);
        seen.push(hostFile(folder, 'init-who').trim());
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    }
    const expected = `${os.hostname()} ${os.userInfo().username}`;
    deepStrictEqual(seen, [expected, expected, expected]);
  });

  it('F-0415 AC-10 (c10): Rebuild Container runs all six commands again on the new container', async () => {
    const folder = devContainerFolder('c44-rebuild-all', {
      name: 'Rebuild All',
      initializeCommand: 'echo init >> init-count',
      onCreateCommand: mark('onCreate'),
      updateContentCommand: mark('updateContent'),
      postCreateCommand: mark('postCreate'),
      postStartCommand: mark('postStart'),
      postAttachCommand: mark('postAttach'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const first = await containerOf(folder);
      await untilLabels(first, folder, ['postAttach']);
      await reopenInContainer(
        name,
        300_000,
        'remote-containers.rebuildContainer',
      );
      const second = await containerOf(folder);
      await waitFor(
        'the second run of the commands',
        async () => (await labelsOf(second, folder)).length >= 10,
        120_000,
      );
      const labels = await labelsOf(second, folder);
      await closeWindow(name);
      const hookNames = [
        'onCreate',
        'updateContent',
        'postCreate',
        'postStart',
        'postAttach',
      ];
      deepStrictEqual(
        {
          replaced: second !== first,
          labels,
          initialized: hostFile(folder, 'init-count').split('\n').length - 1,
        },
        {replaced: true, labels: [...hookNames, ...hookNames], initialized: 2},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-13 (c13): a failing onCreateCommand under the default waitFor shows F-0410’s dialog and the window never connects', async () => {
    const folder = devContainerFolder('c44-create-fails', {
      name: 'Create Fails',
      onCreateCommand: 'exit 1',
      postCreateCommand: mark('postCreate'),
    });
    try {
      const {name, dialog} = await failedConnect(folder);
      const [containerId = ''] = await devContainersOf(folder);
      const labels = await labelsOf(containerId, folder);
      const indicator = (await statusItem(name, 'status.host')).text;
      await closeWindow(name);
      deepStrictEqual(
        {saying: sayingAndButtons(dialog), labels, indicator},
        {
          saying: {details: S034, buttons: RECOVERY_BUTTONS},
          labels: [],
          indicator: 'Opening Remote...',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-17 (c17): a failing initializeCommand creates no container, runs nothing in one, and shows the same dialog', async () => {
    const folder = devContainerFolder('c44-init-fails', {
      name: 'Init Fails',
      initializeCommand: 'exit 1',
      onCreateCommand: mark('onCreate'),
    });
    try {
      const {name, dialog} = await failedConnect(folder);
      const containers = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {saying: sayingAndButtons(dialog), containers},
        {
          saying: {details: S034, buttons: RECOVERY_BUTTONS},
          containers: [],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-18, AC-18b (c18): a failing entry lets its sibling finish, and only then shows the dialog and skips the later commands; the dialog stays', async () => {
    const folder = devContainerFolder('c44-object-fails', {
      name: 'Object Fails',
      updateContentCommand: {
        quick: 'exit 3',
        sibling: `sleep 8; ${mark('sibling-done')}`,
      },
      postCreateCommand: mark('postCreate'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenStarted(name);
      const [containerId = ''] = await (async () => {
        await waitFor(
          'the container',
          async () => (await devContainersOf(folder)).length === 1,
          DIALOG_MILLISECONDS,
        );
        return devContainersOf(folder);
      })();
      const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
      const labelsAtDialog = await labelsOf(containerId, folder);
      await new Promise(resolve => setTimeout(resolve, IDLE_MILLISECONDS));
      const stillShown = await dialogOf(name);
      const indicator = (await statusItem(name, 'status.host')).text;
      const status = await docker(
        'inspect',
        '-f',
        '{{.State.Status}}',
        containerId,
      );
      await closeWindow(name);
      deepStrictEqual(
        {
          saying: sayingAndButtons(dialog),
          labelsAtDialog,
          stillShown:
            stillShown === undefined ? undefined : sayingAndButtons(stillShown),
          indicator,
          status,
        },
        {
          saying: {details: S034, buttons: RECOVERY_BUTTONS},
          labelsAtDialog: ['sibling-done'],
          stillShown: {details: S034, buttons: RECOVERY_BUTTONS},
          indicator: 'Opening Remote...',
          status: 'running',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-19 (c19): every command starts in the workspace folder, the host one in the local folder', async () => {
    const probe = 'pwd >> .c44-pwd';
    const folder = devContainerFolder('c44-working-folder', {
      name: 'Working Folder',
      initializeCommand: 'pwd > init-pwd',
      onCreateCommand: probe,
      updateContentCommand: probe,
      postCreateCommand: probe,
      postStartCommand: probe,
      postAttachCommand: probe,
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await waitFor(
        'the five probes',
        async () =>
          (
            await inWorkspace(
              containerId,
              folder,
              'cat .c44-pwd 2>/dev/null || true',
            )
          )
            .split('\n')
            .filter(line => line !== '').length >= 5,
        120_000,
      );
      const inside = (await inWorkspace(containerId, folder, 'cat .c44-pwd'))
        .split('\n')
        .filter(line => line !== '');
      await closeWindow(name);
      deepStrictEqual(
        {host: hostFile(folder, 'init-pwd').trim(), inside},
        {
          host: folder,
          inside: Array<string>(5).fill(workspaceOf(folder)),
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-14 (c14): the label holds each in-container command as authored, with references unexpanded, and never initializeCommand', async () => {
    const folder = devContainerFolder('c44-metadata', {
      name: 'Metadata',
      initializeCommand: 'echo init',
      onCreateCommand: 'echo create ${containerWorkspaceFolder}',
      updateContentCommand: ['echo', 'update'],
      postCreateCommand: {first: 'echo one', second: ['echo', 'two']},
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      const label = JSON.parse(
        await docker(
          'inspect',
          '-f',
          '{{index .Config.Labels "devcontainer.metadata"}}',
          containerId,
        ),
      ) as Array<Record<string, unknown>>;
      await closeWindow(name);
      const merged = Object.assign({}, ...label) as Record<string, unknown>;
      function commandsOf(key: string): unknown {
        return label.map(each => each[key]).find(value => value !== undefined);
      }
      deepStrictEqual(
        {
          onCreateCommand: commandsOf('onCreateCommand'),
          updateContentCommand: commandsOf('updateContentCommand'),
          postCreateCommand: commandsOf('postCreateCommand'),
          initializeCommand: 'initializeCommand' in merged,
        },
        {
          onCreateCommand: 'echo create ${containerWorkspaceFolder}',
          updateContentCommand: ['echo', 'update'],
          postCreateCommand: {first: 'echo one', second: ['echo', 'two']},
          initializeCommand: false,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-21 (c21): an image’s own command and the devcontainer.json’s both run, the image’s first', async () => {
    const base = 'c44-labelled-base';
    const context = path.join(variable('HARNESS_RUN_FOLDER'), 'c44-labelled');
    mkdirSync(context, {recursive: true});
    const imageCommand = `echo "image-onCreate $(date +%s)" >> ${ORDER_FILE}`;
    writeFileSync(
      path.join(context, 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nLABEL devcontainer.metadata='${JSON.stringify([{onCreateCommand: imageCommand}])}'\n`,
    );
    await docker('build', '--tag', base, context);
    const folder = devContainerFolder('c44-image-and-file', {
      name: 'Image And File',
      image: base,
      onCreateCommand: mark('file-onCreate'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await untilLabels(containerId, folder, ['file-onCreate']);
      const labels = await labelsOf(containerId, folder);
      await closeWindow(name);
      deepStrictEqual(labels, ['image-onCreate', 'file-onCreate']);
    } finally {
      await removeContainers(folder);
      await docker('image', 'rm', '-f', base);
    }
  });

  it('F-0415 AC-23 (c23): a process an in-container command backgrounds, with & or with nohup, does not outlive the command, unlike one backgrounded by a plain docker exec', async () => {
    const folder = devContainerFolder('c44-background', {
      name: 'Background',
      onCreateCommand: 'sleep 301 & nohup sleep 302 >/dev/null 2>&1 &',
      updateContentCommand: mark('updateContent'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await untilLabels(containerId, folder, ['updateContent']);
      await docker('exec', '-d', containerId, 'sleep', '303');
      const processes = await docker('exec', containerId, 'ps', '-o', 'args');
      await closeWindow(name);
      function running(fragment: string): boolean {
        return processes.split('\n').some(line => line.trim() === fragment);
      }
      deepStrictEqual(
        {
          ampersand: running('sleep 301'),
          nohup: running('sleep 302'),
          plainExec: running('sleep 303'),
        },
        {ampersand: false, nohup: false, plainExec: true},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-30 (c30): an array entry and an entry with spaces in its name run, with remoteEnv present, and empty commands cause no error while later commands still run', async () => {
    const folder = devContainerFolder('c44-odd-forms', {
      name: 'Odd Forms',
      remoteEnv: {C44_REMOTE_VAR: 'remote-value'},
      updateContentCommand: {
        'spaced entry': mark('spaced'),
        listed: [
          'sh',
          '-c',
          'pwd > .c44-listed-pwd; echo $C44_REMOTE_VAR > .c44-listed-env',
        ],
      },
      postCreateCommand: '',
      postStartCommand: {},
      postAttachCommand: [],
      onCreateCommand: mark('onCreate'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await untilLabels(containerId, folder, ['spaced']);
      const labels = await labelsOf(containerId, folder);
      const listedIn = (
        await inWorkspace(containerId, folder, 'cat .c44-listed-pwd')
      ).trim();
      const listedEnv = (
        await inWorkspace(containerId, folder, 'cat .c44-listed-env')
      ).trim();
      const dialog = await dialogOf(name);
      await closeWindow(name);
      deepStrictEqual(
        {labels, listedIn, listedEnv, dialog},
        {
          labels: ['onCreate', 'spaced'],
          listedIn: workspaceOf(folder),
          listedEnv: 'remote-value',
          dialog: undefined,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-31 (c31): a string command runs through /bin/sh and an array command runs its program with no shell', async () => {
    const zero = 'echo "$0" > .c44-zero';
    const folder = devContainerFolder('c44-shell-forms', {
      name: 'Shell Forms',
      initializeCommand: 'echo "$0" > init-zero',
      onCreateCommand: zero,
      updateContentCommand: ['touch', 'literal*star'],
      postCreateCommand: mark('postCreate'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await untilLabels(containerId, folder, ['postCreate']);
      const inside = (
        await inWorkspace(containerId, folder, 'cat .c44-zero')
      ).trim();
      const literal = (
        await inWorkspace(
          containerId,
          folder,
          'ls -A | grep -c "^literal\\*star$"',
        )
      ).trim();
      await closeWindow(name);
      deepStrictEqual(
        {host: hostFile(folder, 'init-zero').trim(), inside, literal},
        {host: '/bin/sh', inside: '/bin/sh', literal: '1'},
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
