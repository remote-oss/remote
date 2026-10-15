import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  inWindow,
  reopenStarted,
  waitFor,
} from '../windows/harness.ts';
import {
  notificationCentre,
  pressKey,
  remoteIndicator,
  statusProgress,
  switchTerminalItems,
  terminalFocused,
  terminalHistory,
  terminalTabs,
} from '../windows/renderer.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';

/** The title of the terminal that shows the lifecycle commands (F-0408 S086). */
const TERMINAL = 'Configuring...';

/** The window's progress while the commands run in the background (S085). */
const PROGRESS = 'Configuring Dev Container (show log)';

/** What the terminal writes when the commands are done (S153). */
const DONE = 'Done. Press any key to close the terminal.';

/** The six lifecycle properties, in the order the CLI runs them. */
const PROPERTIES = [
  'initializeCommand',
  'onCreateCommand',
  'updateContentCommand',
  'postCreateCommand',
  'postStartCommand',
  'postAttachCommand',
] as const;

/** How long a window may take to finish the commands of these rows, in milliseconds. */
const LONG = 180_000;

/** Whether the terminal tab is open in window `name`; false while the page is not there. */
async function tabOpen(name: string): Promise<boolean> {
  try {
    return (await terminalTabs(name)).includes(TERMINAL);
  } catch {
    return false;
  }
}

describe('the Configuring... terminal and its progress (card containers-20, F-0415)', function () {
  this.timeout(600_000);

  it('F-0415 AC-6, AC-35, AC-33 (c1): six fast hooks show their lines, Start and Stop with their times and each command’s output in a Configuring... terminal that ends with the done line and closes on a key', async () => {
    const folder = devContainerFolder('configuring-all', {
      name: 'Configuring All',
      ...Object.fromEntries(
        PROPERTIES.map(property => [property, `echo ${property}-output`]),
      ),
    });
    const name = await openFolderWindow(folder);
    await reopenStarted(name);
    await waitFor(`the ${TERMINAL} terminal`, () => tabOpen(name), LONG);
    await inWindow(name, 'workbench.action.toggleMaximizedPanel');
    const lines = await terminalHistory(
      name,
      history => history.includes(DONE),
      LONG,
    );
    const written = lines.filter(line =>
      /^(Running the \w+ from devcontainer\.json\.\.\.|\w+-output)$/.test(line),
    );
    const timed = lines.filter(line => line.startsWith('['));
    await pressKey(name, 'a');
    await waitFor(
      `the ${TERMINAL} terminal to close`,
      async () => !(await tabOpen(name)),
      10_000,
    );
    deepStrictEqual(
      {
        written,
        timedFormat: timed.every(line =>
          /^\[\d+ ms\] (Start|Stop \(\d+ ms\)): /.test(line),
        ),
        timedCount: timed.length,
        last: lines.at(-1),
      },
      {
        written: PROPERTIES.flatMap(property => [
          `Running the ${property} from devcontainer.json...`,
          `${property}-output`,
        ]),
        timedFormat: true,
        timedCount: PROPERTIES.length * 2,
        last: DONE,
      },
    );
    await closeWindow(name);
  });

  it('F-0415 AC-11, AC-6 (c2): a failing postCreateCommand shows the window progress while it runs, then its red failure line and the done line, with no notification, and the progress goes', async () => {
    const folder = devContainerFolder('configuring-fail', {
      name: 'Configuring Fail',
      postCreateCommand: 'sleep 8; exit 3',
    });
    const name = await openFolderWindow(folder);
    await reopenStarted(name);
    await waitFor(
      `the progress ${PROGRESS}`,
      async () => {
        try {
          return (await statusProgress(name)) === PROGRESS;
        } catch {
          return false;
        }
      },
      LONG,
    );
    const lines = await terminalHistory(
      name,
      history => history.includes(DONE),
      LONG,
    );
    const progressAfter = await statusProgress(name);
    const failure = lines.filter(line =>
      line.includes('failed with exit code'),
    );
    deepStrictEqual(
      {
        failure,
        last: lines.at(-1),
        progressAfter,
        notifications: (await notificationCentre(name)).filter(text =>
          text.includes('exit code'),
        ),
      },
      {
        failure: [
          'postCreateCommand from devcontainer.json failed with exit code 3. Skipping any further user-provided commands.',
        ],
        last: DONE,
        progressAfter: undefined,
        notifications: [],
      },
    );
    await closeWindow(name);
  });

  it('F-0415 AC-35 (c4): a configuration with no lifecycle command shows no terminal and no progress for ten seconds after it connects', async () => {
    const name = await openFolderWindow(
      devContainerFolder('configuring-none', {name: 'Configuring None'}),
    );
    await reopenStarted(name);
    await connectedToContainer(name);
    const seen: string[] = [];
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await tabOpen(name)) {
        seen.push('tab');
      }
      if ((await statusProgress(name)) !== undefined) {
        seen.push('progress');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    deepStrictEqual(seen, []);
    await closeWindow(name);
  });

  it('F-0415 AC-35 (c5): a command that holds the connect shows its terminal while the window still opens the remote, focused, with the commands run so far, and Switch Active Terminal lists it afterwards (recorded: isTransient does not hide it)', async () => {
    const name = await openFolderWindow(
      devContainerFolder('configuring-held', {
        name: 'Configuring Held',
        onCreateCommand: 'echo create-output',
        updateContentCommand: 'echo update-output; sleep 20',
      }),
    );
    await reopenStarted(name);
    await waitFor(
      'the window to open the remote with the terminal open',
      async () => {
        try {
          return (
            (await remoteIndicator(name)) === 'Opening Remote...' &&
            (await tabOpen(name))
          );
        } catch {
          return false;
        }
      },
      LONG,
    );
    const focused = await terminalFocused(name);
    const lines = await terminalHistory(
      name,
      history => history.includes('update-output'),
      LONG,
    );
    const opening = await remoteIndicator(name);
    await connectedToContainer(name);
    const items = await switchTerminalItems(name);
    console.log(
      `containers-20 c5: Switch Active Terminal lists ${JSON.stringify(items)} after the connect`,
    );
    deepStrictEqual(
      {
        focused,
        opening,
        output: lines.filter(line => /^\w+-output$/.test(line)),
        starts: lines.filter(line => line.includes('] Start: ')).length,
      },
      {
        focused: true,
        opening: 'Opening Remote...',
        output: ['create-output', 'update-output'],
        starts: 2,
      },
    );
    await closeWindow(name);
  });
});
