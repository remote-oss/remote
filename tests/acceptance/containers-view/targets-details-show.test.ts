import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  runLabelArguments,
  runScopedName,
  reopenInContainer,
  variable,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {
  chosen,
  docker,
  made,
  rowsWhen,
  viewed,
} from '../windows/dev-containers-view.ts';
import {
  notifications,
  paneExpanded,
  paneFocused,
  remoteExplorerSections,
  titleAction,
  toggleRow,
  togglePane,
  viewRows,
} from '../windows/renderer.ts';
import {
  activations,
  clearEarlierRows,
  openFolderWindow,
  removeContainers,
} from '../windows/folder-windows.ts';

/** The name of the Details section when it shows no container. */
const DETAILS_NAME = 'Details (Containers)';

/** How long a Show Details choice may last in a connected window, in milliseconds (F-0903 AC-28). */
const REVERT_MILLISECONDS = 20_000;

/** The sections of the Remote Explorer of window `name` titled `title`. */
async function sectionsTitled(name: string, title: string): Promise<number> {
  return (await remoteExplorerSections(name)).filter(each => each === title)
    .length;
}

/** Waits until window `name` has exactly one section titled `title`. */
function sectionShown(name: string, title: string): Promise<void> {
  return waitFor(
    `the section ${title} in window ${name}`,
    async () => (await sectionsTitled(name, title)) === 1,
    30_000,
  );
}

/** The rows of the section titled `title` in window `name`, each as its label, a colon and its description. */
async function rowsOf(name: string, title: string): Promise<string[]> {
  return (
    (await viewRows(name, title))?.map(each =>
      each.description === ''
        ? each.label
        : `${each.label}: ${each.description}`,
    ) ?? ['no section']
  );
}

/** Starts a container with no label of a dev container, named for the run, and gives its name. */
async function plain(
  base: string,
  extra: readonly string[] = [],
): Promise<string> {
  const container = runScopedName(base);
  await docker(
    'run',
    '-d',
    '--name',
    container,
    ...runLabelArguments(),
    ...extra,
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    'sleep',
    '600',
  );
  return container;
}

/** The name Docker keeps of the one dev container of `folder`, with its leading slash. */
async function ownName(folder: string): Promise<string> {
  const [container = ''] = await devContainersOf(folder);
  return docker('inspect', '--format', '{{.Name}}', container);
}

/** Waits until the Dev Containers view of window `name` lists no row labelled `label`. */
function rowGone(name: string, label: string): Promise<unknown> {
  return rowsWhen(name, rows => rows.every(each => each.label !== label));
}

describe('Show Details and the Details section’s single slot (card containers-109)', function () {
  this.timeout(600_000);

  beforeEach(async () => {
    await clearEarlierRows();
  });

  it('F-0903 AC-6 (show): Show Details on a row appears as one expanded, revealed section in the same window, with no new window and no reload, though the window cannot connect to the container', async () => {
    const base = 'ds-six';
    await made(base, ['sleep', '600']);
    await viewed(base);
    const windows = [windowNames().length, activations('local')];
    await chosen(base, 'Show Details');
    await sectionShown('local', base);
    deepStrictEqual(
      [
        await sectionsTitled('local', base),
        await paneExpanded('local', base),
        await paneFocused('local', base),
        (await rowsOf('local', base)).slice(0, 4),
        [windowNames().length, activations('local')],
      ],
      [
        1,
        true,
        true,
        [
          'Attributes',
          `Workspace: ${path.join(variable('HARNESS_RUN_FOLDER'), base)}`,
          `Name: /${runScopedName(base)}`,
          `Image: ${variable('HARNESS_DEVCONTAINER_IMAGE')}`,
        ],
        windows,
      ],
    );
  });

  it('F-0903 AC-9 (removed): a shown container that is removed from Docker leaves the section with the same rows and title, and no notification', async () => {
    const base = 'ds-nine';
    const container = await made(base, ['sleep', '600']);
    await viewed(base);
    await chosen(base, 'Show Details');
    await sectionShown('local', base);
    const before = await rowsOf('local', base);
    await docker('rm', '--force', container);
    await rowGone('local', base);
    await new Promise(resolve => setTimeout(resolve, 5_000));
    deepStrictEqual(
      [
        await rowsOf('local', base),
        await sectionsTitled('local', base),
        await notifications('local'),
      ],
      [before, 1, []],
    );
  });

  it('F-0903 AC-13 (own-configuration): the section of a container with no configuration has no Configuration row and no Mounts section; with a mount it has that mount alone', async () => {
    const bare = await plain('ds-bare');
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    await viewed(image);
    await chosen(image, 'Show Details');
    await sectionShown('local', image);
    const without = await rowsOf('local', image);
    await docker('rm', '--force', bare);
    await rowGone('local', image);
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'ds-bound');
    mkdirSync(folder, {recursive: true});
    await plain('ds-bound', ['--volume', `${folder}:/data`]);
    await viewed(image);
    await chosen(image, 'Show Details');
    await waitFor(
      'the Mounts section',
      async () => (await rowsOf('local', image)).includes('Mounts'),
      30_000,
    );
    deepStrictEqual(
      [without, await rowsOf('local', image)],
      [
        ['Attributes', `Name: /${runScopedName('ds-bare')}`, `Image: ${image}`],
        [
          'Attributes',
          `Name: /${runScopedName('ds-bound')}`,
          `Image: ${image}`,
          'Mounts',
          'Bind mount',
          `Source: ${folder}`,
          'Destination: /data',
        ],
      ],
    );
  });

  it('F-0903 AC-23 (replaced): in a window not connected to a container, Show Details on another container replaces the section, which then still shows it a minute later', async () => {
    await made('ds-first', ['sleep', '600']);
    await made('ds-second', ['sleep', '600']);
    await viewed('ds-first');
    await viewed('ds-second');
    await chosen('ds-first', 'Show Details');
    await sectionShown('local', 'ds-first');
    await chosen('ds-second', 'Show Details');
    await sectionShown('local', 'ds-second');
    const name = `Name: /${runScopedName('ds-second')}`;
    async function counts() {
      return [
        await sectionsTitled('local', 'ds-first'),
        await sectionsTitled('local', 'ds-second'),
        (await rowsOf('local', 'ds-second')).includes(name),
      ];
    }
    const now = await counts();
    await new Promise(resolve => setTimeout(resolve, 60_000));
    deepStrictEqual(
      [now, await counts()],
      [
        [0, 1, true],
        [0, 1, true],
      ],
    );
  });

  it('F-0903 AC-26 (collapsed): a collapsed section stays collapsed and unfocused when Show Details names another container, with no dialog or notification, and shows that container when expanded', async () => {
    await made('ds-old', ['sleep', '600']);
    await made('ds-new', ['sleep', '600']);
    await viewed('ds-old');
    await viewed('ds-new');
    await chosen('ds-old', 'Show Details');
    await sectionShown('local', 'ds-old');
    await togglePane('local', 'ds-old');
    await waitFor(
      'the section to collapse',
      async () => (await paneExpanded('local', 'ds-old')) === false,
      10_000,
    );
    await chosen('ds-new', 'Show Details');
    await sectionShown('local', 'ds-new');
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const collapsed = [
      await paneExpanded('local', 'ds-new'),
      await paneFocused('local', 'ds-new'),
      await notifications('local'),
      await sectionsTitled('local', 'ds-old'),
    ];
    await togglePane('local', 'ds-new');
    await waitFor(
      'the section to expand',
      async () => (await paneExpanded('local', 'ds-new')) === true,
      10_000,
    );
    await waitFor(
      'the rows of the new container',
      async () =>
        (await rowsOf('local', 'ds-new')).includes(
          `Name: /${runScopedName('ds-new')}`,
        ),
      30_000,
    );
    deepStrictEqual(collapsed, [false, false, [], 0]);
  });

  it('F-0903 AC-27 (expanded-again): Show Details on the container shown shows Attributes, Mounts and every mount row expanded again after the user collapsed Mounts', async () => {
    const base = 'ds-expand';
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), base);
    mkdirSync(folder, {recursive: true});
    await made(base, ['sleep', '600'], {
      extra: ['--volume', `${folder}:/data`],
    });
    await viewed(base);
    await chosen(base, 'Show Details');
    await waitFor(
      'the Mounts section',
      async () => (await rowsOf('local', base)).includes('Mounts'),
      30_000,
    );
    await rowsOf('local', base);
    async function expandedNow() {
      return (await viewRows('local', base))
        ?.filter(each =>
          ['Attributes', 'Mounts', 'Bind mount'].includes(each.label),
        )
        .map(each => [each.label, each.expanded]);
    }
    const fresh = await expandedNow();
    await toggleRow('local', base, 'Mounts');
    await waitFor(
      'Mounts to collapse',
      async () =>
        (await expandedNow())?.some(
          ([label, open]) => label === 'Mounts' && open === false,
        ) === true,
      10_000,
    );
    await chosen(base, 'Show Details');
    await waitFor(
      'Mounts to expand again',
      async () =>
        (await expandedNow())?.some(
          ([label, open]) => label === 'Mounts' && open === true,
        ) === true,
      30_000,
    );
    deepStrictEqual(
      [fresh, await expandedNow(), (await rowsOf('local', base)).slice(-3)],
      [
        [
          ['Attributes', true],
          ['Mounts', true],
          ['Bind mount', true],
        ],
        [
          ['Attributes', true],
          ['Mounts', true],
          ['Bind mount', true],
        ],
        ['Bind mount', `Source: ${folder}`, 'Destination: /data'],
      ],
    );
  });

  it('F-0903 AC-28 (revert): in a window connected to its own dev container, Show Details on an unrelated one is the only section, and within 20 seconds the section shows the window’s own container again', async () => {
    const base = 'ds-own';
    await made('ds-unrelated', ['sleep', '600']);
    const folder = devContainerFolder(base, {name: 'Details Own'});
    const connected = await openFolderWindow(folder);
    try {
      await reopenInContainer(connected);
      await connectedToContainer(connected);
      await viewed('ds-unrelated', connected);
      await chosen('ds-unrelated', 'Show Details', connected);
      await sectionShown(connected, 'ds-unrelated');
      const seen: number[] = [];
      const started = Date.now();
      await waitFor(
        'the section of the window’s own container',
        async () => {
          const unrelated = await sectionsTitled(connected, 'ds-unrelated');
          const own = await sectionsTitled(connected, base);
          seen.push(unrelated + own);
          return own === 1 && unrelated === 0;
        },
        REVERT_MILLISECONDS,
      );
      deepStrictEqual(
        [
          seen.every(count => count <= 1),
          Date.now() - started < REVERT_MILLISECONDS,
          (await rowsOf(connected, base)).slice(0, 2),
        ],
        [true, true, ['Attributes', `Name: ${await ownName(folder)}`]],
      );
    } finally {
      await closeWindow(connected).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0903 AC-29 (refresh): a Refresh of a section whose container was removed shows zero rows under Details (Containers) and no notification', async () => {
    const base = 'ds-refresh';
    const container = await made(base, ['sleep', '600']);
    await viewed(base);
    await chosen(base, 'Show Details');
    await sectionShown('local', base);
    await docker('rm', '--force', container);
    await rowGone('local', base);
    await titleAction('local', base, 'Refresh');
    await sectionShown('local', DETAILS_NAME);
    deepStrictEqual(
      [
        (await viewRows('local', DETAILS_NAME))?.length,
        await sectionsTitled('local', base),
        await notifications('local'),
      ],
      [0, 0, []],
    );
  });

  it('F-0903 AC-33 (labels): Show Details on a container with only the folder label is titled by the folder with a Workspace row and no Configuration row, and on one with only the configuration label is titled by its image with no origin row and that Configuration row', async () => {
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    await plain('ds-folder', ['--label', 'devcontainer.local_folder=/tmp/x']);
    await plain('ds-config', [
      '--label',
      'devcontainer.config_file=/tmp/y/devcontainer.json',
    ]);
    await viewed('x');
    await viewed(image);
    await chosen('x', 'Show Details');
    await sectionShown('local', 'x');
    await waitFor(
      'the rows of the folder container',
      async () => (await rowsOf('local', 'x')).length >= 4,
      30_000,
    );
    const folder = await rowsOf('local', 'x');
    await chosen(image, 'Show Details');
    await sectionShown('local', image);
    await waitFor(
      'the rows of the configuration container',
      async () => (await rowsOf('local', image)).length >= 4,
      30_000,
    );
    deepStrictEqual(
      [folder, await rowsOf('local', image)],
      [
        [
          'Attributes',
          'Workspace: /tmp/x',
          `Name: /${runScopedName('ds-folder')}`,
          `Image: ${image}`,
        ],
        [
          'Attributes',
          `Name: /${runScopedName('ds-config')}`,
          `Image: ${image}`,
          'Configuration: /tmp/y/devcontainer.json',
        ],
      ],
    );
  });
});
