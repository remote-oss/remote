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
  devContainerFolder,
  devContainersOf,
  isTrusted,
  reopenInContainer,
  inWindow,
  trustSettled,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  dialogText,
  notifications,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';

/** The question core asks of a folder, F-0106 5.0 step 2. */
const TRUST_QUESTION = 'Do you trust the authors of the files in this folder?';

/** The body the extension gives core's dialog, STR:S265. */
const S265 =
  'Opening a folder in a Dev Container may execute arbitrary code both inside and outside the container.';

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

/** What has run on the host for `folder`, as a row reads it: the Docker calls, the initialize hook and the containers. */
async function ranOnHost(folder: string): Promise<{
  dockerCalls: boolean;
  initialized: boolean;
  containers: string[];
}> {
  return {
    dockerCalls: existsSync(inRun('gate-trust-docker-calls')),
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
        dockerCalls:
          readFileSync(inRun('gate-trust-docker-calls'), 'utf8') !== '',
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
});
