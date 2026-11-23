import {deepStrictEqual} from 'node:assert';
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  reloadWindow,
  variable,
} from '../windows/harness.ts';
import {answerNotification, notificationButtons} from '../windows/renderer.ts';
import {
  changed,
  CHANGED_START,
  clearNotifications,
  noticesAfter,
  noticesWhen,
  rewriteConfiguration,
} from '../windows/config-watch-support.ts';
import {
  builtServiceLines,
  composeFolder,
  openedCompose,
  removeComposeContainers,
} from '../windows/compose-support.ts';

/** The Dockerfile of the rows: the run's dev container image, nothing more. */
function dockerfileText(): string {
  return `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`;
}

/** Opens `folder` in its container and gives the window, after the container and the window have settled. */
async function connectedWindow(folder: string): Promise<string> {
  const {name} = await openedCompose(folder);
  await new Promise(resolve => setTimeout(resolve, 3000));
  return name;
}

/** Writes `text` as the file `relative` below `folder`, making its folder. */
function writeBelow(folder: string, relative: string, text: string): void {
  const file = path.join(folder, relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, text);
}

/** A compose file with the services `app`, built from `appBuild`, and `db`, built from `Df.db`, with an `env_file`. */
function composeText(name: string, appBuild: readonly string[]): string {
  return [
    'services:',
    ...builtServiceLines('app', appBuild, [
      '    volumes:',
      `      - "..:/workspaces/${name}"`,
    ]),
    ...builtServiceLines(
      'db',
      ['      context: ..', '      dockerfile: .devcontainer/Df.db'],
      ['    env_file: ../db.env'],
    ),
    '',
  ].join('\n');
}

/** The folder `name` whose app service is built from `appBuild`, with the Dockerfiles and the env file the rows edit. */
function builtFolder(name: string, appBuild: readonly string[]): string {
  const folder = composeFolder({
    name,
    place: 'devcontainer',
    composeText: composeText(name, appBuild),
  });
  for (const file of ['Df.app', 'Df.db']) {
    writeBelow(folder, path.join('.devcontainer', file), dockerfileText());
  }
  writeBelow(folder, 'Df.root', dockerfileText());
  writeBelow(folder, 'Dockerfile', dockerfileText());
  writeBelow(folder, 'db.env', 'A=1\n');
  return folder;
}

describe('the rebuild prompt for a Compose configuration (card containers-146)', function () {
  this.timeout(900_000);

  afterEach(async () => {
    await removeComposeContainers();
  });

  it('F-0303 AC-4, AC-6 (c146-files): the compose files written on the host show nothing for 40 s; after a reload they are named, and a configuration edit then names all three in code unit order', async () => {
    const folder = composeFolder({
      name: 'c146-files',
      place: 'devcontainer',
      overrideLines: [],
    });
    const name = await connectedWindow(folder);
    try {
      for (const file of ['docker-compose.yml', 'override.yml']) {
        appendFileSync(
          path.join(folder, '.devcontainer', file),
          '# a comment line\n',
        );
      }
      const live = await noticesAfter(name, 40);
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const afterReload = await noticesWhen(name, 1);
      rewriteConfiguration(folder, {containerEnv: {C146: 'one'}});
      const all = await noticesWhen(name, 2);
      deepStrictEqual(
        {live, afterReload, all},
        {
          live: [],
          afterReload: [changed('docker-compose.yml, override.yml')],
          all: [
            changed('devcontainer.json, docker-compose.yml, override.yml'),
            changed('docker-compose.yml, override.yml'),
          ],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-0303 AC-26 (c146-service): the Dockerfile the service builds from shows nothing live; after a reload it is named by its path from the configuration folder with Rebuild and Ignore, and another service’s Dockerfile and the env file add nothing', async () => {
    const folder = builtFolder('c146-service', [
      '      context: ..',
      '      dockerfile: .devcontainer/Df.app',
    ]);
    const name = await connectedWindow(folder);
    try {
      appendFileSync(
        path.join(folder, '.devcontainer', 'Df.app'),
        '# a comment line\n',
      );
      const live = await noticesAfter(name, 20);
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const afterReload = await noticesWhen(name, 1);
      const buttons = await notificationButtons(name, CHANGED_START);
      await answerNotification(name, CHANGED_START, 'Ignore');
      await clearNotifications(name);
      appendFileSync(
        path.join(folder, '.devcontainer', 'Df.db'),
        '# a comment line\n',
      );
      appendFileSync(path.join(folder, 'db.env'), 'B=2\n');
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      const others = await noticesAfter(name, 12);
      deepStrictEqual(
        {live, afterReload, buttons, others},
        {
          live: [],
          afterReload: [changed('Df.app')],
          buttons: ['Rebuild', 'Ignore'],
          others: [],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-0303 AC-27 (c146-moved): a service whose dockerfile was changed to another file names the new one, the departing one and the compose file together; the short form watches the Dockerfile of the context', async () => {
    const folder = builtFolder('c146-moved', [
      '      context: ..',
      '      dockerfile: .devcontainer/Df.app',
    ]);
    const name = await connectedWindow(folder);
    const seen: string[][] = [];
    try {
      writeFileSync(
        path.join(folder, '.devcontainer', 'docker-compose.yml'),
        composeText('c146-moved', [
          '      context: ..',
          '      dockerfile: Df.root',
        ]),
      );
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      seen.push(await noticesWhen(name, 1));
      await answerNotification(name, CHANGED_START, 'Ignore');
      await clearNotifications(name);
      writeFileSync(
        path.join(folder, '.devcontainer', 'docker-compose.yml'),
        composeText('c146-moved', ['      context: ..']),
      );
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      seen.push(await noticesWhen(name, 1));
      deepStrictEqual(seen, [
        [changed('../Df.root, Df.app, docker-compose.yml')],
        [changed('../Df.root, ../Dockerfile, docker-compose.yml')],
      ]);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });
});
