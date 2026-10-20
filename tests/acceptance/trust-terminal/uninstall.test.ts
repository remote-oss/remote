import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  inWindow,
  isTrusted,
  onHostAs,
  openWindow,
  recordLines,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {
  DATA_FOLDER,
  existsOnHost,
  pickHost,
  runWith,
} from '../windows/maintenance.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';

/** The buttons of core's trust request, in the order the page holds them (measured on the run's build). */
const REQUEST_BUTTONS = ['Manage', 'Cancel', 'Trust Folder & Continue'];

/** The names of window `name`'s terminals, as it reports them now. */
async function terminalsOf(name: string): Promise<string[] | undefined> {
  await inWindow(name, 'acceptance.agent.state');
  return windowEvents(name)
    .filter(each => each.event === 'state')
    .at(-1)?.terminals;
}

/** Opens window `name` on `harness`, answers the connect's trust request with Cancel, and leaves it untrusted. */
async function untrustedWindow(name: string): Promise<void> {
  await openWindow('harness', name);
  await waitForDialog(name, 120_000);
  await answerDialog(name, 'Cancel');
  deepStrictEqual(await isTrusted(name), false);
}

/**
 * Runs the uninstall of `harness` in window `name`, waits for the trust request it raises, answers it with `button`
 * and gives how the command ended.
 */
async function uninstallAnswering(
  name: string,
  button: string,
): Promise<{buttons: string[]; ended: string}> {
  const running = runWith(name, 'opensshremotes.cleanDevBox', [
    pickHost('harness'),
  ]).then(
    () => 'finished',
    () => 'failed',
  );
  const request = await waitForDialog(name, 60_000);
  await answerDialog(name, button);
  return {buttons: request.buttons, ended: await running};
}

describe('Uninstall VS Code Server in Restricted Mode (card coverage-43)', function () {
  this.timeout(600_000);

  it('F-2412 AC-19 (c43-trust-cancel): cancelling core’s trust request removes nothing from the host', async () => {
    await onHostAs('harness', 'mkdir', '-p', `${DATA_FOLDER}/bin`);
    await untrustedWindow('t19');
    const outcome = await uninstallAnswering('t19', 'Cancel');
    await new Promise(resolve => setTimeout(resolve, 5000));
    deepStrictEqual(
      [outcome.buttons, await existsOnHost(DATA_FOLDER)],
      [REQUEST_BUTTONS, true],
    );
    await closeWindow('t19');
  });

  it('F-2412 AC-37 (c43-trust-continue): Trust Folder & Continue removes the server folder with no message and no visible terminal', async () => {
    await onHostAs('harness', 'mkdir', '-p', `${DATA_FOLDER}/bin`);
    await untrustedWindow('t37');
    const terminals = await terminalsOf('t37');
    const mark = recordLines().length;
    const outcome = await uninstallAnswering('t37', 'Trust Folder & Continue');
    await waitFor(
      `${DATA_FOLDER} to be removed`,
      async () => !(await existsOnHost(DATA_FOLDER)),
      30_000,
    );
    deepStrictEqual(
      [
        outcome.buttons,
        recordLines()
          .slice(mark)
          .filter(
            line =>
              line.window === 't37' &&
              (line.surface === 'notice' || line.surface === 'failureDialog'),
          ),
        await terminalsOf('t37'),
      ],
      [REQUEST_BUTTONS, [], terminals],
    );
    await closeWindow('t37');
  });
});
