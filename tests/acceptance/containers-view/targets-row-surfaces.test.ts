import {deepStrictEqual} from 'node:assert';
import {renameSync} from 'node:fs';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenInContainer,
  runScopedName,
  untitledDocuments,
  waitFor,
  windowNames,
  terminalNames,
} from '../windows/harness.ts';
import {
  chosen,
  docker,
  iconReaches,
  idOf,
  made,
  rowsWhen,
  viewed,
} from '../windows/dev-containers-view.ts';
import {
  type RowDetails,
  paneFocused,
  remoteExplorerSections,
  rowActionTitles,
  rowContextMenu,
  rowDetails,
  rowMenuAction,
  terminalText,
  titleAction,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/dev-containers-view.ts';
import {
  activations,
  clearEarlierRows,
  openFolderWindow,
  removeContainers,
} from '../windows/folder-windows.ts';

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

  it('F-0901 AC-6 (menu): the menu of an exited dev row and of a running one, seen from a window not connected to them, is Start, or Stop after them, with Show Details, Inspect, Show Container Log, the two Open in Container items and Remove', async () => {
    devContainerFolder('rs-menu-exited');
    devContainerFolder('rs-menu-running');
    await made('rs-menu-exited', ['true']);
    await made('rs-menu-running', ['sleep', '600']);
    await viewed('rs-menu-exited');
    await viewed('rs-menu-running');
    await iconReaches('local', 'rs-menu-running', 'vm-running');
    const menus: string[][] = [];
    for (const label of ['rs-menu-exited', 'rs-menu-running']) {
      menus.push(
        (await rowContextMenu('local', VIEW, label)).filter(
          item => item !== '',
        ),
      );
    }
    const running = (await rowDetails('local', VIEW))?.find(
      entry => entry.label === 'rs-menu-running',
    );
    deepStrictEqual(
      [menus, running?.icon, running?.ariaLabel],
      [
        [
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
            'Show Details',
            'Inspect',
            'Show Container Log',
            'Open in Container in Current Window',
            'Open in Container in New Window',
            'Stop Container',
            'Remove Container',
          ],
        ],
        'vm-running',
        `rs-menu-running (${runScopedName('rs-menu-running')}) Running, has actions`,
      ],
    );
  });

  it('F-0901 AC-10 (restarting): a crash-looping container shows the vm-outline icon, Start and no Stop in its menu, and a Restarting tooltip without "ago"', async () => {
    const base = 'c65-restarting';
    const container = await made(base, ['sh', '-c', 'exit 1'], {
      extra: ['--restart=always'],
    });
    try {
      await viewed(base);
      const rows = await rowsWhen('local', each =>
        (each.find(entry => entry.label === base)?.ariaLabel ?? '').includes(
          ' Restarting ',
        ),
      );
      const found = rows.find(entry => entry.label === base);
      const menu = (await rowContextMenu('local', VIEW, base)).filter(
        item => item !== '',
      );
      const tooltip = found?.ariaLabel ?? '';
      deepStrictEqual(
        [
          found?.icon,
          menu.includes('Start Container'),
          menu.includes('Stop Container'),
          new RegExp(
            `^${base} \\(${container}\\) Restarting \\d+ (second|seconds|minute)$`,
          ).exec(tooltip) !== null,
          tooltip.endsWith(' ago'),
        ],
        ['vm-outline', true, false, true, false],
      );
    } finally {
      await docker('rm', '--force', container).catch(() => undefined);
    }
  });

  it('F-0901 AC-42 (folder-moved): a dev container’s row loses its Open items when its folder is moved away and the list rebuilds, keeps them until it does, and gets them back after the folder returns', async () => {
    const base = 'c65-moved';
    const folder = devContainerFolder(base);
    const away = `${folder}-away`;
    const openItems = [
      'Open in Container in Current Window',
      'Open in Container in New Window',
    ];
    let window: string | undefined = await openFolderWindow(folder);
    let movedAway = false;
    try {
      await reopenInContainer(window);
      await closeWindow(window);
      window = undefined;
      const [container = ''] = await devContainersOf(folder);
      await viewed(base);
      await iconReaches('local', base, 'vm');
      const before = (await rowDetails('local', VIEW))?.find(
        entry => entry.label === base,
      );
      async function cleaned(label: string): Promise<string[]> {
        return (await rowContextMenu('local', VIEW, label)).filter(
          item => item !== '',
        );
      }
      function hasOpen(menu: string[]): boolean {
        return openItems.every(item => menu.includes(item));
      }
      function sameMenu(shown: string[], expected: readonly string[]): boolean {
        return (
          shown.length === expected.length &&
          expected.every((item, index) => shown[index] === item)
        );
      }
      // A Refresh click lands the rebuilt list asynchronously, so each read after one waits it out.
      async function rebuilt(
        label: string,
        menu: readonly string[],
        actions?: readonly string[],
      ): Promise<void> {
        await waitFor(
          `the row ${label} to rebuild`,
          async () => {
            if (!sameMenu(await cleaned(label), menu)) {
              return false;
            }
            return actions === undefined
              ? true
              : sameMenu(await rowActionTitles('local', VIEW, label), actions);
          },
          30_000,
        );
      }
      // The tooltip's elapsed clause is time itself, so the comparison ends at the state word.
      function tooltipState(value: string): string {
        return (
          new RegExp(
            '^(.*) (Running|Restarting|Exited|Created|Paused|Connected)',
          ).exec(value)?.[0] ?? value
        );
      }
      // The view section the row labelled `label` sits under: the last section header before it.
      function groupOf(rows: readonly RowDetails[], label: string): string {
        const rowAt = rows.findIndex(each => each.label === label);
        return (
          rows
            .slice(0, rowAt)
            .reverse()
            .find(
              each => each.label === VIEW || each.label === 'Other Containers',
            )?.label ?? ''
        );
      }
      const beforeMenu = await cleaned(base);
      renameSync(folder, away);
      movedAway = true;
      await new Promise(resolve => setTimeout(resolve, 3_000));
      const staleMenu = await cleaned(base);
      await titleAction('local', VIEW, 'Refresh');
      const withoutOpen = [
        'Start Container',
        'Show Details',
        'Inspect',
        'Show Container Log',
        'Remove Container',
      ];
      await rebuilt(base, withoutOpen);
      const withoutMenu = await cleaned(base);
      const rowsAfterMove = await rowDetails('local', VIEW);
      const afterMove = rowsAfterMove?.find(entry => entry.label === base);
      renameSync(away, folder);
      movedAway = false;
      await titleAction('local', VIEW, 'Refresh');
      const withOpen = [
        'Start Container',
        'Show Details',
        'Inspect',
        'Show Container Log',
        'Open in Container in Current Window',
        'Open in Container in New Window',
        'Remove Container',
      ];
      await rebuilt(base, withOpen);
      const restoredRows = await rowDetails('local', VIEW);
      const restoredMenu = await cleaned(base);
      await docker('start', container);
      await iconReaches('local', base, 'vm-running');
      renameSync(folder, away);
      movedAway = true;
      await titleAction('local', VIEW, 'Refresh');
      const runningWithoutOpen = [
        'Show Details',
        'Inspect',
        'Show Container Log',
        'Stop Container',
        'Remove Container',
      ];
      await rebuilt(base, runningWithoutOpen, ['Remove Container']);
      const runningMenu = await cleaned(base);
      deepStrictEqual(
        [
          hasOpen(beforeMenu),
          sameMenu(staleMenu, beforeMenu),
          withoutMenu,
          [
            afterMove?.label === before?.label,
            afterMove?.description === before?.description,
            afterMove?.icon,
            afterMove?.icon === before?.icon,
            tooltipState(afterMove?.ariaLabel ?? '') ===
              tooltipState(before?.ariaLabel ?? ''),
          ],
          [
            groupOf(rowsAfterMove ?? [], base),
            groupOf(restoredRows ?? [], base),
          ],
          hasOpen(restoredMenu),
          await rowActionTitles('local', VIEW, base),
          runningMenu,
        ],
        [
          true,
          true,
          [
            'Start Container',
            'Show Details',
            'Inspect',
            'Show Container Log',
            'Remove Container',
          ],
          [true, true, 'vm', true, true],
          [VIEW, VIEW],
          true,
          ['Remove Container'],
          [
            'Show Details',
            'Inspect',
            'Show Container Log',
            'Stop Container',
            'Remove Container',
          ],
        ],
      );
    } finally {
      if (movedAway) {
        renameSync(away, folder);
      }
      if (window !== undefined) {
        await closeWindow(window).catch(() => undefined);
      }
      await removeContainers(folder);
    }
  });
});
