/**
 * @fileoverview The old server installs in the legacy mode that a connect must leave (card #2651, F-2413 6.4): with at
 * most five installs nothing is deleted, and the current install is never deleted, even when it is the least recently
 * modified. The old installs are folders of invented commit ids under `bin/`, with modification times the row sets. The
 * clean-up itself (the other rows of 6.4) is a difference of the product: see the card.
 */

import {deepStrictEqual} from 'node:assert';
import {
  editorProduct,
  onHost,
  connectedWithin,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
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
    `mkdir -p '${root}/bin/${commit}/bin' && touch '${root}/bin/${commit}/vscode-remote-lock.harness.${commit}' && ${withoutLog ? 'true' : `touch '${root}/.${commit}.log'`} && printf '99999' > '${root}/.${commit}.pid' && touch -d '${when}' '${root}/bin/${commit}'`,
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

/** Removes every invented install and its files under `root`. */
async function removeOld(root: string): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `rm -rf '${root}'/bin/[0-9][0-9]aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa '${root}'/.[0-9][0-9]aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.log '${root}'/.[0-9][0-9]aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pid`,
  );
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
});
