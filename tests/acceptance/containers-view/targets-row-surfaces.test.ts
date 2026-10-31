import {deepStrictEqual} from 'node:assert';
import {
  inWindow,
  untitledDocuments,
  waitFor,
  windowNames,
  terminalNames,
} from '../windows/harness.ts';
import {chosen, docker, idOf, made, viewed} from '../windows/container-rows.ts';
import {
  paneFocused,
  remoteExplorerSections,
  rowContextMenu,
  rowDetails,
  rowMenuAction,
  terminalText,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/dev-containers-view.ts';
import {activations, clearEarlierRows} from '../windows/folder-windows.ts';

/** Closes the active editor without asking about its unsaved changes: the untitled tabs a row opened. */
async function discardTabs(count: number): Promise<void> {
  for (let closed = 0; closed < count; closed += 1) {
    await inWindow('local', 'workbench.action.revertAndCloseActiveEditor');
  }
}

/** The untitled documents of the local window, once there are `count` of them. */
async function untitledOnceThereAre(count: number) {
  await waitFor(
    `${String(count)} untitled documents`,
    async () => (await untitledDocuments('local')).length >= count,
    30_000,
  );
  return untitledDocuments('local');
}

/** The sections of the Remote Explorer that are titled `title`. */
async function sectionsTitled(title: string): Promise<number> {
  return (await remoteExplorerSections('local')).filter(each => each === title)
    .length;
}

describe('Show Details, Inspect and Show Container Log from a row (card containers-104)', function () {
  this.timeout(600_000);

  beforeEach(async () => {
    await clearEarlierRows();
    await inWindow('local', 'notifications.clearAll');
  });

  it('F-0902 AC-11 (inspect-twice): Inspect on a container row opens a new untitled, dirty JSON tab each time, holding the container’s inspect data as one object indented with tabs', async () => {
    const base = 'rs-inspect';
    const container = await made(base, ['sleep', '600']);
    const containerId = await idOf(container);
    await viewed(base);
    const before = (await untitledDocuments('local')).length;
    await chosen(base, 'Inspect');
    await chosen(base, 'Inspect');
    const opened = (await untitledOnceThereAre(before + 2)).slice(before);
    try {
      deepStrictEqual(
        opened.map(each => {
          const parsed: unknown = JSON.parse(each.text);
          return [
            each.uri.startsWith('untitled:'),
            each.language,
            each.dirty,
            typeof parsed === 'object' &&
              parsed !== null &&
              !Array.isArray(parsed) &&
              (parsed as {Id?: unknown}).Id === containerId,
            each.text.split('\n')[1]?.startsWith('\t') === true,
          ];
        }),
        [
          [true, 'json', true, true, true],
          [true, 'json', true, true, true],
        ],
      );
    } finally {
      await discardTabs(2);
    }
  });

  it('F-0902 AC-13, AC-28 (show-details): Show Details on a row of a container the window does not hold gives a Details section titled with the row’s label and the focus, with no new window and no reload, and a second click leaves exactly one section', async () => {
    const base = 'rs-details';
    await made(base, ['sleep', '600']);
    await viewed(base);
    const windows = [windowNames().length, activations('local')];
    await chosen(base, 'Show Details');
    await waitFor(
      'the Details section',
      async () => (await sectionsTitled(base)) === 1,
      30_000,
    );
    const first = [
      await sectionsTitled(base),
      await paneFocused('local', base),
      (await rowDetails('local', base))
        ?.map(each => each.label)
        .includes('Image'),
    ];
    await chosen(base, 'Show Details');
    await new Promise(resolve => setTimeout(resolve, 2_000));
    deepStrictEqual(
      [
        first,
        await sectionsTitled(base),
        await paneFocused('local', base),
        [windowNames().length, activations('local')],
      ],
      [[1, true, true], 1, true, windows],
    );
  });

  it('F-0902 AC-40 (image-half): Inspect on the Image row of a Details section opens an untitled, dirty JSON tab with the image’s inspect object, and the other rows offer no Inspect', async () => {
    const base = 'rs-image';
    await made(base, ['sleep', '600']);
    await viewed(base);
    await chosen(base, 'Show Details');
    await waitFor(
      'the Details section',
      async () => (await sectionsTitled(base)) === 1,
      30_000,
    );
    const others = await rowContextMenu('local', base, 'Name');
    const before = (await untitledDocuments('local')).length;
    await rowMenuAction('local', base, 'Image', 'Inspect');
    const [image] = (await untitledOnceThereAre(before + 1)).slice(before);
    try {
      const parsed = JSON.parse(image?.text ?? 'null') as {
        Id?: unknown;
        RepoTags?: unknown;
      } | null;
      deepStrictEqual(
        [
          others.includes('Inspect'),
          image?.dirty,
          image?.language,
          typeof parsed?.Id,
          Array.isArray(parsed?.RepoTags),
        ],
        [false, true, 'json', 'string', true],
      );
    } finally {
      await discardTabs(1);
    }
  });

  it('F-0902 AC-38 (log-after-stop): a log terminal follows a running container, and when the container stops it keeps the output, stays open with no exit message and shows nothing more even when the container starts again; on the exited row the log up to the exit shows', async () => {
    const base = 'rs-log';
    const container = await made(base, [
      'sh',
      '-c',
      'echo started-once; sleep 600',
    ]);
    const image = await docker('inspect', '-f', '{{.Config.Image}}', container);
    await viewed(base);
    const terminalsBefore = (await terminalNames('local')).length;
    await chosen(base, 'Show Container Log');
    await waitFor(
      'the log terminal',
      async () => (await terminalNames('local')).length > terminalsBefore,
      30_000,
    );
    await waitFor(
      'the log in the terminal',
      async () => (await terminalText('local')).includes('started-once'),
      30_000,
    );
    await docker('stop', '-t', '0', container);
    await new Promise(resolve => setTimeout(resolve, 3_000));
    await docker('start', container);
    await new Promise(resolve => setTimeout(resolve, 5_000));
    const followed = await terminalText('local');
    const names = await terminalNames('local');
    await docker('stop', '-t', '0', container);
    await new Promise(resolve => setTimeout(resolve, 3_000));
    await chosen(base, 'Show Container Log');
    await waitFor(
      'the log of the exited container',
      async () => (await terminalNames('local')).length > terminalsBefore + 1,
      30_000,
    );
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const recorded = await terminalText('local');
    deepStrictEqual(
      [
        followed.split('started-once').length - 1,
        /exit|terminated|\[Process/i.test(followed),
        names.slice(terminalsBefore),
        recorded.includes('started-once'),
      ],
      [1, false, [image], true],
    );
  });

  // The Open in Container items are in the menu from containers-103.
  it.skip('F-0901 AC-6 (menu): the menu of an exited dev row and of a running one, seen from a window not connected to them, is Start or Stop, Show Details, Inspect, Show Container Log, the two Open in Container items and Remove', async () => {
    await made('rs-menu-exited', ['true']);
    await made('rs-menu-running', ['sleep', '600']);
    await viewed('rs-menu-exited');
    await viewed('rs-menu-running');
    const menus = [];
    for (const label of ['rs-menu-exited', 'rs-menu-running']) {
      menus.push(
        (await rowContextMenu('local', VIEW, label)).filter(
          item => item !== '',
        ),
      );
    }
    deepStrictEqual(menus, [
      [
        'Start Container',
        'Show Details',
        'Inspect',
        'Show Container Log',
        'Open in Container in Current Window',
        'Open in Container in New Window',
        'Remove Container',
      ],
      [
        'Stop Container',
        'Show Details',
        'Inspect',
        'Show Container Log',
        'Open in Container in Current Window',
        'Open in Container in New Window',
        'Remove Container',
      ],
    ]);
  });
});
