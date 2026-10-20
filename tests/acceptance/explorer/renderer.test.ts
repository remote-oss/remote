import {deepStrictEqual, rejects} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inWindow, variable, windowEvents} from '../windows/harness.ts';
import {pageOf, rowAction, titleAction, viewRows} from '../windows/renderer.ts';

/** The folder of the smoke window, in the run's folder, with two files the file explorer lists. */
const SMOKE = 'smoke';

/** The file explorer's pane title for the smoke folder, as the pinned build shows it. */
const EXPLORER_PANE = SMOKE;

/** Polls until the smoke window's agent has activated, for up to a minute. */
async function smokeWindowActive(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!windowEvents(SMOKE).some(each => each.event === 'activated')) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the smoke window');
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

describe('the renderer helpers, on core’s file explorer (card tooling-30)', function () {
  this.timeout(180000);

  before(async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), SMOKE);
    mkdirSync(folder, {recursive: true});
    writeFileSync(path.join(folder, 'a.txt'), 'a');
    writeFileSync(path.join(folder, 'b.txt'), 'b');
    // The gate rows run before this one and reload `local` onto `empty-2`.
    await inWindow(
      'empty-2',
      'acceptance.agent.openWindow',
      pathToFileURL(folder).href,
    );
    await smokeWindowActive();
    await inWindow(SMOKE, 'workbench.files.action.focusFilesExplorer');
  });

  it('tooling-30: viewRows lists the folder’s files at the first level', async () => {
    deepStrictEqual(
      (await viewRows(SMOKE, EXPLORER_PANE))?.map(shown => [
        shown.label,
        shown.level,
      ]),
      [
        ['a.txt', 1],
        ['b.txt', 1],
      ],
    );
  });

  it('tooling-30: titleAction clicks a view’s title action and the rows stay', async () => {
    await titleAction(SMOKE, EXPLORER_PANE, 'Collapse Folders in Explorer');
    deepStrictEqual(
      (await viewRows(SMOKE, EXPLORER_PANE))?.map(shown => shown.label),
      ['a.txt', 'b.txt'],
    );
  });

  it('tooling-30: a view no pane has gives no rows', async () => {
    deepStrictEqual(await viewRows(SMOKE, 'No Such View'), undefined);
  });

  it('tooling-30: rowAction on a view no pane has fails naming the view', async () => {
    await rejects(
      rowAction(SMOKE, 'No Such View', 'a.txt', 'Open'),
      /No Such View/,
    );
  });

  it('tooling-30: pageOf fails for a window that has no page, listing the titles', async () => {
    await rejects(pageOf('no-such-window', 1000), /\[smoke\]/);
  });
});
