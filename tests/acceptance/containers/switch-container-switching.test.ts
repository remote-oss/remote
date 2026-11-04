/**
 * @fileoverview Switch Container (card containers-166, F-0407): the switch itself in the same window, what happens to the
 * container that is left, and the commands that run on the one that is reached.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {devContainersOf, waitFor} from '../windows/harness.ts';
import {stateOf as containerStateOf} from '../windows/dev-containers-view.ts';
import {ORDER_FILE, mark} from './lifecycle-support.ts';
import {switchScene} from './switch-support.ts';

const MAIN = '.devcontainer/devcontainer.json';
const OTHER = '.devcontainer/other/devcontainer.json';

/** The six commands of a configuration, each marking its own name after `prefix`. */
function commandsOf(prefix: string): Record<string, string> {
  return {
    initializeCommand: mark(`${prefix}-initialize`),
    onCreateCommand: mark(`${prefix}-onCreate`),
    updateContentCommand: mark(`${prefix}-updateContent`),
    postCreateCommand: mark(`${prefix}-postCreate`),
    postStartCommand: mark(`${prefix}-postStart`),
    postAttachCommand: mark(`${prefix}-postAttach`),
  };
}

/** The labels the commands of the run have marked in `folder`, in file order. */
function marksIn(folder: string): string[] {
  try {
    return readFileSync(path.join(folder, ORDER_FILE), 'utf8')
      .split('\n')
      .filter(line => line !== '')
      .map(line => line.split(' ')[0] ?? '');
  } catch {
    return [];
  }
}

describe('Switch Container: the switch and the container it leaves (card containers-166, F-0407)', function () {
  this.timeout(900_000);
  const {folderOf, connected, switchTo, stateOf, cleanUp} = switchScene();

  afterEach(cleanUp);

  /** Waits until container `container` is in state `wanted`, and gives how long it took in milliseconds. */
  async function becomes(
    container: string,
    wanted: string,
    milliseconds: number,
  ): Promise<number> {
    const started = Date.now();
    await waitFor(
      `container ${container} to be ${wanted}`,
      async () => (await containerStateOf(container)) === wanted,
      milliseconds,
    );
    return Date.now() - started;
  }

  it('F-0407 AC-3, AC-9, AC-18 (c166-switch): the switch reloads the same window onto the other configuration, the container it left exits, and switching back reuses the first container', async () => {
    const folder = folderOf('c166-switch', {[MAIN]: 'Main', [OTHER]: 'Other'});
    const window = await connected(folder, 'Main');
    const [main = ''] = await devContainersOf(folder);
    await switchTo(window, 'Other');
    const toOther = await stateOf(window);
    await becomes(main, 'exited', 120_000);
    const afterFirst = (await devContainersOf(folder)).length;
    await switchTo(window, 'Main');
    const back = await stateOf(window);
    const containers = await devContainersOf(folder);
    deepStrictEqual(
      {
        other: toOther.indicator,
        otherTitle: toOther.title.includes('Other'),
        afterFirst,
        back: back.indicator,
        mainAgain: await containerStateOf(main),
        containers: containers.length,
      },
      {
        other: 'Dev Container: Other',
        otherTitle: true,
        afterFirst: 2,
        back: 'Dev Container: Main',
        mainAgain: 'running',
        containers: 2,
      },
    );
  });

  it('F-0407 AC-18, F-0417 AC-55 (c166-none): with shutdownAction none the container that is left keeps running, also long after the stop of the default would have happened', async () => {
    const folder = folderOf('c166-none', {
      [MAIN]: {name: 'Main', shutdownAction: 'none'},
      [OTHER]: {name: 'Other', shutdownAction: 'none'},
    });
    const window = await connected(folder, 'Main');
    const [main = ''] = await devContainersOf(folder);
    await switchTo(window, 'Other');
    await new Promise(resolve => setTimeout(resolve, 30_000));
    deepStrictEqual(await containerStateOf(main), 'running');
  });

  it('F-0417 AC-55 (c166-stop): with the default shutdownAction the container that is left exits some seconds after the switch, not at once and not never', async () => {
    const folder = folderOf('c166-stop', {[MAIN]: 'Main', [OTHER]: 'Other'});
    const window = await connected(folder, 'Main');
    const [main = ''] = await devContainersOf(folder);
    await switchTo(window, 'Other');
    const exited = await becomes(main, 'exited', 120_000);
    deepStrictEqual(exited < 60_000, true);
  });

  it('F-0415 AC-40 (c166-commands): the six commands run on the first configuration, six others on the second, and switching back to the one that kept running runs only its initializeCommand and postAttachCommand', async () => {
    const folder = folderOf('c166-commands', {
      [MAIN]: {name: 'Main', shutdownAction: 'none', ...commandsOf('A')},
      [OTHER]: {name: 'Other', shutdownAction: 'none', ...commandsOf('B')},
    });
    const window = await connected(folder, 'Main');
    await waitFor(
      'the six commands of Main',
      () => marksIn(folder).filter(label => label.startsWith('A-')).length >= 6,
      120_000,
    );
    await switchTo(window, 'Other');
    await waitFor(
      'the six commands of Other',
      () => marksIn(folder).filter(label => label.startsWith('B-')).length >= 6,
      120_000,
    );
    const before = marksIn(folder).length;
    await switchTo(window, 'Main');
    await waitFor(
      'the commands of Main after the switch back',
      () => marksIn(folder).length >= before + 2,
      120_000,
    );
    await new Promise(resolve => setTimeout(resolve, 10_000));
    deepStrictEqual(marksIn(folder).slice(before).sort(), [
      'A-initialize',
      'A-postAttach',
    ]);
  });
});
