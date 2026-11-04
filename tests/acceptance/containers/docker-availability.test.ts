import {deepStrictEqual} from 'node:assert';
import {chmodSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenInContainer,
  settingDefaultIn,
  settingIn,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerNotification,
  dialogOf,
  notificationButtons,
  notificationCentre,
  notificationLinks,
  notifications,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {sampling} from '../windows/sampling.ts';

const STARTING = 'Starting Docker (show log)';
const READING = 'Reading Dev Container Configuration (show log)';
const ENGINE_ERROR = 'Docker returned an error.';

/** The folder of the stand-in docker and the files that steer it. */
const STATE = path.join(variable('HARNESS_RUN_FOLDER'), 'availability');

/**
 * A `docker` for `dev.containers.dockerPath` whose version queries answer as the files of {@link STATE} say: after the
 * seconds `delay` holds, and with the daemon's error when `down` exists (every version query) or `down-resolve` exists
 * (the plain `docker version` of the resolve-time check alone). Every other call goes to the real docker.
 */
function standInDocker(): {
  program: string;
  steer(files: Readonly<Record<string, string | undefined>>): void;
  remove(): void;
} {
  mkdirSync(STATE, {recursive: true});
  const program = path.join(STATE, 'docker');
  const error =
    'failed to connect to the docker API at unix:///var/run/remote-oss-none.sock';
  writeFileSync(
    program,
    `#!/bin/sh
state=${STATE}
if [ "$1" = version ]; then
  if [ -f "$state/delay" ]; then sleep "$(cat "$state/delay")"; fi
  if [ -f "$state/down" ] || { [ -f "$state/down-resolve" ] && [ $# -eq 1 ]; }; then
    echo '${error}' >&2
    exit 1
  fi
fi
exec docker "$@"
`,
  );
  chmodSync(program, 0o755);
  return {
    program,
    steer: files => {
      for (const file of ['delay', 'down', 'down-resolve']) {
        const text = files[file];
        if (text === undefined) {
          rmSync(path.join(STATE, file), {force: true});
        } else {
          writeFileSync(path.join(STATE, file), text);
        }
      }
    },
    remove: () => {
      rmSync(STATE, {recursive: true, force: true});
    },
  };
}

/** Waits for the notification that starts with `message` to show in window `name`. */
async function toastShown(name: string, message: string): Promise<void> {
  await waitFor(
    `the toast ${message}`,
    async () => {
      try {
        return (await notifications(name)).includes(message);
      } catch {
        return false;
      }
    },
    60_000,
  );
}

describe('Docker availability rows (card containers-200, part B)', function () {
  this.timeout(600_000);

  let docker: ReturnType<typeof standInDocker>;

  beforeEach(async () => {
    docker = standInDocker();
    docker.steer({});
    await setUserSetting('dev.containers.dockerPath', docker.program);
  });

  afterEach(async () => {
    await setUserSetting('dev.containers.dockerPath', undefined);
    await setUserSetting(
      'dev.containers.optimisticallyLaunchDocker',
      undefined,
    );
    docker.remove();
  });

  it('F-0202 AC-7 (c200-setting): the setting is contributed as a boolean that is true by default, and setting it to false changes nothing about a failing check', async () => {
    docker.steer({down: ''});
    const folder = devContainerFolder('c200-setting', {name: 'C200 Setting'});
    const name = await openFolderWindow(folder);
    const before = await settingDefaultIn(
      name,
      'dev.containers.optimisticallyLaunchDocker',
    );
    await setUserSetting('dev.containers.optimisticallyLaunchDocker', false);
    const running = inWindow(name, 'remote-containers.reopenInContainer');
    running.catch(() => undefined);
    const dialog = await waitForDialog(name);
    await answerDialog(name, 'Cancel');
    await running.catch(() => undefined);
    deepStrictEqual(
      {
        before,
        value: await settingIn(
          name,
          'dev.containers.optimisticallyLaunchDocker',
        ),
        dialog: dialog.message,
        containers: await devContainersOf(folder),
      },
      {before: true, value: false, dialog: ENGINE_ERROR, containers: []},
    );
    await closeWindow(name);
  });

  it('F-0202 AC-31, AC-34 (c200-slow-check): a first check that runs two seconds shows Starting Docker (show log) with a Cancel and a link to the log terminal, and the open goes on once the check passes', async () => {
    docker.steer({delay: '4'});
    const folder = devContainerFolder('c200-slow', {name: 'C200 Slow'});
    try {
      const name = await openFolderWindow(folder);
      const opening = reopenInContainer(name);
      await toastShown(name, STARTING);
      const facts = {
        buttons: await notificationButtons(name, STARTING),
        links: await notificationLinks(name, STARTING),
      };
      await opening;
      deepStrictEqual(
        {
          ...facts,
          remoteName: (await windowState(name)).remoteName,
          containers: (await devContainersOf(folder)).length,
        },
        {
          buttons: ['Cancel'],
          links: [
            {
              text: STARTING,
              href: 'command:remote-containers.revealLogTerminal',
            },
          ],
          remoteName: 'dev-container',
          containers: 1,
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0202 AC-32 (c200-cancel): Cancel on Starting Docker abandons the open although the check would have passed: no reload, no container, no other notification or dialog', async () => {
    docker.steer({delay: '10'});
    const folder = devContainerFolder('c200-cancel', {name: 'C200 Cancel'});
    const name = await openFolderWindow(folder);
    const running = inWindow(name, 'remote-containers.reopenInContainer');
    running.catch(() => undefined);
    await toastShown(name, STARTING);
    await answerNotification(name, STARTING, 'Cancel');
    await running.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 15_000));
    deepStrictEqual(
      {
        toasts: await notifications(name),
        centre: await notificationCentre(name),
        dialog: await dialogOf(name),
        remoteName: (await windowState(name)).remoteName,
        containers: await devContainersOf(folder),
      },
      {
        toasts: [],
        centre: [],
        dialog: undefined,
        remoteName: null,
        containers: [],
      },
    );
    await closeWindow(name);
  });

  it('F-0202 AC-33 (c200-fast-fail): a check that fails within the two seconds shows its dialog and no Starting Docker or Reading notification', async () => {
    docker.steer({delay: '1', down: ''});
    const folder = devContainerFolder('c200-fast', {name: 'C200 Fast'});
    const name = await openFolderWindow(folder);
    const sampler = sampling(name);
    const running = inWindow(name, 'remote-containers.reopenInContainer');
    running.catch(() => undefined);
    const dialog = await waitForDialog(name);
    const samples = await sampler.stop();
    await answerDialog(name, 'Cancel');
    await running.catch(() => undefined);
    deepStrictEqual(
      {
        dialog: dialog.message,
        toasts: samples
          .flatMap(sample => sample.toasts.map(toast => toast.message))
          .filter(text => text === STARTING || text === READING),
      },
      {dialog: ENGINE_ERROR, toasts: []},
    );
    await closeWindow(name);
  });

  it('F-0202 AC-45 (c200-second-trigger): a second invocation during a running check runs its own check, so two failures show two dialogs', async () => {
    docker.steer({delay: '3', down: ''});
    const folder = devContainerFolder('c200-second', {name: 'C200 Second'});
    const name = await openFolderWindow(folder);
    const first = inWindow(name, 'remote-containers.reopenInContainer');
    const second = inWindow(name, 'remote-containers.reopenInContainer');
    first.catch(() => undefined);
    second.catch(() => undefined);
    const messages: string[] = [];
    for (let shown = 0; shown < 2; shown += 1) {
      const dialog = await waitForDialog(name, 90_000);
      messages.push(dialog.message);
      await answerDialog(name, 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await Promise.all([first, second]).catch(() => undefined);
    deepStrictEqual(
      {messages, containers: await devContainersOf(folder)},
      {messages: [ENGINE_ERROR, ENGINE_ERROR], containers: []},
    );
    await closeWindow(name);
  });

  it('F-0202 AC-39 (c200-retry): a rebuild whose resolve-time check fails has dropped its intent, so Retry reconnects to the same container', async () => {
    const folder = devContainerFolder('c200-retry', {name: 'C200 Retry'});
    try {
      const first = await openFolderWindow(folder);
      await reopenInContainer(first);
      const created = await devContainersOf(folder);
      await closeWindow(first);
      docker.steer({'down-resolve': ''});
      const name = await openFolderWindow(folder);
      const rebuilding = inWindow(
        name,
        'remote-containers.rebuildAndReopenInContainer',
      );
      rebuilding.catch(() => undefined);
      const dialog = await waitForDialog(name, 300_000);
      docker.steer({});
      await answerDialog(name, 'Retry');
      await waitFor(
        `window ${name} to connect`,
        async () => (await windowState(name)).remoteName === 'dev-container',
        300_000,
      );
      deepStrictEqual(
        {
          retry: dialog.buttons.includes('Retry'),
          containers: await devContainersOf(folder),
        },
        {retry: true, containers: created},
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });
});
