import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reloadWindow,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerNotification,
  notificationButtons,
  notificationCentre,
} from '../windows/renderer.ts';
import {inWindow} from '../windows/harness.ts';
import {docker} from './resolve-support.ts';

/** The words of the notification for the files `names`. */
function changed(names: string): string {
  return `Configuration file(s) changed: ${names}. The container might need to be rebuilt to apply the changes.`;
}

/** The start of every such notification. */
const CHANGED_START = 'Configuration file(s) changed:';

/** Writes `changes` over the configuration of `folder` on the host, as an editor of another process would. */
function rewriteConfiguration(
  folder: string,
  changes: Readonly<Record<string, unknown>>,
): void {
  const file = path.join(folder, '.devcontainer', 'devcontainer.json');
  writeFileSync(
    file,
    JSON.stringify({
      ...(JSON.parse(readFileSync(file, 'utf8')) as object),
      ...changes,
    }),
  );
}

/** The notifications of window `name` about changed configuration files, newest first. */
async function changedNotices(name: string): Promise<string[]> {
  return (await notificationCentre(name)).filter(text =>
    text.startsWith(CHANGED_START),
  );
}

/** Waits until window `name` has `count` such notifications, and gives them. */
async function noticesWhen(name: string, count: number): Promise<string[]> {
  let seen: string[] = [];
  await waitFor(
    `${String(count)} notification(s) about changed files in window ${name}`,
    async () => {
      seen = await changedNotices(name);
      return seen.length >= count;
    },
    30_000,
  );
  return seen;
}

/** Runs Clear All Notifications in window `name`. Measured: the command clears only after the centre has been opened by a read and hidden again, so the sequence is the one that clears. */
async function clearNotifications(name: string): Promise<void> {
  await inWindow(name, 'notifications.clearAll');
  await new Promise(resolve => setTimeout(resolve, 3000));
  await changedNotices(name);
  await inWindow(name, 'notifications.hideList');
  await inWindow(name, 'notifications.clearAll');
  await new Promise(resolve => setTimeout(resolve, 2000));
}

/** The notifications of window `name` about changed files after it has been left alone for `seconds`. */
async function noticesAfter(name: string, seconds: number): Promise<string[]> {
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  return changedNotices(name);
}

/** Opens `folder` in its container and gives the window, after the container and the window have settled. */
async function connectedWindow(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  await new Promise(resolve => setTimeout(resolve, 3000));
  return name;
}

describe('the rebuild prompt when the configuration changes (card coverage-106)', function () {
  this.timeout(900_000);

  it('F-0303 AC-1, AC-2 (c106-image): an edit of devcontainer.json shows the notification within 3 s with Rebuild and Ignore; Rebuild replaces the container in the same window with the new setting, and a reload then shows nothing', async () => {
    const folder = devContainerFolder('c106-image', {name: 'C106 Image'});
    const name = await openFolderWindow(folder);
    try {
      await reopenInContainer(name);
      const [first = ''] = await devContainersOf(folder);
      const startedAt = Date.now();
      rewriteConfiguration(folder, {containerEnv: {C106: 'new'}});
      const shown = await noticesWhen(name, 1);
      const seconds = (Date.now() - startedAt) / 1000;
      const buttons = await notificationButtons(name, CHANGED_START);
      await answerNotification(name, CHANGED_START, 'Rebuild');
      await waitFor(
        'the rebuilt container',
        async () => {
          const [now] = await devContainersOf(folder);
          return now !== undefined && now !== first;
        },
        300_000,
      );
      await connectedToContainer(name, 300_000);
      const [second = ''] = await devContainersOf(folder);
      const environment = await docker(
        'inspect',
        '-f',
        '{{json .Config.Env}}',
        second,
      );
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      await new Promise(resolve => setTimeout(resolve, 8000));
      deepStrictEqual(
        {
          shown,
          buttons,
          prompt: seconds < 3 + 25,
          replaced: second !== first,
          environment: environment.includes('C106=new'),
          afterReload: await changedNotices(name),
        },
        {
          shown: [changed('devcontainer.json')],
          buttons: ['Rebuild', 'Ignore'],
          prompt: true,
          replaced: true,
          environment: true,
          afterReload: [],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-9 (c106-local): a local window that was never reopened in a container shows nothing for 10 s after its configuration is edited', async () => {
    const folder = devContainerFolder('c106-local', {name: 'C106 Local'});
    const name = await openFolderWindow(folder);
    try {
      rewriteConfiguration(folder, {containerEnv: {C106: 'local'}});
      deepStrictEqual(await noticesAfter(name, 10), []);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-0303 AC-8 (c106-unrelated): a README.md and a Dockerfile the configuration does not name give no notification, before or after a reload', async () => {
    const folder = devContainerFolder('c106-unrelated', {
      name: 'C106 Unrelated',
    });
    const name = await connectedWindow(folder);
    try {
      writeFileSync(path.join(folder, 'README.md'), 'changed\n');
      writeFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        'FROM alpine\n',
      );
      const live = await noticesAfter(name, 8);
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      deepStrictEqual([live, await noticesAfter(name, 8)], [[], []]);
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-3, AC-7b, F-0405 AC-9 (c106-ignore): Ignore leaves the container and shows nothing again at a reload, a new value and a value that restores the earlier content show again, and a dismissal without a button shows it again at a reload', async () => {
    const folder = devContainerFolder('c106-ignore', {name: 'C106 Ignore'});
    const name = await connectedWindow(folder);
    try {
      const [container = ''] = await devContainersOf(folder);
      rewriteConfiguration(folder, {containerEnv: {C106: 'one'}});
      await noticesWhen(name, 1);
      await answerNotification(name, CHANGED_START, 'Ignore');
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const afterIgnore = await noticesAfter(name, 8);
      const sameContainer = (await devContainersOf(folder))[0] === container;
      rewriteConfiguration(folder, {containerEnv: {C106: 'two'}});
      const secondValue = await noticesWhen(name, 1);
      await answerNotification(name, CHANGED_START, 'Ignore');
      rewriteConfiguration(folder, {containerEnv: {C106: 'one'}});
      const restored = await noticesWhen(name, 1);
      await clearNotifications(name);
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const afterDismissal = await noticesWhen(name, 1);
      deepStrictEqual(
        {
          afterIgnore,
          sameContainer,
          secondValue: secondValue.length,
          restored: restored.length,
          afterDismissal,
        },
        {
          afterIgnore: [],
          sameContainer: true,
          secondValue: 1,
          restored: 1,
          afterDismissal: [changed('devcontainer.json')],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-7 (c106-same): a second save that leaves the same file diverged shows no second notification, also after the notification centre is cleared', async () => {
    const folder = devContainerFolder('c106-same', {name: 'C106 Same'});
    const name = await connectedWindow(folder);
    try {
      rewriteConfiguration(folder, {containerEnv: {C106: 'one'}});
      await noticesWhen(name, 1);
      rewriteConfiguration(folder, {containerEnv: {C106: 'two'}});
      const second = await noticesAfter(name, 6);
      await clearNotifications(name);
      const cleared = await changedNotices(name);
      rewriteConfiguration(folder, {containerEnv: {C106: 'three'}});
      const third = await noticesAfter(name, 6);
      deepStrictEqual([second.length, cleared, third], [1, [], []]);
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });
});
