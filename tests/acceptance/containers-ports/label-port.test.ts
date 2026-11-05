import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {waitFor} from '../windows/harness.ts';
import {
  focusedInputValue,
  notificationCentre,
  pressEnter,
  portRowActions,
  portRowAction,
  typeInFocusedInput,
} from '../windows/renderer.ts';
import {
  folderOf,
  freePort,
  portsWindows,
  rowsWhen,
  showPorts,
} from './ports-support.ts';

const TITLE = 'Set Label and Update devcontainer.json';

/** The `portsAttributes` of the folder's devcontainer.json. */
function attributesOf(folder: string): unknown {
  const text = readFileSync(
    path.join(folder, '.devcontainer', 'devcontainer.json'),
    'utf8',
  );
  return (JSON.parse(text) as {portsAttributes?: unknown}).portsAttributes;
}

describe('Set Label and Update devcontainer.json (card containers-210, F-1103)', function () {
  this.timeout(900_000);
  const {connectedWith} = portsWindows();

  it('F-1103 AC-1, AC-2, AC-4 (c210-label): the first inline action of a forwarded port opens the editor with the port number, a label typed there is written to the configuration under the port, the notification links to it, and the row shows the label', async () => {
    const port = await freePort();
    const window = await connectedWith('c210-label', {forwardPorts: [port]});
    await showPorts(window);
    await rowsWhen(window, shown => shown.length > 0);
    const actions = await portRowActions(window, String(port));
    await portRowAction(window, String(port), TITLE);
    await waitFor(
      'the inline editor with the port number',
      async () => (await focusedInputValue(window)) === String(port),
      30_000,
    );
    await typeInFocusedInput(window, 'Web');
    await pressEnter(window);
    await waitFor(
      'the notification of the written label',
      async () =>
        (await notificationCentre(window)).some(text =>
          text.includes('Port attributes have been added to the'),
        ),
      60_000,
    );
    const rows = await rowsWhen(window, shown =>
      shown.some(each => each.port === `Web (${String(port)})`),
    );
    deepStrictEqual(
      [
        actions.inline[0],
        attributesOf(folderOf('c210-label')),
        rows.map(each => each.port),
      ],
      [TITLE, {[String(port)]: {label: 'Web'}}, [`Web (${String(port)})`]],
    );
  });
});
