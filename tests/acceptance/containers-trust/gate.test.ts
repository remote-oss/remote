import {deepStrictEqual} from 'node:assert';
import {chmodSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  activations,
  openFolderWindow,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  isTrusted,
  reloadWindow,
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
  notifications,
  pageText,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';

/** The question core asks of a folder, F-0106 5.0 step 2. */
const TRUST_QUESTION = 'Do you trust the authors of the files in this folder?';

/** The body the extension gives core's dialog, STR:S265. */
const S265 =
  'Opening a folder in a Dev Container may execute arbitrary code both inside and outside the container.';

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
        await answerDialog(name, 'Cancel');
        await running;
        await new Promise(resolve => setTimeout(resolve, 2000));
        declined.push({
          shown: [shown.message, text?.includes(S265), shown.buttons],
          whileOpen,
          after: {
            dialog: await dialogOf(name),
            trusted: await isTrusted(name),
            remoteName: (await windowState(name)).remoteName,
            activated: activations(name),
            host: await ranOnHost(folder),
            notifications: await notifications(name),
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
          notifications: [],
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
    const progress = {connected: false};
    const settledConnect = connectedToContainer('open-trusted').then(() => {
      progress.connected = true;
    });
    const shown: Array<string | undefined> = [];
    while (!progress.connected) {
      shown.push(
        (await dialogOf('open-trusted').catch(() => undefined))?.message,
      );
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await settledConnect;
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

  it('F-0403 AC-17, F-0301 AC-68 (o6): declining shows S360 with S377 and one OK, then the same window is the local folder, restricted, with no container', async () => {
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
});
