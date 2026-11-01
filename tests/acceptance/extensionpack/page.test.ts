import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  activeSideBar,
  dialogOf,
  editorTabs,
  extensionHoverOf,
  extensionPageOf,
  extensionReadmeOf,
  extensionRowOf,
  extensionsViewSections,
  issueReporterExtensions,
  notifications,
  windowSizeOf,
} from '../windows/renderer.ts';

/** The pack's package folder. */
const PACKAGE_FOLDER = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'remote-extensionpack',
);

/** The pack's display name and the manifest's values the rows compare with. */
const PACK = 'Remote Development';
const MANIFEST = JSON.parse(
  readFileSync(path.join(PACKAGE_FOLDER, 'package.json'), 'utf8'),
) as {version: string; extensionPack: string[]};
const DESCRIPTION = (
  JSON.parse(
    readFileSync(path.join(PACKAGE_FOLDER, 'package.nls.json'), 'utf8'),
  ) as {description: string}
).description;

/** The text of the pack's README as the file holds it. */
const README = readFileSync(path.join(PACKAGE_FOLDER, 'README.md'), 'utf8');

/** A line of Markdown as it reads once rendered: the link text, no emphasis marks, white space collapsed. */
function plain(line: string): string {
  return line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The id of the pack, which anything it wrote of its own would carry. */
const PACK_ID = 'remote-oss.vscode-remote-extensionpack';

/** The paths below `folder` whose name carries the pack's id, except core's own cache of the VSIX files it installed. */
function pathsNamedAfterPack(folder: string): string[] {
  return readdirSync(folder, {recursive: true})
    .map(String)
    .filter(
      entry =>
        entry.toLowerCase().includes(PACK_ID) &&
        !entry.includes('CachedExtensionVSIXs'),
    );
}

/** The keys of the editor's state databases below `userData` that carry the pack's id. */
function stateKeysNamedAfterPack(userData: string): string[] {
  return readdirSync(path.join(userData, 'User'), {recursive: true})
    .map(String)
    .filter(entry => entry.endsWith('state.vscdb'))
    .flatMap(entry => {
      const database = new DatabaseSync(path.join(userData, 'User', entry), {
        readOnly: true,
      });
      try {
        return (
          database
            .prepare('SELECT key FROM ItemTable WHERE key LIKE ?')
            .all(`%${PACK_ID}%`) as Array<{key: string}>
        ).map(found => `${entry}: ${found.key}`);
      } finally {
        database.close();
      }
    });
}

/** What a README renders as, read from its Markdown: the headings, the links, the images and the list items. */
function markdownOf(text: string) {
  const lines = text.split('\n');
  const items: string[] = [];
  for (const [position, line] of lines.entries()) {
    if (!line.startsWith('- ')) {
      continue;
    }
    let item = line.slice(2);
    for (
      let next = position + 1;
      lines.at(next)?.startsWith('  ') === true;
      next += 1
    ) {
      item += ` ${lines.at(next) ?? ''}`;
    }
    items.push(plain(item));
  }
  return {
    headings: lines.flatMap((line): Array<[number, string]> => {
      const found = /^(#{1,6}) (.+)$/.exec(line);
      return found === null
        ? []
        : [[(found[1] ?? '').length, plain(found[2] ?? '')]];
    }),
    links: [...text.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)]
      .filter(found => !found[0].startsWith('!'))
      .map((found): [string, string] => [
        plain(found[1] ?? ''),
        found[2] ?? '',
      ]),
    images: [...text.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map(
      found => found[1] ?? '',
    ),
    items,
  };
}

describe('the extension pack in the Extensions view (card coverage-76)', function () {
  this.timeout(300_000);

  let window = '';

  before(async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensionpack-page',
    );
    mkdirSync(folder, {recursive: true});
    window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.includes(PACK),
        ),
      30_000,
    );
  });

  after(async () => {
    await closeWindow(window);
  });

  /** Shows the Installed list again, with no search, and waits for it to list the pack. */
  async function showInstalled(): Promise<void> {
    await inWindow(
      window,
      'workbench.extensions.action.clearExtensionsSearchResults',
    );
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.includes(PACK),
        ),
      30_000,
    );
  }

  /** The notifications and the dialog the window shows, which no row of the pack expects. */
  async function interruptions() {
    return {
      notifications: await notifications(window),
      dialog: await dialogOf(window),
    };
  }

  it('F-9001 AC-7, AC-16, F-9101 AC-25 (row): with no gallery data the pack’s row shows its name, its description and the publisher id, and nothing interrupts', async () => {
    await showInstalled();
    deepStrictEqual(
      {
        entry: await extensionRowOf(window, PACK),
        interrupted: await interruptions(),
      },
      {
        entry: {
          name: PACK,
          description: DESCRIPTION,
          publisher: 'remote-oss',
          badge: String(MANIFEST.extensionPack.length),
          actions: ['Manage'],
        },
        interrupted: {notifications: [], dialog: undefined},
      },
    );
  });

  it('F-9001 AC-8, AC-16 (hover): the hover of the row shows the name, the installed version, the full description and the hover hint', async () => {
    await showInstalled();
    deepStrictEqual(
      (await extensionHoverOf(window, PACK)).map(line =>
        line.replace(/\s+/g, ' '),
      ),
      [
        `${PACK} v${MANIFEST.version}`,
        DESCRIPTION,
        'Hold Alt key to mouse over',
      ],
    );
  });

  it('F-9001 AC-9, AC-16, F-9002 AC-2, AC-4, F-9101 AC-8, AC-15, AC-25 (page): the pack’s page opens in the current window with the title, the publisher id, the description, the two category chips and the Details and Features tabs, the member header above the README with every member in manifest order, the Disable, Uninstall and Manage actions and no Install, no Marketplace or Resources block, and nothing interrupts', async () => {
    await showInstalled();
    const page = await extensionPageOf(window, PACK);
    deepStrictEqual(
      {
        page: {...page, tabs: page.tabs.map(label => label.toUpperCase())},
        editors: (await editorTabs(window)).map(editor => editor.label),
        interrupted: await interruptions(),
      },
      {
        page: {
          title: PACK,
          publisher: 'remote-oss',
          description: DESCRIPTION,
          tabs: ['DETAILS', 'FEATURES'],
          categories: ['Other', 'Extension Packs'],
          blocks: ['Installation', 'Categories'],
          packHeader: `Extension Pack (${String(MANIFEST.extensionPack.length)})`,
          pack: ['Dev Containers', 'Remote - SSH'],
          packAboveReadme: true,
          actions: ['Disable this extension', 'Uninstall', 'Manage'],
        },
        editors: [`Extension: ${PACK}`],
        interrupted: {notifications: [], dialog: undefined},
      },
    );
  });

  /** The names the Extensions view lists for `query` in the Installed section, once the list has settled. */
  async function installedFor(query: string): Promise<string[]> {
    await inWindow(window, 'workbench.extensions.search', query);
    let names: string[] = [];
    let steady = 0;
    for (let attempt = 0; attempt < 40 && steady < 3; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const now = (await extensionsViewSections(window)).flatMap(
        section => section.entries,
      );
      steady = JSON.stringify(now) === JSON.stringify(names) ? steady + 1 : 0;
      names = now;
    }
    return names;
  }

  it('F-9001 AC-10 (category-search): the installed pack is listed for the Extension Packs category and for the Other category', async () => {
    deepStrictEqual(
      [
        (await installedFor('@installed @category:"extension packs"')).includes(
          PACK,
        ),
        (await installedFor('@installed @category:other')).includes(PACK),
      ],
      [true, true],
    );
  });

  it('F-9001 AC-11 (text-search): the installed pack is not listed for wsl, which its description does not name, nor for docker', async () => {
    deepStrictEqual(
      [
        DESCRIPTION.toLowerCase().includes('wsl'),
        (await installedFor('@installed wsl')).includes(PACK),
        (await installedFor('@installed docker')).includes(PACK),
      ],
      [false, false, false],
    );
  });

  it('F-9001 AC-14 (report-issue): the Issue Reporter, set to report on a VS Code extension, offers the pack in its Extension list', async () => {
    void inWindow(window, 'workbench.action.openIssueReporter').catch(
      () => undefined,
    );
    deepStrictEqual((await issueReporterExtensions()).includes(PACK), true);
  });

  it('F-9002 AC-3 (readme): the rendered README has the same headings, links, images and list items, in the same order, as README.md', async () => {
    await showInstalled();
    await extensionPageOf(window, PACK);
    const rendered = await extensionReadmeOf(window);
    deepStrictEqual(
      {
        headings: rendered.headings,
        links: rendered.links,
        images: rendered.images,
        items: rendered.items,
      },
      markdownOf(README),
    );
  });

  it('F-9002 AC-21 (readme-width): in a 1440 by 900 window with the side bar shown, no table or code block of the README needs horizontal scrolling, and every image fits', async () => {
    await showInstalled();
    await extensionPageOf(window, PACK);
    const rendered = await extensionReadmeOf(window);
    deepStrictEqual(
      {
        size: await windowSizeOf(window),
        sideBar: (await activeSideBar(window)).startsWith('Extensions'),
        fits: rendered.widths.every(([, fits]) => fits),
      },
      {size: '1440x900', sideBar: true, fits: true},
    );
  });

  it('F-9001 AC-18, F-9002 AC-19, F-9101 AC-19 (no-writes): after every flow of the rows, the pack has written no file, log folder, setting or state key of its own, and nothing interrupted', async () => {
    const userData = variable('HARNESS_USER_DATA');
    deepStrictEqual(
      {
        files: pathsNamedAfterPack(userData),
        logs: pathsNamedAfterPack(variable('HARNESS_EDITOR_LOGS')),
        scanned: readdirSync(variable('HARNESS_EDITOR_LOGS')).length > 0,
        settings: readFileSync(
          path.join(userData, 'User', 'settings.json'),
          'utf8',
        ).includes(PACK_ID),
        keys: stateKeysNamedAfterPack(userData),
        interrupted: await interruptions(),
      },
      {
        files: [],
        logs: [],
        scanned: true,
        settings: false,
        keys: [],
        interrupted: {notifications: [], dialog: undefined},
      },
    );
  });
});
