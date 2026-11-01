import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  devContainerFolder,
  inWindow,
  runLabelArguments,
  variable,
} from '../windows/harness.ts';
import {rowContextMenu, type RowDetails} from '../windows/renderer.ts';
import {rowsWhen, VIEW} from '../windows/dev-containers-view.ts';

const execFileAsync = promisify(execFile);

/** The two Open items of a row whose configuration exists (F-0901 BR-11). */
const OPEN_ITEMS = [
  'Open in Container in Current Window',
  'Open in Container in New Window',
];

/** The run's folder `name`, with nothing in it. */
function emptyFolder(name: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  mkdirSync(folder, {recursive: true});
  return folder;
}

/**
 * Makes container `containerName` directly with Docker, carrying `labels` and the run's own labels: `docker create`
 * for a Created one, `docker run` of `true` for one that has exited.
 */
async function labelledContainer(
  containerName: string,
  labels: Readonly<Record<string, string>>,
  state: 'created' | 'exited',
): Promise<void> {
  const labelArguments = Object.entries(labels).flatMap(([key, value]) => [
    '--label',
    `${key}=${value}`,
  ]);
  const image = variable('HARNESS_DEVCONTAINER_IMAGE');
  await execFileAsync(
    'docker',
    state === 'created'
      ? [
          'create',
          '--name',
          containerName,
          ...runLabelArguments(),
          ...labelArguments,
          image,
          'true',
        ]
      : [
          'run',
          '--name',
          containerName,
          ...runLabelArguments(),
          ...labelArguments,
          image,
          'true',
        ],
  );
}

/** The labels of row `rowLabel`'s context menu in the local window, without the separators. */
async function menuOf(rowLabel: string): Promise<string[]> {
  return (await rowContextMenu('local', VIEW, rowLabel)).filter(
    label => label !== '',
  );
}

/** Waits until the local window's view shows a row for every label of `labels`, and gives the rows. */
async function shownRows(labels: readonly string[]): Promise<RowDetails[]> {
  await inWindow('local', 'workbench.view.remote');
  return rowsWhen('local', rows =>
    labels.every(label => rows.some(each => each.label === label)),
  );
}

/** The row labelled `label`, of which `shownRows` guarantees one. */
function rowOf(rows: readonly RowDetails[], label: string): RowDetails {
  const theRow = rows.find(each => each.label === label);
  if (theRow === undefined) {
    throw new Error(`the view holds no row ${label}`);
  }
  return theRow;
}

/** Whether the row `label` sits under the view's Dev Containers header, before Other Containers if that is shown. */
function underDevContainers(
  rows: readonly RowDetails[],
  label: string,
): boolean {
  const rowAt = rows.findIndex(each => each.label === label);
  const devAt = rows.findIndex(each => each.label === VIEW);
  const otherAt = rows.findIndex(each => each.label === 'Other Containers');
  return rowAt > devAt && (otherAt === -1 || rowAt < otherAt);
}

describe('the menus of dev containers Docker made without the extension (card coverage-62)', function () {
  this.timeout(600_000);
  const made: string[] = [];

  afterEach(async () => {
    for (const name of made.splice(0)) {
      await execFileAsync('docker', ['rm', '-f', name]).catch(() => undefined);
    }
  });

  it('F-0901 AC-8 (created): a container Docker created but never started shows the vm icon, a Created tooltip and Start Container in its menu', async () => {
    const folder = devContainerFolder('c62-ac8');
    const name = 'c62-ac8-box';
    made.push(name);
    await labelledContainer(
      name,
      {'devcontainer.local_folder': folder},
      'created',
    );
    const rows = await shownRows(['c62-ac8']);
    const rowDetails = rowOf(rows, 'c62-ac8');
    const menu = await menuOf('c62-ac8');
    deepStrictEqual(
      [
        rowDetails.icon,
        rowDetails.ariaLabel.startsWith('c62-ac8 (c62-ac8-box) Created'),
        menu.includes('Start Container'),
        menu.includes('Stop Container'),
      ],
      ['vm', true, true, false],
    );
  });

  it('F-0901 AC-30 (never-opened): two exited containers labelled with a folder are dev containers, and only the one whose folder holds a configuration offers the Open items', async () => {
    const present = devContainerFolder('c62-ac30-present');
    const missing = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c62-ac30-missing',
    );
    made.push('c62-ac30-a', 'c62-ac30-b');
    await labelledContainer(
      'c62-ac30-a',
      {'devcontainer.local_folder': present},
      'exited',
    );
    await labelledContainer(
      'c62-ac30-b',
      {'devcontainer.local_folder': missing},
      'exited',
    );
    const rows = await shownRows(['c62-ac30-present', 'c62-ac30-missing']);
    const presentRow = rowOf(rows, 'c62-ac30-present');
    const missingRow = rowOf(rows, 'c62-ac30-missing');
    deepStrictEqual(
      [
        [
          underDevContainers(rows, 'c62-ac30-present'),
          underDevContainers(rows, 'c62-ac30-missing'),
        ],
        [presentRow.icon, missingRow.icon],
        presentRow.ariaLabel.startsWith('c62-ac30-present (c62-ac30-a) Exited'),
        missingRow.ariaLabel.startsWith('c62-ac30-missing (c62-ac30-b) Exited'),
        await menuOf('c62-ac30-present'),
        await menuOf('c62-ac30-missing'),
      ],
      [
        [true, true],
        ['vm', 'vm'],
        true,
        true,
        [
          'Start Container',
          'Show Details',
          'Inspect',
          'Show Container Log',
          ...OPEN_ITEMS,
          'Remove Container',
        ],
        [
          'Start Container',
          'Show Details',
          'Inspect',
          'Show Container Log',
          'Remove Container',
        ],
      ],
    );
  });

  it('F-0901 AC-31 (repository): an exited container labelled with a repository is a dev container and offers the Open items', async () => {
    const name = 'c62-ac31-a';
    made.push(name);
    await labelledContainer(
      name,
      {
        'vsch.local.repository':
          'https://example.test/remote-oss/c62-ac31-repo',
      },
      'exited',
    );
    const rows = await shownRows(['c62-ac31-repo']);
    rowOf(rows, 'c62-ac31-repo');
    const menu = await menuOf('c62-ac31-repo');
    deepStrictEqual(
      [
        underDevContainers(rows, 'c62-ac31-repo'),
        OPEN_ITEMS.every(item => menu.includes(item)),
      ],
      [true, true],
    );
  });

  it('F-0901 AC-43 (configuration-cases): the Open items follow the configuration a folder label points at, in five cases', async () => {
    const cases = [
      {letter: 'a', folder: emptyFolder('c62-ac43-a')},
      {letter: 'b', folder: emptyFolder('c62-ac43-b')},
      {letter: 'c', folder: emptyFolder('c62-ac43-c')},
      {letter: 'd', folder: devContainerFolder('c62-ac43-d')},
      {letter: 'e', folder: devContainerFolder('c62-ac43-e')},
    ];
    for (const each of cases) {
      if (each.letter === 'b') {
        writeFileSync(path.join(each.folder, '.devcontainer.json'), '{}');
      }
      if (each.letter === 'c') {
        mkdirSync(path.join(each.folder, '.devcontainer'), {recursive: true});
        writeFileSync(
          path.join(each.folder, '.devcontainer', 'other.json'),
          '{}',
        );
      }
      if (each.letter === 'e') {
        writeFileSync(
          path.join(each.folder, '.devcontainer', 'devcontainer.json'),
          '{ not json',
        );
      }
    }
    made.push(...cases.map(each => `c62-ac43-${each.letter}-box`));
    for (const each of cases) {
      const labels: Record<string, string> = {
        'devcontainer.local_folder': each.folder,
      };
      if (each.letter === 'c') {
        labels['devcontainer.config_file'] = path.join(
          each.folder,
          '.devcontainer',
          'other.json',
        );
      }
      if (each.letter === 'd') {
        labels['devcontainer.config_file'] = path.join(
          each.folder,
          '.devcontainer',
          'gone.json',
        );
      }
      await labelledContainer(`c62-ac43-${each.letter}-box`, labels, 'exited');
    }
    await shownRows(cases.map(each => `c62-ac43-${each.letter}`));
    // One context menu fits one window at a time, so the reads go one after another.
    const menus: string[][] = [];
    for (const each of cases) {
      menus.push(await menuOf(`c62-ac43-${each.letter}`));
    }
    const seen = cases.map((each, index) => {
      const menu = menus[index] ?? [];
      return [
        OPEN_ITEMS.every(item => menu.includes(item)),
        OPEN_ITEMS.some(item => menu.includes(item)) ===
          OPEN_ITEMS.every(item => menu.includes(item)),
      ];
    });
    deepStrictEqual(seen, [
      [false, true],
      [true, true],
      [true, true],
      [false, true],
      [true, true],
    ]);
  });
});
