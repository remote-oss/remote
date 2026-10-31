import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readdirSync, readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {
  clearEarlierRows,
  openFolderWindow,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  inWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  activeSideBar,
  extensionCard,
  extensionsViewSections,
  statusItem,
  titleActions,
  welcomeLinks,
  welcomeText,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/dev-containers-view.ts';

/** The manifest of Dev Containers, whose default strings the card shows. */
const PACKAGE = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'remote-containers',
);

/** An empty folder of the run, for a window that has no dev container configuration. */
function plainFolder(): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'c57-plain');
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** The default string `key` of the package's manifest. */
function defaultString(key: string): string {
  const strings = JSON.parse(
    readFileSync(path.join(PACKAGE, 'package.nls.json'), 'utf8'),
  ) as Record<string, string>;
  return strings[key] ?? '';
}

/** The keys that every state database of the launch's profile and workspaces holds. */
function storedKeys(): string[] {
  const user = path.join(variable('HARNESS_USER_DATA'), 'User');
  const workspaces = path.join(user, 'workspaceStorage');
  const files = [
    path.join(user, 'globalStorage', 'state.vscdb'),
    ...(existsSync(workspaces)
      ? readdirSync(workspaces).map(folder =>
          path.join(workspaces, folder, 'state.vscdb'),
        )
      : []),
  ].filter(file => existsSync(file));
  return files.flatMap(file => {
    const database = new DatabaseSync(file, {readOnly: true});
    try {
      return (
        database.prepare('SELECT key FROM ItemTable').all() as Array<{
          key: string;
        }>
      ).map(each => each.key);
    } finally {
      database.close();
    }
  });
}

describe('the Remote Explorer view’s own surfaces (card coverage-57)', function () {
  this.timeout(600_000);

  beforeEach(clearEarlierRows);

  // This row must run before any row that selects an option of the Switch Remote dropdown, which stores the key.
  it('F-0906 AC-1 (fresh-window): a fresh local window on a folder opens on the Explorer, with the status bar host item empty and no remote.explorerType key in the profile or the workspace storage', async () => {
    const name = await openFolderWindow(
      devContainerFolder('c57-fresh', {name: 'Fresh'}),
    );
    try {
      await waitFor(
        'the side bar',
        async () => (await activeSideBar(name)) !== '',
        30_000,
      );
      const host = await statusItem(name, 'status.host');
      deepStrictEqual(
        [
          (await activeSideBar(name)).replace(/ \(.*\)$/, ''),
          host.text,
          host.ariaLabel,
          storedKeys().includes('remote.explorerType'),
        ],
        ['Explorer', '', 'remote', false],
      );
    } finally {
      await closeWindow(name);
    }
  });

  it('F-0101 AC-4 (extension-card): in an empty window, a plain folder and a configuration folder the Extensions card of Dev Containers shows its own name, publisher and description, no Microsoft icon, and an activation time', async () => {
    const windows = [
      'local',
      await openFolderWindow(plainFolder()),
      await openFolderWindow(
        devContainerFolder('c57-card-config', {name: 'Card Config'}),
      ),
    ];
    const cards: unknown[] = [];
    try {
      for (const window of windows) {
        await inWindow(window, 'workbench.view.extensions');
        await waitFor(
          'the card of Dev Containers',
          async () =>
            (await extensionsViewSections(window)).some(section =>
              section.entries.includes('Dev Containers'),
            ),
          30_000,
        );
        const card = await extensionCard(window, 'Dev Containers');
        cards.push({
          name: card.name,
          publisher: card.publisher,
          description: card.description,
          microsoftIcon: /microsoft|ms-vscode/i.test(card.iconSource),
          badge: /^\d+\s*ms$/.test(card.badge ?? ''),
        });
      }
    } finally {
      for (const window of windows.slice(1)) {
        await closeWindow(window);
      }
    }
    deepStrictEqual(
      cards,
      windows.map(() => ({
        name: 'Dev Containers',
        publisher: 'remote-oss',
        description: defaultString('description'),
        microsoftIcon: false,
        badge: true,
      })),
    );
  });

  it('F-0901 AC-16 (release-1-words): with the extension’s Docker connection unreachable the view has no title actions and shows the welcome text, whose one link is Refresh, with no cloning paragraph', async () => {
    await setUserSetting('dev.containers.dockerPath', '/nonexistent/docker');
    try {
      const name = await openFolderWindow(
        devContainerFolder('c57-no-docker', {name: 'No Docker'}),
      );
      try {
        await inWindow(name, 'workbench.view.remote');
        let words: string | undefined;
        await waitFor(
          'the welcome text',
          async () => {
            words = await welcomeText(name, VIEW).catch(() => undefined);
            return words !== undefined;
          },
          60_000,
        );
        await waitFor(
          'the title actions to go',
          async () => (await titleActions(name, VIEW)).length === 0,
          10_000,
        );
        deepStrictEqual(
          [
            await titleActions(name, VIEW),
            words?.replace(/\s+/g, ' ').trim(),
            await welcomeLinks(name, VIEW),
            /clon/i.test(words ?? ''),
          ],
          [
            [],
            'Get started with containers by installing Docker or by visiting the help view. Refresh after installation and startup.',
            ['Refresh'],
            false,
          ],
        );
      } finally {
        await closeWindow(name);
      }
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });
});
