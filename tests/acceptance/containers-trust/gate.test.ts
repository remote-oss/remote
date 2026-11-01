import {deepStrictEqual} from 'node:assert';
import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  activations,
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  isTrusted,
  reloadWindow,
  recentlyOpenedIn,
  reopenInContainer,
  inWindow,
  trustSettled,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerFolderDialog,
  dialogOf,
  clickButton,
  dialogText,
  hasStatusItem,
  notificationProgress,
  notifications,
  pageText,
  pressEscape,
  statusBarText,
  quickPickOf,
  waitForDialog,
  welcomeText,
  windowTitle,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/dev-containers-view.ts';
import {folderWrapper, recordedCalls} from '../windows/folder-wrapper.ts';

/** The question core asks of a folder, F-0106 5.0 step 2. */
const TRUST_QUESTION = 'Do you trust the authors of the files in this folder?';

/** The start of the discovery notification, which F-0301 5.0 step 2 shows in Restricted Mode as well. */
const DISCOVERY = 'Folder contains a Dev Container configuration file.';

/** The body the extension gives core's dialog, STR:S265. */
const S265 =
  'Opening a folder in a Dev Container may execute arbitrary code both inside and outside the container.';

/** The text of the connect progress toast. */
const CONNECTING = 'Connecting to Dev Container (show log)';

/** The modal that says the local folder is not trusted, and its detail, STR:S360 and STR:S377. */
const S360 = 'The local folder is currently not trusted.';
const S377 =
  'Trust is required to build a dev container from it. The folder will now reopen locally.';

/** A path in the run's folder. */
function inRun(name: string): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), name);
}

/** Writes the program that records each Docker call it gets in the run's folder, and gives its path. */
function dockerRecorder(): string {
  const recorder = inRun('docker-recorder');
  writeFileSync(
    recorder,
    `#!/bin/sh\nprintf '%s\\n' "$*" >>"${inRun('gate-trust-docker-calls')}"\nexec docker "$@"\n`,
  );
  chmodSync(recorder, 0o755);
  return recorder;
}

/**
 * The Docker calls the open commands make, from the recorder's file: the engine check's `version` and the CLI's work on
 * the folder. The Dev Containers view lists the engine's containers on its own, so its calls are not counted.
 */
function commandDockerCalls(): string[] {
  const file = inRun('gate-trust-docker-calls');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(
          line =>
            line.startsWith('version') ||
            line.includes('devcontainer.local_folder'),
        )
    : [];
}

/** What has run on the host for `folder`, as a row reads it: the Docker calls, the initialize hook and the containers. */
async function ranOnHost(folder: string): Promise<{
  dockerCalls: boolean;
  initialized: boolean;
  containers: string[];
}> {
  return {
    dockerCalls: commandDockerCalls().length > 0,
    initialized: existsSync(inRun('gate-trust-initialized')),
    containers: await devContainersOf(folder),
  };
}

const NOTHING_RAN = {dockerCalls: false, initialized: false, containers: []};

describe('Dev Containers trust gate rows (card containers-12)', function () {
  this.timeout(600_000);

  it('F-0106 AC-3, AC-4, AC-7, F-0401 AC-21 (gate-row-11): Reopen in Container in an untrusted folder asks core’s dialog with S265 before anything runs (BR-2); Cancel leaves everything as it was, twice (6.4); Trust Folder & Continue goes on to the container', async () => {
    await setUserSetting('dev.containers.dockerPath', dockerRecorder());
    try {
      const folder = devContainerFolder('gate-trust', {
        name: 'Gate Trust',
        initializeCommand: `touch ${inRun('gate-trust-initialized')}`,
      });
      const name = await openFolderWindow(folder);
      const untrustedAtOpen = (await isTrusted(name)) === false;
      const activated = activations(name);
      const declined = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const running = inWindow(name, 'remote-containers.reopenInContainer');
        const shown = await waitForDialog(name);
        const text = await dialogText(name);
        const whileOpen = {
          host: await ranOnHost(folder),
          title: await windowTitle(name),
        };
        const before = await notifications(name);
        await answerDialog(name, 'Cancel');
        await running;
        await new Promise(resolve => setTimeout(resolve, 2000));
        // The discovery notification shows before the attempt, in Restricted Mode too: it isn't the attempt's.
        const after = (await notifications(name)).filter(
          text => !text.startsWith(DISCOVERY),
        );
        declined.push({
          shown: [shown.message, text?.includes(S265), shown.buttons],
          whileOpen,
          after: {
            dialog: await dialogOf(name),
            trusted: await isTrusted(name),
            remoteName: (await windowState(name)).remoteName,
            activated: activations(name),
            host: await ranOnHost(folder),
            noNewNotification: after.every(text => before.includes(text)),
          },
        });
      }
      console.log(
        `containers-12 row 11: the dialog's buttons in DOM order: ${JSON.stringify(declined[0]?.shown[2])}`,
      );
      const reopened = reopenInContainer(name);
      await waitForDialog(name);
      const whileAcceptOpen = await ranOnHost(folder);
      await answerDialog(name, 'Trust Folder & Continue');
      await reopened;
      const accepted = {
        remoteName: (await windowState(name)).remoteName,
        initialized: existsSync(inRun('gate-trust-initialized')),
        dockerCalls: commandDockerCalls().length > 0,
        containerCount: (await devContainersOf(folder)).length,
      };
      const expectedDeclined = {
        shown: [
          TRUST_QUESTION,
          true,
          ['Manage', 'Cancel', 'Trust Folder & Continue'],
        ],
        whileOpen: {host: NOTHING_RAN, title: `[${name}]`},
        after: {
          dialog: undefined,
          trusted: false,
          remoteName: null,
          activated,
          host: NOTHING_RAN,
          noNewNotification: true,
        },
      };
      deepStrictEqual(
        {untrustedAtOpen, declined, whileAcceptOpen, accepted},
        {
          untrustedAtOpen: true,
          declined: [expectedDeclined, expectedDeclined],
          whileAcceptOpen: NOTHING_RAN,
          accepted: {
            remoteName: 'dev-container',
            initialized: true,
            dockerCalls: true,
            containerCount: 1,
          },
        },
      );
      await closeWindow(name);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0106 AC-27 (gate-row-11b): trust comes before the engine check (BR-8); after the accept a bogus dockerPath shows the pre-flight dialog, and the trust stays', async () => {
    const bogus = inRun('no-such-docker');
    await setUserSetting('dev.containers.dockerPath', bogus);
    try {
      const folder = devContainerFolder('gate-trust-noengine');
      const name = await openFolderWindow(folder);
      const untrustedAtOpen = (await isTrusted(name)) === false;
      const running = inWindow(name, 'remote-containers.reopenInContainer');
      const first = await waitForDialog(name);
      await answerDialog(name, 'Trust Folder & Continue');
      await waitFor(
        'the pre-flight dialog in place of the trust dialog',
        async () => {
          const shown = await dialogOf(name);
          return shown !== undefined && shown.message !== TRUST_QUESTION;
        },
        60_000,
      );
      const second = await waitForDialog(name);
      await answerDialog(name, 'Cancel');
      await running;
      deepStrictEqual(
        {
          untrustedAtOpen,
          first: first.message,
          second: second.message,
          trusted: await trustSettled(name, true),
          remoteName: (await windowState(name)).remoteName,
          containers: await devContainersOf(folder),
        },
        {
          untrustedAtOpen: true,
          first: TRUST_QUESTION,
          second: 'Docker version 17.12.0 or later required.',
          trusted: true,
          remoteName: null,
          containers: [],
        },
      );
      await closeWindow(name);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  /** Reopens `folder` in a container from an untrusted window and trusts it in core's dialog; the window is connected. */
  async function trustedContainerWindow(folder: string): Promise<string> {
    const name = await openFolderWindow(folder);
    const reopened = reopenInContainer(name);
    await waitForDialog(name);
    await answerDialog(name, 'Trust Folder & Continue');
    await reopened;
    return name;
  }

  it('containers-22 (t1) F-0106 6.11: after a trusted Reopen, the connected window is trusted by the local folder’s entry and shows no Restricted Mode item', async () => {
    const folder = devContainerFolder('gate-trust-held', {name: 'Trust Held'});
    const name = await trustedContainerWindow(folder);
    deepStrictEqual(
      {
        remoteName: (await windowState(name)).remoteName,
        trusted: await trustSettled(name, true),
        restrictedItem: await hasStatusItem(name, 'status.workspaceTrust'),
      },
      {remoteName: 'dev-container', trusted: true, restrictedItem: false},
    );
    await closeWindow(name);
  });

  it('F-0106 AC-39, AC-41, AC-42 (t2): trust is not forced in the connected window; Don’t Trust makes the next resolve ask, and declining shows S360 with S377, then reopens the folder locally and restricted, with the container kept', async () => {
    const folder = devContainerFolder('gate-trust-manage', {
      name: 'Trust Manage',
    });
    const name = await trustedContainerWindow(folder);
    const [containerId = ''] = await devContainersOf(folder);
    await inWindow(name, 'workbench.trust.manage');
    await waitFor(
      'the trust editor of the connected window',
      async () => (await pageText(name)).includes('You trust this folder'),
      30_000,
    );
    await clickButton(name, "Don't Trust");
    const reloaded = reloadWindow(name);
    const asked = await waitForDialog(name);
    const askedText = await dialogText(name);
    await answerDialog(name, 'Cancel');
    const declined = await waitForDialog(name);
    const declinedText = await dialogText(name);
    await answerDialog(name, 'OK');
    await reloaded;
    await waitFor(
      `window ${name} to be a local folder again`,
      async () => (await windowState(name)).remoteName === null,
      60_000,
    );
    deepStrictEqual(
      {
        asked: [asked.message, askedText?.includes(S265)],
        declined: [
          declined.message,
          declinedText?.includes(S377),
          declined.buttons,
        ],
        trusted: await trustSettled(name, false),
        containers: await devContainersOf(folder),
        folders: (await windowState(name)).folders.map(entry =>
          decodeURIComponent(entry),
        ),
      },
      {
        asked: [TRUST_QUESTION, true],
        declined: [S360, true, ['OK']],
        trusted: false,
        containers: [containerId],
        folders: [`file://${folder}`],
      },
    );
    await closeWindow(name);
  });

  /** Runs Open Folder in Container in window `name`, picks `folder`, and leaves the command running. */
  async function openFolderFrom(name: string, folder: string): Promise<void> {
    const running = inWindow(name, 'remote-containers.openFolder');
    running.catch(() => undefined);
    await answerFolderDialog(name, folder);
  }

  it('F-0403 AC-17 (o0): a folder trusted before shows no dialog at any moment from the pick until the window is connected', async () => {
    const folder = devContainerFolder('open-trusted', {name: 'Open Trusted'});
    const trusted = await trustedContainerWindow(folder);
    await closeWindow(trusted);
    const from = await openFolderWindow(
      devContainerFolder('open-trusted-from'),
    );
    await openFolderFrom(from, folder);
    const progress = {settled: false, failure: undefined as unknown};
    const settledConnect = connectedToContainer('open-trusted').then(
      () => {
        progress.settled = true;
      },
      (caught: unknown) => {
        progress.failure = caught;
        progress.settled = true;
      },
    );
    const shown: Array<string | undefined> = [];
    while (!progress.settled) {
      shown.push(
        (await dialogOf('open-trusted').catch(() => undefined))?.message,
      );
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await settledConnect;
    if (progress.failure !== undefined) {
      throw new Error(
        `the window open-trusted did not connect: ${progress.failure instanceof Error ? progress.failure.message : JSON.stringify(progress.failure)}; the dialogs seen: ${JSON.stringify(shown.filter(message => message !== undefined))}`,
        {cause: progress.failure},
      );
    }
    deepStrictEqual(
      shown.filter(message => message !== undefined),
      [],
    );
    await closeWindow('open-trusted');
  });

  it('F-0403 AC-17 (o5): Open Folder on an untrusted folder switches the window first, then core asks with S265, and trusting goes on to the container', async () => {
    const folder = devContainerFolder('open-ask', {name: 'Open Ask'});
    const from = await openFolderWindow(devContainerFolder('open-ask-from'));
    await openFolderFrom(from, folder);
    const asked = await waitForDialog('open-ask');
    const askedText = await dialogText('open-ask');
    await answerDialog('open-ask', 'Trust Folder & Continue');
    await connectedToContainer('open-ask');
    deepStrictEqual(
      {
        asked: [asked.message, askedText?.includes(S265)],
        remoteName: (await windowState('open-ask')).remoteName,
        containerCount: (await devContainersOf(folder)).length,
      },
      {
        asked: [TRUST_QUESTION, true],
        remoteName: 'dev-container',
        containerCount: 1,
      },
    );
    await closeWindow('open-ask');
  });

  it('F-0403 AC-17 (o6): declining shows S360 with S377 and one OK, then the same window is the local folder, restricted, with no container', async () => {
    const folder = devContainerFolder('open-decline', {name: 'Open Decline'});
    const from = await openFolderWindow(
      devContainerFolder('open-decline-from'),
    );
    await openFolderFrom(from, folder);
    await waitForDialog('open-decline');
    await answerDialog('open-decline', 'Cancel');
    const declined = await waitForDialog('open-decline');
    const declinedText = await dialogText('open-decline');
    await answerDialog('open-decline', 'OK');
    await waitFor(
      'the window to be the local folder again',
      async () => (await windowState('open-decline')).remoteName === null,
      60_000,
    );
    deepStrictEqual(
      {
        declined: [
          declined.message,
          declinedText?.includes(S377),
          declined.buttons,
        ],
        trusted: await trustSettled('open-decline', false),
        containers: await devContainersOf(folder),
      },
      {declined: [S360, true, ['OK']], trusted: false, containers: []},
    );
    await closeWindow('open-decline');
  });

  it('F-0301 AC-68 (o7): declining shows S360, and with no OK pressed the window is the local folder within 10 s, restricted, with no container', async () => {
    const folder = devContainerFolder('open-wait', {name: 'Open Wait'});
    const from = await openFolderWindow(devContainerFolder('open-wait-from'));
    await openFolderFrom(from, folder);
    await waitForDialog('open-wait');
    await answerDialog('open-wait', 'Cancel');
    const declined = await waitForDialog('open-wait');
    const declinedText = await dialogText('open-wait');
    await waitFor(
      'the window to be the local folder again, with no OK pressed',
      async () => (await windowState('open-wait')).remoteName === null,
      10_000,
    );
    deepStrictEqual(
      {
        declined: [
          declined.message,
          declinedText?.includes(S377),
          declined.buttons,
        ],
        trusted: await trustSettled('open-wait', false),
        containers: await devContainersOf(folder),
        dialog: await dialogOf('open-wait'),
      },
      {
        declined: [S360, true, ['OK']],
        trusted: false,
        containers: [],
        dialog: undefined,
      },
    );
    await closeWindow('open-wait');
  });

  it('F-0201 AC-55 (t55): a relative dockerPath in the folder runs nothing while the folder is untrusted, in the window, the view, the trust dialog and its Cancel; after Trust Folder & Continue the wrapper runs the checks and the window connects', async () => {
    const calls = inRun('t55-calls');
    const folder = devContainerFolder('gate-trust-wrapper', {name: 'Wrapper'});
    folderWrapper(folder, calls);
    await setUserSetting('dev.containers.dockerPath', 'tools/dk');
    try {
      const name = await openFolderWindow(folder);
      const untrusted = (await isTrusted(name)) === false;
      await new Promise(resolve => setTimeout(resolve, 5000));
      const atOpen = recordedCalls(calls);
      await inWindow(name, 'workbench.view.remote');
      await new Promise(resolve => setTimeout(resolve, 5000));
      const view = {
        welcome: await welcomeText(name, VIEW),
        calls: recordedCalls(calls),
      };
      const running = inWindow(name, 'remote-containers.reopenInContainer');
      const shown = await waitForDialog(name);
      const whileAsking = recordedCalls(calls);
      await answerDialog(name, 'Cancel');
      await running;
      await new Promise(resolve => setTimeout(resolve, 2000));
      const declined = {
        remoteName: (await windowState(name)).remoteName,
        trusted: await isTrusted(name),
        containers: await devContainersOf(folder),
        calls: recordedCalls(calls),
      };
      const reopened = reopenInContainer(name);
      await waitForDialog(name);
      await answerDialog(name, 'Trust Folder & Continue');
      await reopened;
      const connected = {
        remoteName: (await windowState(name)).remoteName,
        dialog: await dialogOf(name),
        wrapped: recordedCalls(calls).some(call => call.startsWith('version')),
      };
      await closeWindow(name);
      deepStrictEqual(
        {
          untrusted,
          atOpen,
          view,
          asked: shown.message,
          whileAsking,
          declined,
          connected,
        },
        {
          untrusted: true,
          atOpen: [],
          view: {
            welcome:
              'Get started with containers by installing Docker or by visiting the help view. Refresh after installation and startup.',
            calls: [],
          },
          asked: TRUST_QUESTION,
          whileAsking: [],
          declined: {
            remoteName: null,
            trusted: false,
            containers: [],
            calls: [],
          },
          connected: {
            remoteName: 'dev-container',
            dialog: undefined,
            wrapped: true,
          },
        },
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  /** What window `name` showed while `connecting` ran: the Connecting toast, any quick pick and every dialog message. */
  async function watchConnect(
    name: string,
    connecting: Promise<unknown>,
  ): Promise<{toast: boolean; pick: boolean; dialogs: string[]}> {
    const seen = {toast: false, pick: false, dialogs: [] as string[]};
    const state = {running: true};
    const ended = connecting.finally(() => {
      state.running = false;
    });
    ended.catch(() => undefined);
    while (state.running) {
      const toast = await notificationProgress(
        name,
        'Connecting to Dev Container',
      ).catch(() => undefined);
      seen.toast ||= toast?.message === CONNECTING;
      seen.pick ||=
        (await quickPickOf(name).catch(() => undefined)) !== undefined;
      const dialog = await dialogOf(name).catch(() => undefined);
      if (dialog !== undefined) {
        seen.dialogs.push(dialog.message);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await ended;
    return seen;
  }

  /** Trusts `folder` through a container window, waits until that window holds the trust, and closes it. */
  async function closeTrusted(folder: string): Promise<void> {
    const name = await trustedContainerWindow(folder);
    await trustSettled(name, true);
    await closeWindow(name);
  }

  it('F-0106 AC-6 (c69-6): Open Folder in Container on an untrusted folder switches the window title and the status bar to the target folder before core asks', async () => {
    const folder = devContainerFolder('c69-switch', {name: 'C69 Switch'});
    const from = await openFolderWindow(devContainerFolder('c69-switch-from'));
    await openFolderFrom(from, folder);
    await waitForDialog('c69-switch');
    const authority = decodeURIComponent(
      (await windowState('c69-switch')).folders[0] ?? '',
    );
    const encoded = /^vscode-remote:\/\/dev-container\+([0-9a-f]+)\//.exec(
      authority,
    )?.[1];
    deepStrictEqual(
      {
        title: (await windowTitle('c69-switch')).includes('c69-switch'),
        hostPath: (
          JSON.parse(Buffer.from(encoded ?? '', 'hex').toString()) as {
            hostPath: string;
          }
        ).hostPath,
        remoteName: (await windowState('c69-switch')).remoteName,
        indicator: await statusBarText('c69-switch', 'status.host'),
      },
      {
        title: true,
        hostPath: folder,
        remoteName: 'dev-container',
        indicator: 'Opening Remote...',
      },
    );
    await answerDialog('c69-switch', 'Cancel');
    await waitForDialog('c69-switch');
    await answerDialog('c69-switch', 'OK');
    await closeWindow('c69-switch');
  });

  it('F-0106 AC-6a (c69-6a): accepting core’s dialog for a folder with a configuration goes straight to Connecting to Dev Container, with no quick pick', async () => {
    const folder = devContainerFolder('c69-accept', {name: 'C69 Accept'});
    const from = await openFolderWindow(devContainerFolder('c69-accept-from'));
    await openFolderFrom(from, folder);
    await waitForDialog('c69-accept');
    await answerDialog('c69-accept', 'Trust Folder & Continue');
    const seen = await watchConnect(
      'c69-accept',
      connectedToContainer('c69-accept'),
    );
    deepStrictEqual(
      {seen, remoteName: (await windowState('c69-accept')).remoteName},
      {
        seen: {toast: true, pick: false, dialogs: []},
        remoteName: 'dev-container',
      },
    );
    await closeWindow('c69-accept');
  });

  it('F-0106 AC-6b (c69-6b): an already trusted folder shows no dialog and goes straight to the build', async () => {
    const folder = devContainerFolder('c69-trusted', {name: 'C69 Trusted'});
    await closeTrusted(folder);
    await removeContainers(folder);
    const from = await openFolderWindow(devContainerFolder('c69-trusted-from'));
    await openFolderFrom(from, folder);
    const seen = await watchConnect(
      'c69-trusted',
      connectedToContainer('c69-trusted'),
    );
    deepStrictEqual(
      {
        pick: seen.pick,
        dialogs: seen.dialogs,
        containers: (await devContainersOf(folder)).length,
      },
      {pick: false, dialogs: [], containers: 1},
    );
    await closeWindow('c69-trusted');
  });

  it('F-0106 AC-6b (c69-6c): an already trusted folder with no configuration shows no dialog and goes straight to the add-configuration quick pick', async () => {
    const folder = devContainerFolder('c69-bare', {name: 'C69 Bare'});
    await closeTrusted(folder);
    await removeContainers(folder);
    rmSync(path.join(folder, '.devcontainer'), {recursive: true});
    const from = await openFolderWindow(devContainerFolder('c69-plain-start'));
    await openFolderFrom(from, folder);
    await waitFor(
      'the location quick pick',
      async () =>
        (await quickPickOf(from))?.placeholder.startsWith('Where would you') ??
        false,
      60_000,
    );
    deepStrictEqual(await dialogOf(from), undefined);
    await pressEscape(from);
    await closeWindow(from);
  });

  it('F-0106 AC-7a (c69-7a): Escape on core’s dialog shows S360 with S377 and one OK, and OK leaves the window on the new folder, local and restricted', async () => {
    const folder = devContainerFolder('c69-escape', {name: 'C69 Escape'});
    const from = await openFolderWindow(devContainerFolder('c69-escape-from'));
    await openFolderFrom(from, folder);
    await waitForDialog('c69-escape');
    await pressEscape('c69-escape');
    const declined = await waitForDialog('c69-escape');
    const declinedText = await dialogText('c69-escape');
    await answerDialog('c69-escape', 'OK');
    await waitFor(
      'the window to be the local folder again',
      async () => (await windowState('c69-escape')).remoteName === null,
      60_000,
    );
    deepStrictEqual(
      {
        declined: [
          declined.message,
          declinedText?.includes(S377),
          declined.buttons,
        ],
        folders: (await windowState('c69-escape')).folders.map(entry =>
          decodeURIComponent(entry),
        ),
        remoteName: (await windowState('c69-escape')).remoteName,
        trusted: await trustSettled('c69-escape', false),
      },
      {
        declined: [S360, true, ['OK']],
        folders: [`file://${folder}`],
        remoteName: null,
        trusted: false,
      },
    );
    await closeWindow('c69-escape');
  });

  it('F-0106 AC-8a (c69-8a): opening the [Dev Container] recent entry from another window reattaches with no dialog and no local window', async () => {
    const folder = devContainerFolder('c69-recent', {name: 'C69 Recent'});
    await closeWindow(await trustedContainerWindow(folder));
    const from = await openFolderWindow(devContainerFolder('c69-recent-from'));
    const entry = (await recentlyOpenedIn(from)).find(
      each =>
        each.remoteAuthority?.startsWith('dev-container+') === true &&
        each.uri.endsWith('/workspaces/c69-recent'),
    );
    const opening = inWindow(from, 'acceptance.agent.openWindow', entry?.uri);
    const seen = await watchConnect(
      'c69-recent',
      opening.then(() => connectedToContainer('c69-recent')),
    );
    deepStrictEqual(
      {
        entry: entry?.label?.endsWith('[Dev Container]'),
        seen: {pick: seen.pick, dialogs: seen.dialogs},
        remoteName: (await windowState('c69-recent')).remoteName,
        restrictedItem: await hasStatusItem(
          'c69-recent',
          'status.workspaceTrust',
        ),
      },
      {
        entry: true,
        seen: {pick: false, dialogs: []},
        remoteName: 'dev-container',
        restrictedItem: false,
      },
    );
    await closeWindow('c69-recent');
  });

  it('F-0106 AC-28 (c69-28): with no Docker engine, Open Folder in Container shows the Docker-availability dialog before any picker', async () => {
    const bogus = inRun('c69-no-docker');
    await setUserSetting('dev.containers.dockerPath', bogus);
    try {
      const folder = devContainerFolder('c69-nodocker', {
        name: 'C69 No Docker',
      });
      const name = await openFolderWindow(folder);
      const running = inWindow(name, 'remote-containers.openFolder');
      const dialog = await waitForDialog(name);
      deepStrictEqual(
        {
          dialog: [dialog.message, dialog.details],
          pick: await quickPickOf(name),
        },
        {
          dialog: [
            'Docker version 17.12.0 or later required.',
            `Command not found: '${bogus}'. Check the license for details.`,
          ],
          pick: undefined,
        },
      );
      await answerDialog(name, 'Cancel');
      await running;
      await closeWindow(name);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0106 AC-30 (c69-30): with workspace trust disabled, Reopen in Container and Open Folder in Container show no trust dialog', async () => {
    await setUserSetting('security.workspace.trust.enabled', false);
    try {
      const reopenFolder = devContainerFolder('c69-off-reopen', {name: 'Off'});
      const reopenName = await openFolderWindow(reopenFolder);
      const reopened = await watchConnect(
        reopenName,
        reopenInContainer(reopenName),
      );
      await closeWindow(reopenName);
      const openFolder = devContainerFolder('c69-off-open', {name: 'Off Open'});
      const from = await openFolderWindow(devContainerFolder('c69-off-from'));
      await openFolderFrom(from, openFolder);
      const opened = await watchConnect(
        'c69-off-open',
        connectedToContainer('c69-off-open'),
      );
      deepStrictEqual(
        {
          reopened,
          opened: {pick: opened.pick, dialogs: opened.dialogs},
          containers: (await devContainersOf(openFolder)).length,
        },
        {
          reopened: {toast: true, pick: false, dialogs: []},
          opened: {pick: false, dialogs: []},
          containers: 1,
        },
      );
      await closeWindow('c69-off-open');
    } finally {
      await setUserSetting('security.workspace.trust.enabled', undefined);
    }
  });
});
