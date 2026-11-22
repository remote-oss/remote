import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  activeEditorTextOf,
  inWindow,
  runLabelArguments,
  runScopedName,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  notificationCentre,
  pressEscape,
  rowContextMenu,
  rowDetails,
  type RowDetails,
  rowMenuAction,
  waitForDialog,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The name of the view. */
const VOLUMES = 'Dev Volumes';

/** The label that makes a volume the extension's own unique one, and the one that names its repository. */
const UNIQUE = 'vsch.local.repository.unique';
const REPOSITORY = 'vsch.local.repository';

/** What `docker <argv>` printed, trimmed. */
async function docker(...argv: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', argv);
  return stdout.trim();
}

/** Whether Docker has a volume by that name. */
async function exists(volume: string): Promise<boolean> {
  return docker('volume', 'inspect', volume).then(
    () => true,
    () => false,
  );
}

/** Makes the volume `base`, scoped to the run, with the labels; gives its name. */
async function made(
  base: string,
  labels: Readonly<Record<string, string>> = {},
): Promise<string> {
  const volume = runScopedName(base);
  await docker(
    'volume',
    'create',
    ...Object.entries(labels).flatMap(([key, value]) => [
      '--label',
      `${key}=${value}`,
    ]),
    volume,
  );
  return volume;
}

/** The rows of the Dev Volumes view of the local window that `ready` accepts. */
async function rowsWhen(
  ready: (rows: RowDetails[]) => boolean,
  milliseconds = 60_000,
): Promise<RowDetails[]> {
  await inWindow('local', 'workbench.view.remote');
  let shown: RowDetails[] = [];
  await waitFor(
    `the rows of ${VOLUMES} in the local window`,
    async () => {
      try {
        shown = (await rowDetails('local', VOLUMES)) ?? [];
      } catch {
        return false;
      }
      return ready(shown);
    },
    milliseconds,
  );
  return shown;
}

/** Waits until the view lists a row labelled `label`. */
function listing(label: string): Promise<RowDetails[]> {
  return rowsWhen(rows => rows.some(each => each.label === label));
}

/** Whether the notification centre of the local window holds a message that starts with `start`. */
async function notified(start: string): Promise<boolean> {
  return (await notificationCentre('local')).some(text =>
    text.startsWith(start),
  );
}

describe('the Dev Volumes view (card containers-167)', function () {
  this.timeout(600_000);
  const volumes: string[] = [];
  const containers: string[] = [];

  async function volumeMade(
    base: string,
    labels: Readonly<Record<string, string>> = {},
  ): Promise<string> {
    const volume = await made(base, labels);
    volumes.push(volume);
    return volume;
  }

  afterEach(async () => {
    for (const container of containers.splice(0)) {
      await docker('rm', '-f', container).catch(() => undefined);
    }
    for (const volume of volumes.splice(0)) {
      await docker('volume', 'rm', '-f', volume).catch(() => undefined);
    }
  });

  it('F-0904 AC-5, AC-6 (c167-labels): a unique volume with any GitHub shape is labelled owner/repo in the value’s case, and an owner-only URL, another host, a non-GitHub source, a plain volume and a GitHub address that is not unique keep the raw Docker name', async () => {
    const shapes = [
      'https://github.com/Octocat/Linguist',
      'https://github.com/Octocat/Linguist.git',
      'https://github.com/Octocat/Linguist/',
      'http://github.com/Octocat/Linguist',
      'https://www.github.com/Octocat/Linguist',
      'https://GitHub.com/Octocat/Linguist',
      'https://github.com/Octocat/Linguist/tree/main',
      'git@github.com:Octocat/Linguist.git',
      'ssh://git@github.com/Octocat/Linguist.git',
    ];
    /**
     * The labels of the newest rows once volumes made with `specs` are in the view; the view draws only a few rows, and
     * the volumes made last are listed first. It waits for `expected`, and gives what the view shows when that never comes.
     */
    async function labelsOf(
      specs: ReadonlyArray<[string, Record<string, string>]>,
      expected: readonly string[],
    ): Promise<string[]> {
      // One second apart, so that no volume of an earlier batch ties with these in the view's order.
      await new Promise(resolve => setTimeout(resolve, 1500));
      for (const [base, labels] of specs) {
        await volumeMade(base, labels);
      }
      function newest(rows: RowDetails[]): string[] {
        return rows
          .slice(0, specs.length)
          .map(each => each.label)
          .sort();
      }
      const wanted = [...expected].sort();
      const rows = await rowsWhen(
        shown => newest(shown).join('\n') === wanted.join('\n'),
        15_000,
      ).catch(() => rowDetails('local', VOLUMES).then(shown => shown ?? []));
      return newest(rows);
    }
    function unique(value: string): Record<string, string> {
      return {[UNIQUE]: 'true', [REPOSITORY]: value};
    }
    const shapeLabels: string[][] = [];
    for (let start = 0; start < shapes.length; start += 3) {
      const batch = shapes.slice(start, start + 3);
      shapeLabels.push(
        await labelsOf(
          batch.map((value, index) => [
            `c167-shape-${String(start + index)}`,
            unique(value),
          ]),
          batch.map(() => 'Octocat/Linguist'),
        ),
      );
    }
    const keptSpecs: Array<[string, Record<string, string>]> = [
      ['c167-owner-only', unique('https://github.com/Octocat')],
      [
        'c167-enterprise',
        unique('https://github.example.com/Octocat/Linguist'),
      ],
      ['c167-elsewhere', unique('git://example.invalid/some/repo.git')],
      [
        'c167-notunique',
        {
          [UNIQUE]: 'false',
          [REPOSITORY]: 'https://github.com/Octocat/Linguist',
        },
      ],
      ['c167-plain', {}],
    ];
    const keptLabels = [
      ...(await labelsOf(
        keptSpecs.slice(0, 3),
        keptSpecs.slice(0, 3).map(([base]) => runScopedName(base)),
      )),
      ...(await labelsOf(
        keptSpecs.slice(3),
        keptSpecs.slice(3).map(([base]) => runScopedName(base)),
      )),
    ];
    deepStrictEqual(
      [shapeLabels.flat(), keptLabels.sort()],
      [
        shapes.map(() => 'Octocat/Linguist'),
        keptSpecs.map(([base]) => runScopedName(base)).sort(),
      ],
    );
  });

  it('F-0904 AC-15 (c167-order): the rows are newest first', async () => {
    const first = await volumeMade('c167-older');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const second = await volumeMade('c167-newer');
    const rows = await rowsWhen(shown =>
      [first, second].every(label => shown.some(each => each.label === label)),
    );
    const labels = rows.map(each => each.label);
    deepStrictEqual(labels.indexOf(second) < labels.indexOf(first), true);
  });

  it('F-0904 AC-33 (c167-names): no row for vscode, and none for a name of exactly 64 hexadecimal digits in any case, while 63 digits, a prefix before 64 digits and a normal name with the anonymous label are rows', async () => {
    await docker('volume', 'create', 'vscode');
    const lower = 'ab'.repeat(32);
    const upper = 'AB'.repeat(32);
    const short = `${'ab'.repeat(31)}a`;
    const prefixed = `c167-${runScopedName('p')}-${lower}`;
    for (const name of [lower, upper, short, prefixed]) {
      await docker('volume', 'create', name);
      volumes.push(name);
    }
    const anonymous = await volumeMade('c167-anonymous', {
      'com.docker.volume.anonymous': '',
    });
    const rows = await rowsWhen(shown =>
      [short, prefixed, anonymous].every(label =>
        shown.some(each => each.label === label),
      ),
    );
    const labels = rows.map(each => each.label);
    deepStrictEqual(
      [
        labels.includes('vscode'),
        labels.includes(lower),
        labels.includes(upper),
        labels.includes(short),
        labels.includes(prefixed),
        labels.includes(anonymous),
      ],
      [false, false, false, true, true, true],
    );
  });

  it('F-0904 AC-9, AC-17 (c167-remove): Remove on an unused volume asks with the raw name, Cancel deletes nothing and Remove deletes the volume and its row', async () => {
    const volume = await volumeMade('c167-remove', {
      [UNIQUE]: 'true',
      [REPOSITORY]: 'https://github.com/Octocat/Hello-World',
    });
    await listing('Octocat/Hello-World');
    const menu = await rowContextMenu('local', VOLUMES, 'Octocat/Hello-World');
    const noticesBefore = await notificationCentre('local');
    await rowMenuAction('local', VOLUMES, 'Octocat/Hello-World', 'Remove');
    const asked = await waitForDialog('local', 60_000);
    await answerDialog('local', 'Cancel');
    const keptAfterCancel = await exists(volume);
    await rowMenuAction('local', VOLUMES, 'Octocat/Hello-World', 'Remove');
    await waitForDialog('local', 60_000);
    await pressEscape('local');
    const keptAfterEscape = await exists(volume);
    await rowMenuAction('local', VOLUMES, 'Octocat/Hello-World', 'Remove');
    await waitForDialog('local', 60_000);
    await answerDialog('local', 'Remove');
    await waitFor(
      'the volume to be removed',
      async () => !(await exists(volume)),
      60_000,
    );
    const rows = await rowsWhen(
      shown => !shown.some(each => each.label === 'Octocat/Hello-World'),
    );
    deepStrictEqual(
      [
        menu.includes('Inspect'),
        menu.includes('Remove'),
        asked.message,
        asked.details,
        asked.buttons.slice().sort(),
        [keptAfterCancel, keptAfterEscape],
        rows.some(each => each.label === 'Octocat/Hello-World'),
        await notificationCentre('local'),
      ],
      [
        true,
        true,
        '',
        `Are you sure you want to remove volume '${volume}'?`,
        ['Cancel', 'Remove'],
        [true, true],
        false,
        noticesBefore,
      ],
    );
  });

  it('F-0904 AC-10 (c167-in-use): Remove on a volume a created container mounts and on one a running container mounts shows only the in-use dialog with its OK button, and removes nothing', async () => {
    const shown: Array<[string, string, string[], boolean]> = [];
    for (const state of ['created', 'running']) {
      const volume = await volumeMade(`c167-inuse-${state}`);
      const container = runScopedName(`c167-inuse-${state}-box`);
      containers.push(container);
      await docker(
        state === 'created' ? 'create' : 'run',
        ...(state === 'created' ? [] : ['-d']),
        '--name',
        container,
        ...runLabelArguments(),
        '-v',
        `${volume}:/data`,
        variable('HARNESS_DEVCONTAINER_IMAGE'),
        ...(state === 'created' ? ['true'] : ['sleep', '600']),
      );
      await listing(volume);
      await rowMenuAction('local', VOLUMES, volume, 'Remove');
      const asked = await waitForDialog('local', 60_000);
      await answerDialog('local', 'OK');
      shown.push([
        asked.message,
        asked.details,
        asked.buttons,
        await exists(volume),
      ]);
      await docker('rm', '-f', container);
    }
    deepStrictEqual(
      shown,
      ['created', 'running'].map(state => [
        '',
        `Volume '${runScopedName(`c167-inuse-${state}`)}' is in use and cannot be removed.`,
        ['OK'],
        true,
      ]),
    );
  });

  it('F-0904 AC-14 (c167-vanished): a volume removed outside while the confirmation is open gives no error, no dialog and no notification when Remove is clicked, and the row is gone', async () => {
    const volume = await volumeMade('c167-vanished');
    await listing(volume);
    await rowMenuAction('local', VOLUMES, volume, 'Remove');
    await waitForDialog('local', 60_000);
    await docker('volume', 'rm', volume);
    await answerDialog('local', 'Remove');
    const rows = await rowsWhen(
      shown => !shown.some(each => each.label === volume),
    );
    deepStrictEqual(
      [
        rows.some(each => each.label === volume),
        await notified('Error removing volume'),
      ],
      [false, false],
    );
  });

  it('F-0904 AC-28 (c167-refused): a container that starts using the volume while the confirmation is open makes Remove an error notification with Docker’s text, and the volume and its row stay', async () => {
    const volume = await volumeMade('c167-refused');
    const container = runScopedName('c167-refused-box');
    containers.push(container);
    await listing(volume);
    await rowMenuAction('local', VOLUMES, volume, 'Remove');
    await waitForDialog('local', 60_000);
    await docker(
      'create',
      '--name',
      container,
      ...runLabelArguments(),
      '-v',
      `${volume}:/data`,
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'true',
    );
    await answerDialog('local', 'Remove');
    await waitFor(
      'the error notification of the failed removal',
      () => notified('Error removing volume: '),
      60_000,
    );
    const rows = await rowsWhen(shown =>
      shown.some(each => each.label === volume),
    );
    deepStrictEqual(
      [await exists(volume), rows.some(each => each.label === volume)],
      [true, true],
    );
  });

  it('F-0904 AC-26 (c167-live): a volume made or removed outside appears or disappears within three seconds, without Refresh or a reload', async () => {
    await rowsWhen(() => true);
    const volume = await volumeMade('c167-live');
    const appeared = await rowsWhen(
      shown => shown.some(each => each.label === volume),
      3_000,
    );
    await docker('volume', 'rm', volume);
    const gone = await rowsWhen(
      shown => !shown.some(each => each.label === volume),
      3_000,
    );
    deepStrictEqual(
      [
        appeared.some(each => each.label === volume),
        gone.some(each => each.label === volume),
      ],
      [true, false],
    );
  });

  it('F-0902 AC-29 (c167-inspect): Inspect on a volume row opens a JSON tab with the volume’s object, its name and labels', async () => {
    const volume = await volumeMade('c167-inspect', {[UNIQUE]: 'false'});
    await listing(volume);
    await rowMenuAction('local', VOLUMES, volume, 'Inspect');
    let text: string | null = null;
    await waitFor(
      'the inspect document',
      async () => {
        text = await activeEditorTextOf('local');
        return text?.includes(volume) === true;
      },
      60_000,
    );
    const shown = JSON.parse(String(text)) as Record<string, unknown>;
    deepStrictEqual(
      [shown.Name, shown.Driver, shown.Labels, Object.keys(shown).sort()],
      [
        volume,
        'local',
        {[UNIQUE]: 'false'},
        [
          'CreatedAt',
          'Driver',
          'Labels',
          'Mountpoint',
          'Name',
          'Options',
          'Scope',
        ],
      ],
    );
  });
});
