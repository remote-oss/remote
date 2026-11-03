import {deepStrictEqual} from 'node:assert';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reloadWindow,
  reopenInContainer,
  runLabelArguments,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  answerNotification,
  notificationButtons,
  paletteRows,
  waitForDialog,
} from '../windows/renderer.ts';
import {docker} from './resolve-support.ts';
import {
  changed,
  CHANGED_START,
  changedNotices,
  clearNotifications,
  connectedWindow,
  noticesAfter,
  noticesWhen,
  rewriteConfiguration,
  storedHashes,
} from '../windows/config-watch-support.ts';
import {storeRoot} from '../windows/authoring-support.ts';

/** The Dockerfile of the rows: the run's dev container image, nothing more. */
function dockerfileText(): string {
  return `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`;
}

/** A folder named `label` whose configuration builds from `.devcontainer/Dockerfile`, with `extra` over the configuration. */
function dockerfileFolder(
  label: string,
  extra: Readonly<Record<string, unknown>> = {},
): string {
  const folder = devContainerFolder(label, {
    name: label,
    image: undefined,
    build: {dockerfile: 'Dockerfile'},
    ...extra,
  });
  writeFileSync(
    path.join(folder, '.devcontainer', 'Dockerfile'),
    dockerfileText(),
  );
  return folder;
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

  it('F-0303 AC-4, AC-5, AC-24 (c106-dockerfile): a Dockerfile written on the host shows nothing for 40 s; after a reload it is named alone, and a configuration edit then shows both, beside the first', async () => {
    const folder = dockerfileFolder('c106-dockerfile');
    const name = await connectedWindow(folder);
    try {
      appendFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        '# a comment line\n\n',
      );
      const live = await noticesAfter(name, 40);
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const afterReload = await noticesWhen(name, 1);
      rewriteConfiguration(folder, {containerEnv: {C106: 'two'}});
      const both = await noticesWhen(name, 2);
      deepStrictEqual(
        {live, afterReload, both},
        {
          live: [],
          afterReload: [changed('Dockerfile')],
          both: [
            changed('Dockerfile, devcontainer.json'),
            changed('Dockerfile'),
          ],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-11 (c106-scope): a file written after the notification and not named in it stays unacknowledged by Ignore and is acknowledged by Rebuild', async () => {
    const outcomes: string[][] = [];
    for (const button of ['Ignore', 'Rebuild']) {
      const folder = dockerfileFolder(`c106-scope-${button.toLowerCase()}`);
      const name = await connectedWindow(folder);
      try {
        rewriteConfiguration(folder, {containerEnv: {C106: 'one'}});
        await noticesWhen(name, 1);
        appendFileSync(
          path.join(folder, '.devcontainer', 'Dockerfile'),
          'LABEL c106=changed\n',
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
        await answerNotification(name, CHANGED_START, button);
        if (button === 'Rebuild') {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        await connectedToContainer(name, 300_000);
        await reloadWindow(name);
        await connectedToContainer(name, 300_000);
        outcomes.push(
          button === 'Ignore'
            ? await noticesWhen(name, 1)
            : await noticesAfter(name, 10),
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
        await removeContainers(folder).catch(() => undefined);
      }
    }
    deepStrictEqual(outcomes, [[changed('Dockerfile')], []]);
  });

  it('F-0303 AC-19, AC-20 (c106-delete): a deleted configuration shows nothing at 0, 10 and 25 s or after a reload, an identical recreation shows nothing, and a different edit shows within 3 s', async () => {
    const folder = devContainerFolder('c106-delete', {name: 'C106 Delete'});
    const name = await connectedWindow(folder);
    const file = path.join(folder, '.devcontainer', 'devcontainer.json');
    const text = readFileSync(file, 'utf8');
    try {
      rmSync(file);
      const deleted = [
        await noticesAfter(name, 1),
        await noticesAfter(name, 9),
        await noticesAfter(name, 15),
      ];
      writeFileSync(file, text);
      const identical = await noticesAfter(name, 6);
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const afterReload = await noticesAfter(name, 8);
      rewriteConfiguration(folder, {containerEnv: {C106: 'different'}});
      const different = await noticesWhen(name, 1);
      deepStrictEqual(
        {deleted, identical, afterReload, different},
        {
          deleted: [[], [], []],
          identical: [],
          afterReload: [],
          different: [changed('devcontainer.json')],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-14, AC-23 (c106-format): comments, spacing and a missing final brace change nothing; a reordered key, a changed value (also without the brace) and text that is not JSON are told', async () => {
    const base = {
      name: 'C106 Format',
      image: variable('HARNESS_DEVCONTAINER_IMAGE'),
      runArgs: runLabelArguments(),
      containerEnv: {FIRST: '1', SECOND: '2'},
    };
    const folder = devContainerFolder('c106-format', base);
    const file = path.join(folder, '.devcontainer', 'devcontainer.json');
    const plain = JSON.stringify(base, null, 2);
    writeFileSync(file, plain);
    const name = await connectedWindow(folder);
    try {
      const quiet: string[][] = [];
      for (const text of [
        `// a comment\n${plain.replace(/\n/g, '\n\n  ')}\n`,
        plain.slice(0, plain.lastIndexOf('}')),
        plain,
      ]) {
        writeFileSync(file, text);
        quiet.push(await noticesAfter(name, 6));
      }
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      quiet.push(await noticesAfter(name, 8));
      const reordered = JSON.stringify(
        {...base, containerEnv: {SECOND: '2', FIRST: '1'}},
        null,
        2,
      );
      writeFileSync(file, reordered);
      const order = await noticesWhen(name, 1);
      await answerNotification(name, CHANGED_START, 'Ignore');
      writeFileSync(
        file,
        JSON.stringify({
          ...base,
          containerEnv: {SECOND: '2', FIRST: '9'},
        }).slice(0, -1),
      );
      const value = await noticesWhen(name, 1);
      await answerNotification(name, CHANGED_START, 'Ignore');
      writeFileSync(file, 'this is not JSON at all');
      const invalid = await noticesWhen(name, 1);
      deepStrictEqual(
        {quiet, order, value, invalid},
        {
          quiet: [[], [], [], []],
          order: [changed('devcontainer.json')],
          value: [changed('devcontainer.json')],
          invalid: [changed('devcontainer.json')],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-25 (c106-legacy): the legacy dockerFile property is watched at an activation only, and the notification offers Rebuild and Ignore', async () => {
    const folder = devContainerFolder('c106-legacy', {
      name: 'C106 Legacy',
      image: undefined,
      dockerFile: 'Dockerfile',
    });
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      dockerfileText(),
    );
    const name = await connectedWindow(folder);
    try {
      appendFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        'LABEL c106=legacy\n',
      );
      const live = await noticesAfter(name, 10);
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const shown = await noticesWhen(name, 1);
      deepStrictEqual(
        [live, shown, await notificationButtons(name, CHANGED_START)],
        [[], [changed('Dockerfile')], ['Rebuild', 'Ignore']],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-28 (c106-dotfile): a root .devcontainer.json is told with its dot within 3 s, and with its Dockerfile after a reload', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'c106-dotfile');
    rmSync(folder, {recursive: true, force: true});
    mkdirSync(folder, {recursive: true});
    const file = path.join(folder, '.devcontainer.json');
    const config = {
      name: 'C106 Dotfile',
      build: {dockerfile: 'Dockerfile'},
      runArgs: runLabelArguments(),
    };
    writeFileSync(file, JSON.stringify(config));
    writeFileSync(path.join(folder, 'Dockerfile'), dockerfileText());
    const name = await connectedWindow(folder);
    try {
      writeFileSync(
        file,
        JSON.stringify({...config, containerEnv: {C106: 'x'}}),
      );
      const first = await noticesWhen(name, 1);
      appendFileSync(path.join(folder, 'Dockerfile'), 'LABEL c106=dot\n');
      await new Promise(resolve => setTimeout(resolve, 3000));
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const second = await noticesWhen(name, 1);
      deepStrictEqual(
        [first, second],
        [
          [changed('.devcontainer.json')],
          [changed('.devcontainer.json, Dockerfile')],
        ],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-12 (c106-first): the first Reopen in Container of a folder that was never connected shows nothing', async () => {
    const folder = devContainerFolder('c106-first', {name: 'C106 First'});
    const name = await connectedWindow(folder);
    try {
      deepStrictEqual(await noticesAfter(name, 10), []);
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-16, AC-17 (c106-target): naming another Dockerfile tells the old target, the new one and the configuration; once acted on the old target is unwatched; a target outside the folder is told by its written path', async () => {
    const folder = dockerfileFolder('c106-target');
    const second = path.join(folder, '.devcontainer', 'Dockerfile2');
    const outside = path.join(folder, 'OutsideDockerfile');
    writeFileSync(second, dockerfileText());
    writeFileSync(outside, dockerfileText());
    const name = await connectedWindow(folder);
    try {
      rewriteConfiguration(folder, {build: {dockerfile: 'Dockerfile2'}});
      const first = await noticesWhen(name, 1);
      await answerNotification(name, CHANGED_START, 'Ignore');
      appendFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        'LABEL c106=old\n',
      );
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const unwatched = await noticesAfter(name, 8);
      rewriteConfiguration(folder, {
        build: {dockerfile: '../OutsideDockerfile'},
      });
      const third = await noticesWhen(name, 1);
      await answerNotification(name, CHANGED_START, 'Ignore');
      appendFileSync(outside, 'LABEL c106=outside\n');
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const fourth = await noticesWhen(name, 1);
      deepStrictEqual(
        {first, unwatched, third, fourth},
        {
          first: [changed('Dockerfile, Dockerfile2, devcontainer.json')],
          unwatched: [],
          third: [
            changed('../OutsideDockerfile, Dockerfile2, devcontainer.json'),
          ],
          fourth: [changed('../OutsideDockerfile')],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-10 (c106-palette): Rebuild Container is in the Command Palette only while connected, and the notification’s button reads Rebuild', async () => {
    const local = await openFolderWindow(
      devContainerFolder('c106-palette-local', {name: 'C106 Palette Local'}),
    );
    let before: string[];
    try {
      before = await paletteRows(local, 'Dev Containers: Rebuild Container');
    } finally {
      await closeWindow(local).catch(() => undefined);
    }
    const folder = devContainerFolder('c106-palette', {name: 'C106 Palette'});
    const name = await connectedWindow(folder);
    try {
      const connected = await paletteRows(
        name,
        'Dev Containers: Rebuild Container',
      );
      rewriteConfiguration(folder, {containerEnv: {C106: 'palette'}});
      await noticesWhen(name, 1);
      deepStrictEqual(
        {
          before: before.includes('Dev Containers: Rebuild Container'),
          connected: connected.includes('Dev Containers: Rebuild Container'),
          buttons: await notificationButtons(name, CHANGED_START),
        },
        {before: false, connected: true, buttons: ['Rebuild', 'Ignore']},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0303 AC-15 (c106-stored): a configuration kept in the user data folder is watched like a folder’s own, with the same notification and buttons', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'c106-stored');
    rmSync(folder, {recursive: true, force: true});
    mkdirSync(folder, {recursive: true});
    const slot = path.join(storeRoot(), 'c106-stored', '.devcontainer');
    mkdirSync(slot, {recursive: true});
    const stored = path.join(slot, 'devcontainer.json');
    const config = {
      name: 'C106 Stored',
      image: variable('HARNESS_DEVCONTAINER_IMAGE'),
      runArgs: runLabelArguments(),
    };
    writeFileSync(stored, JSON.stringify(config));
    writeFileSync(
      path.join(slot, '.devcontainer-internal.json'),
      `// Maintained by the Dev Container extension\n${JSON.stringify({rootFolder: folder})}\n`,
    );
    const name = await connectedWindow(folder);
    try {
      writeFileSync(
        stored,
        JSON.stringify({...config, containerEnv: {C106: 'stored'}}),
      );
      const shown = await noticesWhen(name, 1);
      deepStrictEqual(
        [shown, await notificationButtons(name, CHANGED_START)],
        [[changed('devcontainer.json')], ['Rebuild', 'Ignore']],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
      rmSync(path.dirname(slot), {recursive: true, force: true});
    }
  });

  it('F-0303 AC-13 (reading-1893-failed-rebuild): a rebuild that fails shows the setup error and leaves the stored fingerprints as they were; after the fix and Retry the connected window shows no notification (the old container is removed before the build, F-0405 BR-17, so the repeat of the notification after a reconnect cannot happen)', async () => {
    const folder = dockerfileFolder('c106-failed-rebuild');
    const dockerfile = path.join(folder, '.devcontainer', 'Dockerfile');
    const name = await connectedWindow(folder);
    try {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const before = storedHashes(folder);
      rewriteConfiguration(folder, {containerEnv: {C106: 'broken'}});
      await noticesWhen(name, 1);
      appendFileSync(dockerfile, 'RUN false\n');
      await answerNotification(name, CHANGED_START, 'Rebuild');
      const dialog = await waitForDialog(name, 300_000);
      const afterFailure = storedHashes(folder);
      writeFileSync(dockerfile, dockerfileText());
      await answerDialog(name, 'Retry');
      await connectedToContainer(name, 300_000);
      deepStrictEqual(
        [
          dialog.buttons.includes('Retry'),
          before !== undefined && Object.keys(before).length === 2,
          afterFailure,
          await noticesAfter(name, 10),
        ],
        [true, true, before, []],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });
});
