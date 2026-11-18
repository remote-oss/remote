/**
 * @fileoverview F-2006's commands of Remote - SSH run by a user keybinding where they don't apply (card #2817): in an
 * empty local window, a connected one, a disconnected one, one that is still connecting and one whose extension is not
 * active, a press does no more than R-46's information notice: no window, no connection, no write, no error, and the
 * window stays what it was. No command has a default keybinding, so each row binds Ctrl+Alt and a letter to the
 * commands it presses, and proves first that the binding is live in its window.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {
  appendScript,
  connected,
  connectedWithin,
  connectionHelpers,
  connectionLog,
  extensionActive,
  inWindow,
  isOpen,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  signal,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  SSH_EXTENSION,
  remoteSshEntries,
  sshActivations,
  windowWithLog,
} from '../windows/activation-support.ts';
import {bindKeys, userFilesText} from '../windows/key-bindings.ts';
import {
  closeAllButLocal,
  dismissals,
  openConnected,
  platformAnswer,
  serverMainProcesses,
} from '../windows/maintenance.ts';
import {runFromPalette} from '../windows/palette.ts';
import {
  dialogOf,
  notifications,
  pressControlAlt,
  pressEscape,
  quickPickOf,
  statusBarText,
} from '../windows/renderer.ts';
import {
  emptyLocalWindow,
  failedWindow,
  indicatorReads,
} from '../windows/window-states.ts';

/** A command of Remote - SSH that a row presses: its id, its title without the category, and the letter it is bound to. */
interface PressedCommand {
  id: string;
  title: string;
  letter: string;
}

const NEW_WINDOW: PressedCommand = {
  id: 'opensshremotes.openEmptyWindowOnCurrentHost',
  title: 'New Window on Active Host',
  letter: 'j',
};
const FEEDBACK: PressedCommand = {
  id: 'opensshremotes.provideFeedback',
  title: 'Provide Feedback',
  letter: 'k',
};
const KILL_CURRENT: PressedCommand = {
  id: 'opensshremotes.cleanCurrentRemoteServer',
  title: 'Kill Current VS Code Server',
  letter: 'l',
};
const WEB_UI: PressedCommand = {
  id: 'opensshremotes.openWebUI',
  title: 'Open Web UI',
  letter: 'm',
};
const GET_STARTED: PressedCommand = {
  id: 'opensshremotes.getStarted',
  title: 'Get Started with SSH',
  letter: 'n',
};
const KILL_LOCAL: PressedCommand = {
  id: 'opensshremotes.cleanLocalServer',
  title: 'Kill Local Connection Server For Host...',
  letter: 'o',
};
const CLEAR_HINTS: PressedCommand = {
  id: 'opensshremotes.clearAllSessionHints',
  title: 'Clear previous session metadata (used for enhanced error reporting)',
  letter: 'p',
};

/** Every command a row presses. */
const COMMANDS: readonly PressedCommand[] = [
  NEW_WINDOW,
  FEEDBACK,
  KILL_CURRENT,
  WEB_UI,
  GET_STARTED,
  KILL_LOCAL,
  CLEAR_HINTS,
];

/** The key that opens the Command Palette, to prove that the bindings are live in a window. */
const PROBE_LETTER = 'y';

/** The placeholder of the host pick of the Kill Local Connection Server command (STR:S127). */
const HOST_PICK_PLACEHOLDER = 'Select configured SSH host or enter user@host';

/** R-46's notification for `command`: an information line naming the command by its title, with no category. */
function outOfContext(command: PressedCommand): string {
  return `'${command.title}' is not possible in the current context.`;
}

/** The hosts the rows need no platform pick for. */
const PLATFORMS = {harness: 'linux', refused: 'linux', nowhere: 'linux'};

/** What a window shows and what the run holds, before and after a press. */
interface Effects {
  windows: string;
  files: [string, string | undefined];
  sshConfig: string;
  picker: boolean;
  dialog: boolean;
  toasts: string[];
  indicator: string;
  activations: number;
  editor: string;
  helpers: number[];
  servers: number[];
}

/** The effects of the press in window `name`, read once. */
async function effectsOf(name: string): Promise<Effects> {
  return {
    windows: windowNames().join(','),
    files: userFilesText(),
    sshConfig: readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8'),
    picker: (await quickPickOf(name)) !== undefined,
    dialog: (await dialogOf(name)) !== undefined,
    toasts: await notifications(name),
    indicator: await statusBarText(name, 'status.host').catch(() => ''),
    activations: windowEvents(name).filter(each => each.event === 'activated')
      .length,
    editor: JSON.stringify((await windowState(name)).activeTab),
    helpers: await connectionHelpers(),
    servers: await serverMainProcesses(),
  };
}

/** Waits the settle time a press has to take effect. */
function settle(milliseconds = 3000): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** The effects around one press of `command`'s key in window `name`. */
async function pressed(
  name: string,
  command: PressedCommand,
): Promise<{before: Effects; after: Effects}> {
  const before = await effectsOf(name);
  await pressControlAlt(name, command.letter);
  await settle();
  return {before, after: await effectsOf(name)};
}

/**
 * Proves that the bindings of the row are live in window `name`: the key bound to the Command Palette opens it. A press
 * of another key that did nothing at all could be a binding that never took effect; this tells the two apart.
 */
async function bindingsAreLive(name: string): Promise<void> {
  await pressControlAlt(name, PROBE_LETTER);
  await waitFor(
    `the Command Palette to open on Ctrl+Alt+${PROBE_LETTER.toUpperCase()} in ${name}`,
    async () => (await quickPickOf(name)) !== undefined,
    15_000,
  );
  await pressEscape(name);
  await waitFor(
    `the Command Palette to close in ${name}`,
    async () => (await quickPickOf(name)) === undefined,
    15_000,
  );
}

/**
 * What a press may leave of its own, given `allowed` notifications: the toasts that were not there before and are not one
 * of `allowed`, so that a press that showed R-46's line and nothing else leaves none.
 */
function unexpectedToasts(
  before: Effects,
  after: Effects,
  allowed: readonly string[],
): string[] {
  return after.toasts.filter(
    toast => !before.toasts.includes(toast) && !allowed.includes(toast),
  );
}

/** What changed that no press may change: the windows, the user's and the ssh files, the picker, the dialog and the host. */
function changes(before: Effects, after: Effects): string[] {
  const fields: Array<keyof Effects> = [
    'windows',
    'files',
    'sshConfig',
    'picker',
    'dialog',
    'indicator',
    'activations',
    'editor',
    'helpers',
    'servers',
  ];
  return fields.filter(
    field => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

/** Whether window `name` is open and answers its agent, which is all that "usable" needs of a window that shows nothing. */
async function usable(name: string): Promise<boolean> {
  try {
    await inWindow(name, 'acceptance.agent.state');
    return isOpen(name);
  } catch {
    return false;
  }
}

/** A fresh window, empty, whose extension has not been activated, and the log that would tell it was. */
function freshWindow(): Promise<{name: string; logFile: string}> {
  return windowWithLog(emptyLocalWindow);
}

/** The state a connect that ends connected is in: the remote, the indicator, and whether a failure was shown. */
async function connectedEnd(name: string): Promise<{
  remoteName: string | null;
  connected: boolean;
  indicator: string;
  failures: number;
}> {
  return {
    remoteName: (await windowState(name)).remoteName,
    connected: await connected(name),
    indicator: await statusBarText(name, 'status.host').catch(() => ''),
    failures: recordLines('failureDialog', name).length,
  };
}

/** The signal that releases the held platform pick of a window. */
function releaseOf(name: string): string {
  return `${name}-go`;
}

/** Opens window `name` on `harness` and holds its connect at the platform pick, with its indicator reading "Opening Remote". */
async function connectingWindow(name: string): Promise<void> {
  appendScript([
    {
      ...platformAnswer('linux'),
      match: 'Select the platform',
      window: name,
      after: releaseOf(name),
    },
    ...dismissals(name),
  ]);
  await openWindow('harness', name);
  await indicatorReads(name, 'Opening Remote', 60_000);
}

/** Lets a held connect of window `name` go on and waits until the window is connected. */
async function finishConnecting(name: string): Promise<void> {
  signal(releaseOf(name));
  await connectedWithin(name, 120_000);
}

/** The keys of the user's settings, as the file holds them. */
function settingsKeys(): string[] {
  const text = readUserSettings();
  return text === undefined
    ? []
    : Object.keys(JSON.parse(text) as Record<string, unknown>).sort();
}

describe('Remote-SSH commands run where they do not apply (F-2006, card #2817)', function () {
  this.timeout(600_000);

  let saved: string | undefined;
  let unbind: (() => void) | undefined;

  before(async () => {
    saved = readUserSettings();
    await userSettings({'remote.SSH.remotePlatform': PLATFORMS});
    unbind = bindKeys([
      ...COMMANDS.map(command => ({
        key: `ctrl+alt+${command.letter}`,
        command: command.id,
      })),
      {
        key: `ctrl+alt+${PROBE_LETTER}`,
        command: 'workbench.action.showCommands',
      },
    ]);
  });

  afterEach(async () => {
    await closeAllButLocal();
  });

  after(() => {
    unbind?.();
    restoreUserSettings(saved);
  });

  it('F-2006 AC-14 (c2817-empty-window): in an empty local window, New Window on Active Host, Provide Feedback, Kill Current VS Code Server and Open Web UI run by keybinding open no window, start no connection, change no settings or configuration file, leave the window usable, and show at most R-46’s notice', async () => {
    const {name, logFile} = await freshWindow();
    await bindingsAreLive(name);
    const results: Array<{
      command: string;
      changed: string[];
      unexpected: string[];
    }> = [];
    const logBefore = connectionLog().length;
    for (const command of [NEW_WINDOW, FEEDBACK, KILL_CURRENT, WEB_UI]) {
      const {before, after} = await pressed(name, command);
      results.push({
        command: command.title,
        changed: changes(before, after),
        unexpected: unexpectedToasts(before, after, [outOfContext(command)]),
      });
    }
    deepStrictEqual(
      {
        results,
        connectionLines: connectionLog().length - logBefore,
        usable: await usable(name),
        // The presses reached the extension: it was inactive and the first command activated it.
        activations: sshActivations(logFile),
        active: await extensionActive(name, SSH_EXTENSION),
      },
      {
        results: [NEW_WINDOW, FEEDBACK, KILL_CURRENT, WEB_UI].map(command => ({
          command: command.title,
          changed: [],
          unexpected: [],
        })),
        connectionLines: 0,
        usable: true,
        activations: [`onCommand:${NEW_WINDOW.id}`],
        active: true,
      },
    );
  });

  it('F-2006 AC-15 (c2817-connected): in a connected SSH window, Get Started with SSH and Open Web UI without enableWebAccess run by keybinding leave the connection up, write nothing, and show at most R-46’s notice', async () => {
    await openConnected('c2817-connected');
    await bindingsAreLive('c2817-connected');
    const results: Array<{
      command: string;
      changed: string[];
      unexpected: string[];
      connected: boolean;
    }> = [];
    for (const command of [GET_STARTED, WEB_UI]) {
      const {before, after} = await pressed('c2817-connected', command);
      results.push({
        command: command.title,
        changed: changes(before, after),
        unexpected: unexpectedToasts(before, after, [outOfContext(command)]),
        connected: await connected('c2817-connected'),
      });
    }
    deepStrictEqual(
      results,
      [GET_STARTED, WEB_UI].map(command => ({
        command: command.title,
        changed: [],
        unexpected: [],
        connected: true,
      })),
    );
  });

  for (const useLocalServer of [true, false]) {
    it(`F-2006 AC-16 (c2817-disconnected-${useLocalServer ? 'default' : 'no-local-server'}): in a disconnected SSH window${useLocalServer ? ' with the default settings' : ' with remote.SSH.useLocalServer false'}, New Window on Active Host, Kill Current VS Code Server and Open Web UI run by keybinding leave it an SSH window and usable, change no settings file, stop no connection server, kill no server and show at most R-46’s notice`, async () => {
      const name = `c2817-disconnected-${useLocalServer ? 'default' : 'no-local-server'}`;
      if (!useLocalServer) {
        await userSettings({'remote.SSH.useLocalServer': false});
      }
      try {
        await failedWindow('refused', name);
        await bindingsAreLive(name);
        const results: Array<{
          command: string;
          settingsChanged: boolean;
          helpers: boolean;
          servers: boolean;
          stillSsh: boolean;
          usable: boolean;
          reloaded: boolean;
          unexpected: string[];
        }> = [];
        for (const command of [NEW_WINDOW, KILL_CURRENT, WEB_UI]) {
          const {before, after} = await pressed(name, command);
          // A confirmation the command asks for is not answered: Escape leaves the window as it was.
          if (after.dialog) {
            await pressEscape(name);
            await settle(1000);
          }
          const done = await effectsOf(name);
          results.push({
            command: command.title,
            settingsChanged:
              JSON.stringify(before.files) !== JSON.stringify(done.files),
            helpers:
              JSON.stringify(before.helpers) === JSON.stringify(done.helpers),
            servers:
              JSON.stringify(before.servers) === JSON.stringify(done.servers),
            stillSsh: (await windowState(name)).remoteName === 'ssh-remote',
            usable: await usable(name),
            reloaded: before.activations !== done.activations,
            unexpected: unexpectedToasts(before, done, [outOfContext(command)]),
          });
        }
        deepStrictEqual(
          results,
          [NEW_WINDOW, KILL_CURRENT, WEB_UI].map(command => ({
            command: command.title,
            settingsChanged: false,
            helpers: true,
            servers: true,
            stillSsh: true,
            usable: true,
            reloaded: false,
            unexpected: [],
          })),
        );
      } finally {
        await userSettings({'remote.SSH.useLocalServer': undefined});
      }
    });
  }

  it('F-2006 AC-17 (c2817-kill-local-escape): with remote.SSH.useLocalServer false, Kill Local Connection Server For Host... run by keybinding in a local and in a connected window changes nothing when Escape is pressed in any picker, and a host pick it shows has the placeholder of STR:S127', async () => {
    await userSettings({'remote.SSH.useLocalServer': false});
    try {
      const local = await emptyLocalWindow();
      await openConnected('c2817-kill-local');
      const picks: string[] = [];
      const results: Array<{
        window: string;
        changed: string[];
        unexpected: string[];
      }> = [];
      for (const name of [local, 'c2817-kill-local']) {
        appendScript([
          {
            surface: 'hostPick',
            match: 'Select configured SSH host',
            answer: 'dismiss',
            window: name,
          },
        ]);
        await bindingsAreLive(name);
        const {before, after} = await pressed(name, KILL_LOCAL);
        if (after.picker) {
          await pressEscape(name);
          await settle(1000);
        }
        const done = await effectsOf(name);
        picks.push(...recordLines('hostPick', name).map(line => line.question));
        results.push({
          window: name === local ? 'local' : 'connected',
          changed: changes(before, done),
          unexpected: unexpectedToasts(before, done, [
            outOfContext(KILL_LOCAL),
          ]),
        });
      }
      deepStrictEqual(
        {
          results,
          placeholders: picks.filter(
            question => question !== HOST_PICK_PLACEHOLDER,
          ),
          connected: await connected('c2817-kill-local'),
        },
        {
          results: [
            {window: 'local', changed: [], unexpected: []},
            {window: 'connected', changed: [], unexpected: []},
          ],
          placeholders: [],
          connected: true,
        },
      );
    } finally {
      await userSettings({'remote.SSH.useLocalServer': undefined});
    }
  });

  it('F-2006 AC-19 (c2817-clear-hints-connecting): invoking opensshremotes.clearAllSessionHints by keybinding and by executeCommand in a window that is connecting does not break the attempt, which ends connected exactly as a control run without the command does', async () => {
    await userSettings({
      'remote.SSH.useLocalServer': false,
      'remote.SSH.remotePlatform': undefined,
    });
    try {
      await connectingWindow('c2817-control');
      await finishConnecting('c2817-control');
      const control = await connectedEnd('c2817-control');
      await userSettings({'remote.SSH.remotePlatform': undefined});
      await connectingWindow('c2817-clear');
      await bindingsAreLive('c2817-clear');
      await pressControlAlt('c2817-clear', CLEAR_HINTS.letter);
      await inWindow('c2817-clear', CLEAR_HINTS.id);
      await settle();
      const stillConnecting = (
        await statusBarText('c2817-clear', 'status.host')
      ).startsWith('Opening Remote');
      await finishConnecting('c2817-clear');
      deepStrictEqual(
        [stillConnecting, await connectedEnd('c2817-clear'), control.connected],
        [true, control, true],
      );
    } finally {
      await userSettings({
        'remote.SSH.useLocalServer': undefined,
        'remote.SSH.remotePlatform': PLATFORMS,
      });
    }
  });

  it('F-2006 AC-20 (c2817-inactive): in a window in which the extension is not active, the commands the palette hides run by keybinding show no error notification and leave the window usable', async () => {
    const {name, logFile} = await freshWindow();
    const inactiveBefore = !(await extensionActive(name, SSH_EXTENSION));
    await bindingsAreLive(name);
    const errors: string[] = [];
    for (const command of [NEW_WINDOW, KILL_CURRENT, WEB_UI, FEEDBACK]) {
      await pressControlAlt(name, command.letter);
      await settle();
      errors.push(
        ...(await notifications(name)).filter(
          toast =>
            toast !== outOfContext(command) &&
            /error|fail|not found|cannot|unable/i.test(toast),
        ),
      );
    }
    deepStrictEqual(
      {
        inactiveBefore,
        errors,
        usable: await usable(name),
        // The presses reached the extension, which they activated.
        activations: sshActivations(logFile).length > 0,
      },
      {inactiveBefore: true, errors: [], usable: true, activations: true},
    );
  });

  it('F-2006 AC-21 (c2817-no-extra-settings): after the palette listings and the out-of-context runs of this feature in a local and a connected window, settings.json holds no key the user did not write', async () => {
    const local = await emptyLocalWindow();
    await openConnected('c2817-settings');
    await bindingsAreLive(local);
    await bindingsAreLive('c2817-settings');
    const written = settingsKeys();
    const listed = [
      (await remoteSshEntries(local)).length,
      (await remoteSshEntries('c2817-settings')).length,
    ];
    for (const command of [NEW_WINDOW, FEEDBACK, KILL_CURRENT, WEB_UI]) {
      await pressControlAlt(local, command.letter);
      await settle(1500);
    }
    for (const command of [GET_STARTED, WEB_UI]) {
      await pressControlAlt('c2817-settings', command.letter);
      await settle(1500);
    }
    deepStrictEqual(
      [listed.every(count => count > 0), settingsKeys()],
      [true, written],
    );
  });

  it('F-2006 AC-22 (c2817-notice): R-46’s notice, where a press shows it, is a non-modal information notification reading "\'<title>\' is not possible in the current context." with the command’s title without the category', async () => {
    const local = await emptyLocalWindow();
    await openConnected('c2817-notice');
    await bindingsAreLive(local);
    await bindingsAreLive('c2817-notice');
    const seen: Array<{window: string; toast: string; modal: boolean}> = [];
    for (const [name, label, commands] of [
      [local, 'local', [NEW_WINDOW, FEEDBACK, KILL_CURRENT, WEB_UI]],
      ['c2817-notice', 'connected', [GET_STARTED, WEB_UI]],
    ] as const) {
      for (const command of commands) {
        const {before, after} = await pressed(name, command);
        for (const toast of after.toasts.filter(
          each => !before.toasts.includes(each),
        )) {
          seen.push({
            window: `${label}: ${command.title}`,
            toast,
            modal: after.dialog,
          });
        }
      }
    }
    const notices = seen.filter(each =>
      each.toast.endsWith('is not possible in the current context.'),
    );
    deepStrictEqual(
      {
        // At least one press showed the notice, or this row proved nothing.
        shown: notices.length > 0,
        wrongTexts: notices.filter(
          each =>
            !COMMANDS.some(command => each.toast === outOfContext(command)),
        ),
        modal: notices.filter(each => each.modal),
      },
      {shown: true, wrongTexts: [], modal: []},
      `the toasts the presses showed: ${JSON.stringify(seen)}`,
    );
  });

  it('F-2006 AC-23 (c2817-connecting): in an SSH window that is connecting, New Window on Active Host, Kill Current VS Code Server and Kill Local Connection Server For Host... (Escape in any picker) run by keybinding leave the attempt going, which ends as a control run does, and the window is not closed or reloaded', async () => {
    await userSettings({
      'remote.SSH.useLocalServer': false,
      'remote.SSH.remotePlatform': undefined,
    });
    try {
      await connectingWindow('c2817-control-23');
      await finishConnecting('c2817-control-23');
      const control = await connectedEnd('c2817-control-23');
      await userSettings({'remote.SSH.remotePlatform': undefined});
      await connectingWindow('c2817-pressed');
      appendScript([
        {
          surface: 'hostPick',
          match: 'Select configured SSH host',
          answer: 'dismiss',
          window: 'c2817-pressed',
        },
      ]);
      await bindingsAreLive('c2817-pressed');
      const during: Array<{
        command: string;
        stillConnecting: boolean;
        open: boolean;
        reloaded: boolean;
      }> = [];
      for (const command of [NEW_WINDOW, KILL_CURRENT, KILL_LOCAL]) {
        const {before, after} = await pressed('c2817-pressed', command);
        if (after.picker) {
          await pressEscape('c2817-pressed');
          await settle(1000);
        }
        const done = await effectsOf('c2817-pressed');
        during.push({
          command: command.title,
          stillConnecting: done.indicator.startsWith('Opening Remote'),
          open: isOpen('c2817-pressed'),
          reloaded: before.activations !== done.activations,
        });
      }
      await finishConnecting('c2817-pressed');
      deepStrictEqual(
        [during, await connectedEnd('c2817-pressed')],
        [
          [NEW_WINDOW, KILL_CURRENT, KILL_LOCAL].map(command => ({
            command: command.title,
            stillConnecting: true,
            open: true,
            reloaded: false,
          })),
          control,
        ],
      );
    } finally {
      await userSettings({
        'remote.SSH.useLocalServer': undefined,
        'remote.SSH.remotePlatform': PLATFORMS,
      });
    }
  });

  for (const chat of [undefined, true, false]) {
    it(`F-2006 AC-26 (c2817-clear-hints-palette-${chat === undefined ? 'default' : String(chat)}): with ${chat === undefined ? 'the default settings' : `remote.SSH.experimental.chat as ${String(chat)}`}, "Remote-SSH: ${CLEAR_HINTS.title}" typed into the palette of a local and of a connected window is listed and runs with no UI, and the connected window stays connected`, async () => {
      await userSettings({'remote.SSH.experimental.chat': chat});
      try {
        const local = await emptyLocalWindow();
        await openConnected('c2817-hints');
        const entry = `Remote-SSH: ${CLEAR_HINTS.title}`;
        const results: Array<{window: string; listed: boolean; ui: string[]}> =
          [];
        for (const [name, label] of [
          [local, 'local'],
          ['c2817-hints', 'connected'],
        ] as const) {
          const listed = (await remoteSshEntries(name)).includes(entry);
          await runFromPalette(name, entry);
          await settle();
          results.push({
            window: label,
            listed,
            ui: [
              ...((await quickPickOf(name)) === undefined
                ? []
                : ['a quick pick']),
              ...((await dialogOf(name)) === undefined ? [] : ['a dialog']),
              ...(await notifications(name)),
            ],
          });
        }
        deepStrictEqual(
          [results, await connected('c2817-hints')],
          [
            [
              {window: 'local', listed: true, ui: []},
              {window: 'connected', listed: true, ui: []},
            ],
            true,
          ],
        );
      } finally {
        await userSettings({'remote.SSH.experimental.chat': undefined});
      }
    });
  }
});
