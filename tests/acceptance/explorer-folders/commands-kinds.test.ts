/**
 * @fileoverview F-5002 (card coverage-102, #1809, part 3b): the commands of the view invoked out of their context in
 * the other kinds of window, with an argument that is no row, and by an extension of the window with `executeCommand`.
 * They leave the window, the machine and the history as they were, and show nothing modal.
 */

import {deepStrictEqual} from 'node:assert';
import {
  callCommand,
  inWindow,
  nextEmptyWindow,
  openWindow,
} from '../windows/harness.ts';
import {openMemoryWindow} from '../windows/folder-windows.ts';
import {
  bindKeys,
  closeIfOpen,
  connectedTo,
} from '../windows/explorer-folders.ts';
import {
  COMMANDS,
  HOST,
  differences,
  press,
  settledSnapshot,
  snapshotOf,
  stateKeys,
  usable,
} from '../windows/explorer-commands.ts';
import {
  activeSideBar,
  dialogOf,
  notifications,
  pressEscape,
  quickPickFacts,
  rememberPage,
  statusItemText,
} from '../windows/renderer.ts';

/** The argument the extension's own calls and keys give a command that wants a row. */
const NOT_A_ROW = 'bogus-f5002';

/** The commands that want a row and, outside one, must not reach the user's configuration, a window or Microsoft's extensions. */
const ROW_COMMANDS = [
  'remote-explorer.add',
  'remote-explorer.deleteFolderHistoryItem',
  'remote-explorer.connectToWslUsingDistro',
  'remote-explorer.connectToWslUsingDistroInNewWindow',
] as const;

/** The words that would name a Microsoft extension or its commands in something shown. */
const MICROSOFT_WORDS = /Remote - WSL|Remote - Tunnels|opensshremotes/u;

/** Closes with Escape what a command opened, after it has had time to open it, until no pick or input is left. */
async function settled(window: string): Promise<void> {
  // A picker of Remote - SSH appears late in a window where neither extension has been active yet.
  await new Promise(resolve => setTimeout(resolve, 8_000));
  for (let presses = 0; presses < 5; presses += 1) {
    await pressEscape(window);
    await new Promise(resolve => setTimeout(resolve, 1_000));
    if ((await quickPickFacts(window)) === undefined) {
      return;
    }
  }
}

describe('the commands of the view out of their context, in other windows (card coverage-102, part 3b)', function () {
  this.timeout(900_000);

  // The launch's own window is an empty one too: its page is pinned so that a new empty window can be told from it.
  before(async () => {
    await rememberPage('local');
  });

  it('F-5002 AC-14 (keys-kinds): a key bound to each command with no argument changes nothing in an empty window, an SSH window and a virtual workspace, and adds no state key of the extension', async () => {
    const keysBefore = stateKeys();
    const restore = await bindKeys(
      COMMANDS.map(([key, command]) => ({
        key: `ctrl+alt+${key}`,
        command: `remote-explorer.${command}`,
      })),
    );
    const seen: Array<{kind: string; changed: string[]; usable: boolean}> = [];
    try {
      const kinds: Array<[string, () => Promise<string>]> = [
        [
          'empty',
          () =>
            nextEmptyWindow(() =>
              inWindow('local', 'workbench.action.newWindow'),
            ),
        ],
        [
          'ssh',
          async () => {
            await openWindow(HOST, 'c5002-kinds-ssh');
            await connectedTo('c5002-kinds-ssh', HOST);
            await statusItemText(
              'c5002-kinds-ssh',
              'status.host',
              `SSH: ${HOST}`,
              180_000,
            );
            return 'c5002-kinds-ssh';
          },
        ],
        ['virtual', () => openMemoryWindow()],
      ];
      for (const [kind, open] of kinds) {
        const window = await open();
        try {
          const before = await settledSnapshot(window, false);
          const changed: string[] = [];
          for (const [key, command] of COMMANDS) {
            await press(window, key);
            const fields = differences(
              before,
              JSON.stringify(await snapshotOf(window, false)),
            );
            if (fields.length > 0) {
              changed.push(`${command}: ${fields.join(', ')}`);
            }
          }
          seen.push({kind, changed, usable: await usable(window)});
        } finally {
          await closeIfOpen(window);
        }
      }
    } finally {
      restore();
    }
    deepStrictEqual(
      [seen, stateKeys()],
      [
        ['empty', 'ssh', 'virtual'].map(kind => ({
          kind,
          changed: [],
          usable: true,
        })),
        keysBefore,
      ],
    );
  });

  it('F-5002 AC-15 (non-row): add, Remove from Recent List and the two WSL commands called with a string and with {} search no extension, name no Microsoft extension, and show no dialog', async () => {
    const window = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    try {
      const before = await activeSideBar(window);
      const shown: unknown[] = [];
      for (const command of ROW_COMMANDS) {
        for (const argument of [NOT_A_ROW, {}]) {
          const pending = callCommand(window, command, argument);
          await settled(window);
          await pending;
          shown.push([
            command,
            await dialogOf(window),
            (await notifications(window)).filter(text =>
              MICROSOFT_WORDS.test(text),
            ),
          ]);
        }
      }
      deepStrictEqual(
        [shown, await activeSideBar(window), await usable(window)],
        [
          ROW_COMMANDS.flatMap(command => [
            [command, undefined, []],
            [command, undefined, []],
          ]),
          before,
          true,
        ],
      );
    } finally {
      await closeIfOpen(window);
    }
  });

  it('F-5002 AC-19 (execute-command): an extension that calls each of the 11 commands with executeCommand, with no argument and with a string, gets every call resolved, with no toast, no dialog and nothing changed', async () => {
    const window = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    try {
      const before = await settledSnapshot(window, false);
      const results: unknown[] = [];
      for (const [, command] of COMMANDS) {
        for (const parameters of [[], [NOT_A_ROW]]) {
          // A command that opens a pick resolves when the pick is closed, so the call is awaited after the pick is.
          const pending = callCommand(
            window,
            `remote-explorer.${command}`,
            ...parameters,
          );
          await settled(window);
          const outcome = await pending;
          results.push([
            command,
            outcome.rejection,
            await dialogOf(window),
            await notifications(window),
          ]);
        }
      }
      deepStrictEqual(
        [
          results,
          JSON.stringify(await snapshotOf(window, false)) === before,
          await usable(window),
        ],
        [
          COMMANDS.flatMap(([, command]) => [
            [command, undefined, undefined, []],
            [command, undefined, undefined, []],
          ]),
          true,
          true,
        ],
      );
    } finally {
      await closeIfOpen(window).catch(async (error: unknown) => {
        throw new Error(
          `${String(error)}; left open: dialog ${JSON.stringify(await dialogOf(window))}, pick ${JSON.stringify(await quickPickFacts(window))}`,
          {cause: error},
        );
      });
    }
  });
});
