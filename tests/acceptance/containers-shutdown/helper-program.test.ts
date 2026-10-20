import {deepStrictEqual} from 'node:assert';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {variable, waitFor} from '../windows/harness.ts';
import {
  chainOf,
  closedAndWatched,
  connectedWindow,
  editorMainProcess,
  helperProcesses,
  removeContainersOf,
  stoppedWithin,
} from './support.ts';

describe('the shutdown helper program (card containers-69)', function () {
  this.timeout(600_000);

  it('#1226: the shutdown helper program starts with the first dev container window, outside the editor’s process tree, and ends after the last window closed and its check ran', async () => {
    const userData = path.join(variable('HARNESS_RUN_FOLDER'), 'user-data');
    await waitFor(
      'no shutdown helper to be left from the rows before',
      async () => (await helperProcesses()).length === 0,
      120_000,
    );
    const before = await helperProcesses();
    const connected = await connectedWindow('c69-program');
    try {
      const during = await helperProcesses();
      const editors = await editorMainProcess(userData);
      const reached = during.flatMap(pid =>
        chainOf(pid).filter(each => editors.includes(each)),
      );
      const registry = path.join(
        userData,
        'User',
        'globalStorage',
        'remote-oss.remote-containers',
        'instance-registry',
      );
      const recorded =
        existsSync(registry) &&
        readdirSync(registry, {recursive: true, encoding: 'utf8'}).some(entry =>
          entry.includes('remote-containers.shutdown'),
        );
      const outcome = await closedAndWatched(connected, 20);
      await waitFor(
        'the shutdown helper to end',
        async () => (await helperProcesses()).length === 0,
        30_000,
      );
      deepStrictEqual(
        [
          before.length,
          during.length,
          editors.length > 0,
          reached,
          recorded,
          stoppedWithin(outcome, 0),
          (await helperProcesses()).length,
        ],
        [0, 1, true, [], true, true, 0],
        JSON.stringify(outcome),
      );
    } finally {
      await removeContainersOf(connected.folder);
    }
  });
});
