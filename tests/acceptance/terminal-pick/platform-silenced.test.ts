import {deepStrictEqual} from 'node:assert';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  connectedWithin,
  openWindow,
  recordLines,
  relaunch,
  scriptEntries,
  waitFor,
} from '../windows/harness.ts';
import {
  addHarnessCopy,
  INSTALL_MILLISECONDS,
  restoreConfig,
  storedPlatform,
} from '../windows/maintenance.ts';

/** The answers of window `name` for a connect with no stored platform: Linux at the pick, and `button` at the notice. */
function answersOf(name: string, button?: string): AppendedEntry[] {
  return [
    {surface: 'platformPick', match: 'platform', answer: 'linux', window: name},
    ...(button === undefined
      ? []
      : [
          {
            surface: 'notice',
            match: 'You selected',
            answer: {button},
            window: name,
          } satisfies AppendedEntry,
        ]),
  ];
}

/** The notices window `name` showed. */
function noticesOf(name: string): string[] {
  return recordLines('notice', name).map(line => line.question);
}

/** Whether the stored platform has an entry for `host`. */
function hasEntry(host: string): boolean {
  const stored = storedPlatform();
  return (
    typeof stored === 'object' &&
    stored !== null &&
    Object.keys(stored).includes(host)
  );
}

// This file is the launch's last: "Don't Show Again" is kept in the extension's global state, for good.
describe('the platform notice and its Don’t Show Again button (card coverage-94)', function () {
  this.timeout(600_000);

  let original = '';

  before(() => {
    // The launch's first file wrote an entry for no window in particular, which every window would meet first.
    scriptEntries([]);
    original = addHarnessCopy('silence-one');
    addHarnessCopy('silence-two');
    addHarnessCopy('silence-three');
  });

  after(() => {
    restoreConfig(original);
  });

  it('F-2206 AC-25 (c94-dont-show): Don’t Show Again closes the notice, and a later connect to another host writes its entry and shows no notice, also after a restart', async () => {
    appendScript(answersOf('ds1', "Don't Show Again"));
    await openWindow('silence-one', 'ds1');
    await connectedWithin('ds1', INSTALL_MILLISECONDS);
    await waitFor('the first entry', () => hasEntry('silence-one'), 30_000);
    appendScript(answersOf('ds2'));
    await openWindow('silence-two', 'ds2');
    await connectedWithin('ds2', INSTALL_MILLISECONDS);
    await waitFor('the second entry', () => hasEntry('silence-two'), 30_000);
    const before = [noticesOf('ds1').length, noticesOf('ds2')];
    await relaunch('ds2', {environment: {}});
    appendScript(answersOf('ds3'));
    await openWindow('silence-three', 'ds3');
    await connectedWithin('ds3', INSTALL_MILLISECONDS);
    await waitFor('the third entry', () => hasEntry('silence-three'), 30_000);
    await new Promise(resolve => setTimeout(resolve, 5000));
    deepStrictEqual(
      [before, noticesOf('ds3'), hasEntry('silence-three')],
      [[1, []], [], true],
    );
  });
});
