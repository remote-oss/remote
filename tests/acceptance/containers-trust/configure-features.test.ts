/**
 * @fileoverview Configure Container Features in Restricted Mode (card containers-150, part E): the write is the same as
 * in a trusted workspace, whichever way the pick is accepted.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {isTrusted, inWindow, waitFor} from '../windows/harness.ts';
import {
  acceptQuickPick,
  detailedQuickPickRows,
  pressEscape,
  pressQuickPickTitleButton,
  quickPickFacts,
  toggleQuickPickRow,
} from '../windows/renderer.ts';
import {
  FEATURES_PLACEHOLDER,
  screenWith,
  withWindow,
} from '../windows/authoring-support.ts';

const COMMAND = 'remote-containers.configureContainerFeatures';
const GATE = 'Keep Feature defaults or configure options?';
const PLAIN = 'Lab Plain';
const OPTIONS = 'Lab Options';

/** The configuration of a folder whose window starts untrusted. */
const CONFIGURATION = {
  '.devcontainer/devcontainer.json': '{\n    "image": "x"\n}\n',
} as const;

/** The entries of "features" in the configuration of `folder`, each key as its last segment, with its value. */
function entriesOf(folder: string): Array<[string, unknown]> {
  const parsed = JSON.parse(
    readFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      'utf8',
    ),
  ) as {features?: Record<string, unknown>};
  return Object.entries(parsed.features ?? {}).map(([key, value]) => [
    key.split('/').slice(-1)[0] ?? key,
    value,
  ]);
}

/** Runs the command in an untrusted window on a fresh folder, checks `label`, accepts as `accept` says, and gives what was written. */
async function writtenIn(
  name: string,
  label: string,
  accept: 'finish' | 'keep' | 'configure',
): Promise<{trusted: boolean | undefined; entries: Array<[string, unknown]>}> {
  let result: {
    trusted: boolean | undefined;
    entries: Array<[string, unknown]>;
  } = {
    trusted: undefined,
    entries: [],
  };
  await withWindow(name, CONFIGURATION, async (window, folder) => {
    const trusted = await isTrusted(window);
    inWindow(window, COMMAND).catch(() => undefined);
    await screenWith(window, FEATURES_PLACEHOLDER);
    await toggleQuickPickRow(window, label);
    if (accept === 'finish') {
      await pressQuickPickTitleButton(window, 'Finish');
    } else {
      await acceptQuickPick(window);
      await waitFor(
        'the question',
        async () => (await quickPickFacts(window))?.title === GATE,
        60_000,
      );
      if (accept === 'keep') {
        await acceptQuickPick(window);
      } else {
        await pressEscape(window);
        // The walk of Lab Options: the booleans, then the level screen, ended with Finish.
        await waitFor(
          'the first screen of the walk',
          async () =>
            (await detailedQuickPickRows(window)).some(
              each => each.label === 'enabled',
            ),
          60_000,
        );
        await acceptQuickPick(window);
        await waitFor(
          'the level screen',
          async () =>
            (await quickPickFacts(window))?.title.startsWith(
              'Select options for',
            ) === true,
          60_000,
        );
        await pressQuickPickTitleButton(window, 'Finish');
      }
    }
    await waitFor(
      'the entry to be written',
      () => entriesOf(folder).length > 0,
      60_000,
    );
    result = {trusted, entries: entriesOf(folder)};
  });
  return result;
}

describe('Configure Container Features in Restricted Mode (card containers-150, part E)', function () {
  this.timeout(600_000);

  it('F-0807 AC-19 (c150-restricted): in an untrusted folder Finish, Keep Defaults and Configure Options write what they write in a trusted one', async () => {
    const finish = await writtenIn('c150-restricted-finish', PLAIN, 'finish');
    const keep = await writtenIn('c150-restricted-keep', PLAIN, 'keep');
    const configure = await writtenIn(
      'c150-restricted-configure',
      OPTIONS,
      'configure',
    );
    deepStrictEqual(
      [finish, keep, configure],
      [
        {trusted: false, entries: [['lab-plain:1', {}]]},
        {trusted: false, entries: [['lab-plain:1', {}]]},
        {
          trusted: false,
          entries: [['lab-options:1', {enabled: true, level: 'low'}]],
        },
      ],
    );
  });
});
