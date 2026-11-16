/**
 * @fileoverview The clean-up of old server installs on a connect in the legacy mode (cards #2651 and #2667, F-2413 6.4): the five
 * most recently modified installs stay, the others go with their log and pid files, an install whose lock is held stays,
 * and nothing is shown. The old installs are folders of invented commit ids under `bin/`, with modification times the row
 * sets.
 */

import {deepStrictEqual} from 'node:assert';
import {
  editorProduct,
  onHost,
  recordLines,
  connectedWithin,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  userSettings,
} from './harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  openConnected,
  setting,
} from './maintenance.ts';

/** The invented commit id of old install number `index`: forty hexadecimal digits. */
function oldCommit(index: number): string {
  return `${String(index).padStart(2, '0')}${'a'.repeat(38)}`;
}

/** Makes install `index` under `root`, the folder, its `.<commit>.log` (unless `withoutLog`) and its pid file, last modified on day `day` of January. */
async function makeOld(
  root: string,
  index: number,
  dayOfJanuary: number,
  withoutLog = false,
): Promise<void> {
  const commit = oldCommit(index);
  const when = `2026-01-${String(dayOfJanuary).padStart(2, '0')} 12:00:00`;
  await onHost(
    'sh',
    '-c',
    `mkdir -p '${root}/bin/${commit}/bin' && touch '${root}/bin/${commit}/remote-lock.harness.${commit}' && ${withoutLog ? 'true' : `touch '${root}/.${commit}.log'`} && printf '99999' > '${root}/.${commit}.pid' && touch -d '${when}' '${root}/bin/${commit}'`,
  );
}

/** The names under `root`'s `bin/` folder, sorted, with the invented ones as their index and the current one as `current`. */
async function installsIn(root: string): Promise<string[]> {
  const current = editorProduct().commit;
  return (await onHost('sh', '-c', `ls '${root}/bin' 2>/dev/null; true`))
    .split('\n')
    .filter(name => name !== '')
    .map(name => (name === current ? 'current' : name.slice(0, 2)))
    .sort();
}

/** The `.<commit>.log` and `.<commit>.pid` files of the invented installs under `root`, as their index and kind, sorted. */
async function sideFilesIn(root: string): Promise<string[]> {
  return (
    await onHost(
      'sh',
      '-c',
      `ls -A '${root}' 2>/dev/null | grep -E '^\\.[0-9]{2}a{38}\\.(log|pid)$'; true`,
    )
  )
    .split('\n')
    .filter(name => name !== '')
    .map(name => `${name.slice(1, 3)}.${name.slice(-3)}`)
    .sort();
}

/** Removes every invented install and its files under `root`. */
async function removeOld(root: string): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `rm -rf '${root}'/bin/[0-9][0-9]aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa '${root}'/.[0-9][0-9]aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.log '${root}'/.[0-9][0-9]aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pid`,
  );
}

/** The names of the two-digit index of `count` old installs from `first`, as `installsIn` writes them. */
function indexes(first: number, count: number): string[] {
  return Array.from({length: count}, (unused, offset) =>
    String(first + offset).padStart(2, '0'),
  );
}

/** The notices and failure dialogs window `name` showed, from the script's record: the launch has no renderer to read. */
function shownBy(name: string): string[] {
  return recordLines(undefined, name)
    .filter(
      line => line.surface === 'notice' || line.surface === 'failureDialog',
    )
    .map(line => line.surface);
}

/** The process id of the host's server itself (not its children), which a reload must not change. */
async function serverMain(): Promise<string> {
  return (
    await onHost(
      'pgrep',
      '-u',
      'harness',
      '-f',
      `${DATA_FOLDER}/bin/.*/out/server-main.js`,
    ).catch(() => '')
  ).trim();
}

describe('the clean-up of old server installs in the legacy mode (card #2651, F-2413)', function () {
  this.timeout(900_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await closeAllButLocal();
    await setting('remote.SSH.useExecServer', false);
    // The current install: one connect in the legacy mode puts it in place.
    await openConnected('cu-first', 180_000);
    await closeAllButLocal();
  });

  afterEach(async () => {
    await closeAllButLocal();
    await removeOld(DATA_FOLDER);
    await onHost('pkill', '-f', 'sleep 600').catch(() => undefined);
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  /** Makes the current install the most recently modified, and stops the servers, so the next connect starts clean. */
  async function freshCurrent(): Promise<void> {
    await onHost('pkill', '-u', 'harness', '-f', `${DATA_FOLDER}/`).catch(
      () => undefined,
    );
    await onHost('touch', `${DATA_FOLDER}/bin/${editorProduct().commit}`);
  }

  it('F-2413 AC-15, AC-18 (c2651-clean-eight): with the current install and 8 older ones the 4 least recently modified go with their log and pid files, 5 installs remain and nothing is shown', async () => {
    await freshCurrent();
    for (let index = 1; index <= 8; index += 1) {
      await makeOld(DATA_FOLDER, index, index);
    }
    await openConnected('cu-eight', 180_000);
    deepStrictEqual(
      {
        installs: await installsIn(DATA_FOLDER),
        side: await sideFilesIn(DATA_FOLDER),
        shown: shownBy('cu-eight'),
      },
      {
        installs: ['05', '06', '07', '08', 'current'].sort(),
        side: indexes(5, 4)
          .flatMap(index => [`${index}.log`, `${index}.pid`])
          .sort(),
        shown: [],
      },
    );
  });

  it('F-2413 AC-16 (c2651-clean-few): with at most five installs nothing is deleted', async () => {
    await freshCurrent();
    for (let index = 1; index <= 4; index += 1) {
      await makeOld(DATA_FOLDER, index, index);
    }
    await openConnected('cu-few', 180_000);
    deepStrictEqual(await installsIn(DATA_FOLDER), [
      '01',
      '02',
      '03',
      '04',
      'current',
    ]);
  });

  it('F-2413 AC-17 (c2651-clean-reload): with a running server a reload after old installs were added deletes those beyond five and reuses the server', async () => {
    await freshCurrent();
    await openConnected('cu-reload', 180_000);
    const server = await serverMain();
    for (let index = 1; index <= 8; index += 1) {
      await makeOld(DATA_FOLDER, index, index);
    }
    await reloadWindow('cu-reload');
    await connectedWithin('cu-reload', 180_000);
    deepStrictEqual(
      [await installsIn(DATA_FOLDER), await serverMain()],
      [['05', '06', '07', '08', 'current'].sort(), server],
    );
  });

  it('F-2413 AC-29 (c2651-clean-locked): an old install beyond the five whose install lock another process holds is kept, the other old ones beyond five go, and 6 installs remain', async () => {
    await freshCurrent();
    for (let index = 1; index <= 8; index += 1) {
      await makeOld(DATA_FOLDER, index, index);
    }
    const lock = `${DATA_FOLDER}/bin/${oldCommit(2)}/remote-lock.harness.${oldCommit(2)}`;
    await onHost(
      'sh',
      '-c',
      `nohup flock -x '${lock}' sleep 600 >/dev/null 2>&1 &`,
    );
    await new Promise(resolve => setTimeout(resolve, 1500));
    await openConnected('cu-locked', 180_000);
    deepStrictEqual(await installsIn(DATA_FOLDER), [
      '02',
      '05',
      '06',
      '07',
      '08',
      'current',
    ]);
  });

  it('F-2413 AC-30 (c2651-clean-current-oldest): with a running server and the current install the least recently modified of six, a reload deletes nothing and the window connects', async () => {
    await freshCurrent();
    await openConnected('cu-oldest', 180_000);
    for (let index = 1; index <= 5; index += 1) {
      await makeOld(DATA_FOLDER, index, index + 10);
    }
    await onHost(
      'touch',
      '-d',
      '2026-01-01 12:00:00',
      `${DATA_FOLDER}/bin/${editorProduct().commit}`,
    );
    await reloadWindow('cu-oldest');
    await connectedWithin('cu-oldest', 180_000);
    deepStrictEqual(await installsIn(DATA_FOLDER), [
      '01',
      '02',
      '03',
      '04',
      '05',
      'current',
    ]);
  });

  it('F-2413 AC-31 (c2651-clean-no-log): an old install to delete that has no log file is deleted and the window connects normally', async () => {
    await freshCurrent();
    await makeOld(DATA_FOLDER, 1, 1, true);
    for (let index = 2; index <= 8; index += 1) {
      await makeOld(DATA_FOLDER, index, index);
    }
    await openConnected('cu-no-log', 180_000);
    deepStrictEqual(
      [await installsIn(DATA_FOLDER), shownBy('cu-no-log')],
      [['05', '06', '07', '08', 'current'].sort(), []],
    );
  });

  it('F-2413 AC-32 (c2651-clean-path): with serverInstallPath set the clean-up applies to the installs under that path and the installs in the home folder are not changed', async () => {
    const custom = '/home/harness/custom-clean';
    const dataRoot = `${custom}/${editorProduct().serverDataFolderName}`;
    await freshCurrent();
    for (let index = 1; index <= 3; index += 1) {
      await makeOld(DATA_FOLDER, index, index);
    }
    await onHost('mkdir', '-p', dataRoot);
    for (let index = 11; index <= 18; index += 1) {
      await makeOld(dataRoot, index, index - 10);
    }
    await userSettings({
      'remote.SSH.serverInstallPath': {harness: custom},
    });
    try {
      await openConnected('cu-path', 180_000);
      deepStrictEqual(
        {
          home: await installsIn(DATA_FOLDER),
          custom: (await installsIn(dataRoot)).length,
        },
        {home: ['01', '02', '03', 'current'], custom: 5},
        `custom: ${JSON.stringify(await installsIn(dataRoot))}`,
      );
    } finally {
      await userSettings({'remote.SSH.serverInstallPath': undefined});
      await onHost('rm', '-rf', custom);
    }
  });
});
