import {deepStrictEqual} from 'node:assert';
import {chmodSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  inWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerNotification,
  dialogOf,
  notificationButtons,
  notificationCentre,
  notificationLinks,
  quickPickFacts,
  toastFacts,
} from '../windows/renderer.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {
  docker,
  NOTICE_START,
  noDaemonDocker,
  showsNotice,
} from './resolve-support.ts';

/** The notification's message as the window shows it, the link as its words (F-0402 S426 with S186). */
const NOTICE =
  'Folder contains a Dev Container configuration file. Reopen folder to develop in a container (learn more).';

/** The page the link opens: the extension's introduction. */
const INTRODUCTION =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md';

const FOLLOW_UP = "Don't show again for the current folder or for any folder?";

const CONFIGURATION = '{"image": "alpine"}';

/** A folder named `label` in the run's folder that holds `files` (path to text), made empty first. */
function folderWith(label: string, files: Record<string, string>): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, relative)), {recursive: true});
    writeFileSync(path.join(folder, relative), text);
  }
  return folder;
}

/** The containers the engine lists for `folder`, running or not. */
async function containersOf(folder: string): Promise<string> {
  return docker(
    'ps',
    '-a',
    '-q',
    '--filter',
    `label=devcontainer.local_folder=${folder}`,
  );
}

/** A `docker` program for `dev.containers.dockerPath` that waits `seconds` before it runs the real one; its path. */
function slowDocker(seconds: number): string {
  const wrapper = path.join(variable('HARNESS_RUN_FOLDER'), 'docker-slow');
  writeFileSync(
    wrapper,
    `#!/bin/sh\nsleep ${String(seconds)}\nexec ${execFileSync('sh', ['-c', 'command -v docker']).toString().trim()} "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
}

describe('the reopen notification (card containers-23, F-0402)', function () {
  this.timeout(600_000);

  it('F-0402 AC-1, AC-2, F-0101 AC-3, F-0301 AC-18 (n1-n2): a folder with a configuration shows the notification with its link and buttons, and Reopen in Container reconnects the window to its container', async () => {
    const folder = devContainerFolder('notice-shown', {name: 'Notice'});
    const name = await openFolderWindow(folder);
    await showsNotice(name);
    const shown = (await notificationCentre(name)).filter(text =>
      text.startsWith(NOTICE_START),
    );
    const links = await notificationLinks(name, NOTICE_START);
    const buttons = await notificationButtons(name, NOTICE_START);
    const facts = (await toastFacts(name)).filter(each =>
      each.message.startsWith(NOTICE_START),
    );
    const started = await containersOf(folder);
    await answerNotification(name, NOTICE_START, 'Reopen in Container');
    await connectedToContainer(name);
    const state = await windowState(name);
    deepStrictEqual(
      {
        shown,
        links,
        buttons,
        chrome: facts.map(each => [
          each.source,
          each.severity,
          each.buttons.map(button => button.primary),
        ]),
        started,
        remoteName: state.remoteName,
        inContainer: state.folders.some(entry =>
          decodeURIComponent(entry).endsWith('/workspaces/notice-shown'),
        ),
      },
      {
        shown: [NOTICE],
        links: [{text: 'learn more', href: INTRODUCTION}],
        buttons: ['Reopen in Container', "Don't Show Again..."],
        chrome: [['Source: Dev Containers', 'info', [true, false]]],
        started: '',
        remoteName: 'dev-container',
        inContainer: true,
      },
    );
    await closeWindow(name);
  });

  it('F-0402 AC-3, F-0301 AC-21 (n3): Don’t Show Again... asks for the scope, with Any Folder and Current Folder', async () => {
    const name = await openFolderWindow(
      devContainerFolder('notice-current', {name: 'Notice Current'}),
    );
    await showsNotice(name);
    await answerNotification(name, NOTICE_START, "Don't Show Again...");
    const buttons = await notificationButtons(name, FOLLOW_UP);
    deepStrictEqual(
      [(await notificationCentre(name)).includes(FOLLOW_UP), buttons],
      [true, ['Any Folder', 'Current Folder']],
    );
    await answerNotification(name, FOLLOW_UP, 'Current Folder');
    await closeWindow(name);
  });

  it('F-0402 AC-4, F-0301 AC-21, F-0501 AC-16 (n4): Current Folder keeps the notification away from that folder only', async () => {
    const current = devContainerFolder('notice-current');
    const again = await openFolderWindow(current);
    const againShown = await showsNotice(again);
    await closeWindow(again);
    const other = await openFolderWindow(devContainerFolder('notice-other'));
    const otherShown = await showsNotice(other);
    await closeWindow(other);
    deepStrictEqual([againShown, otherShown], [false, true]);
  });

  it('F-0402 AC-9, F-0301 AC-6 (n5): a folder with no configuration shows no notification and no error', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'notice-none');
    mkdirSync(folder, {recursive: true});
    const name = await openFolderWindow(folder);
    const shown = await showsNotice(name);
    const dialog = await dialogOf(name);
    const centre = await notificationCentre(name);
    await closeWindow(name);
    deepStrictEqual([shown, dialog, centre], [false, undefined, []]);
  });

  it('F-0402 AC-5, AC-8, F-0301 AC-17 (n6): Any Folder keeps it away from every folder, and the reset command brings it back', async () => {
    const first = await openFolderWindow(
      devContainerFolder('notice-any', {name: 'Notice Any'}),
    );
    try {
      await showsNotice(first);
      await answerNotification(first, NOTICE_START, "Don't Show Again...");
      await answerNotification(first, FOLLOW_UP, 'Any Folder');
      const second = await openFolderWindow(
        devContainerFolder('notice-other2'),
      );
      const suppressed = await showsNotice(second);
      await closeWindow(second);
      await inWindow(
        first,
        'remote-containers.showReopenInContainerNotificationReset',
      );
      const third = await openFolderWindow(devContainerFolder('notice-other2'));
      const back = await showsNotice(third);
      await closeWindow(third);
      deepStrictEqual([suppressed, back], [false, true]);
    } finally {
      await inWindow(
        first,
        'remote-containers.showReopenInContainerNotificationReset',
      );
      await closeWindow(first);
    }
  });

  it('F-0101 AC-19 (n7-subfolder): a configuration one subfolder deep shows the notification, one two levels deep shows none', async () => {
    const shallow = await openFolderWindow(
      folderWith('notice-sub', {
        '.devcontainer/a/devcontainer.json': CONFIGURATION,
      }),
    );
    const shallowShown = await showsNotice(shallow);
    const shallowStarted = await containersOf(
      path.join(variable('HARNESS_RUN_FOLDER'), 'notice-sub'),
    );
    await closeWindow(shallow);
    const deep = await openFolderWindow(
      folderWith('notice-deep', {
        '.devcontainer/a/b/devcontainer.json': CONFIGURATION,
      }),
    );
    const deepShown = await showsNotice(deep);
    await closeWindow(deep);
    deepStrictEqual(
      [shallowShown, shallowStarted, deepShown],
      [true, '', false],
    );
  });

  it('F-0301 AC-29 (n9-removed): the notification of a configuration that has since been removed opens the wizard when Reopen in Container is pressed, and starts no connection', async () => {
    const folder = folderWith('notice-removed', {
      '.devcontainer/devcontainer.json': CONFIGURATION,
    });
    const name = await openFolderWindow(folder);
    try {
      await showsNotice(name);
      rmSync(path.join(folder, '.devcontainer'), {recursive: true});
      await answerNotification(name, NOTICE_START, 'Reopen in Container');
      await waitFor(
        'the wizard',
        async () =>
          (await quickPickFacts(name))?.title ===
          'Add Dev Container Configuration Files',
        30_000,
      );
      deepStrictEqual(
        [(await windowState(name)).remoteName, await containersOf(folder)],
        [null, ''],
      );
    } finally {
      await closeWindow(name);
    }
  });

  it('F-0101 AC-20 (n10-slow-docker): a Docker CLI that answers after 12 s, a missing CLI and a daemon that is not there each leave the notification to appear within 5 s of the window, with no Docker error', async () => {
    const times: number[] = [];
    const errors: unknown[] = [];
    try {
      for (const [label, dockerPath] of [
        ['slow', slowDocker(12)],
        ['missing', '/nonexistent/docker'],
        ['nodaemon', noDaemonDocker()],
      ] as const) {
        await setUserSetting('dev.containers.dockerPath', dockerPath);
        const name = await openFolderWindow(
          folderWith(`notice-${label}`, {
            '.devcontainer/devcontainer.json': CONFIGURATION,
          }),
        );
        const began = Date.now();
        await showsNotice(name, 60_000);
        times.push(Date.now() - began);
        errors.push(await dialogOf(name));
        await closeWindow(name);
      }
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
    deepStrictEqual(
      [times.map(each => each < 5000), errors],
      [
        [true, true, true],
        [undefined, undefined, undefined],
      ],
    );
  });
});
