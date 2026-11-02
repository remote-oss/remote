import {deepStrictEqual} from 'node:assert';
import {
  agentAdd,
  agentClear,
  agentKeys,
  connectionLog,
  fingerprintOf,
  closeWindow,
  reloadWindow,
  inWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerInputBox,
  connectSurface,
  dialogOf,
  inputBoxOf,
  pressEscape,
  notifications,
  quickPickOf,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  editorLogsFolder,
  readUserSettings,
  restoreUserSettings,
  secretHits,
} from '../windows/harness.ts';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  openKeyWindow,
  passphrase,
  untilConnected,
  untilPassphraseInput,
} from '../windows/key-windows.ts';

/** The placeholder of the passphrase input, with nothing after it (STR:S064). */
const PLACEHOLDER = 'Enter passphrase for ssh key ';

/** The message line core puts under every input box. */
const MESSAGE = "Press 'Enter' to confirm your input or 'Escape' to cancel";

/** Opens a window through `alias`, answers its passphrase input with the right passphrase, and waits until it is connected. */
async function connectedWithPassphrase(
  alias: string,
  label: string,
): Promise<string> {
  const name = await openKeyWindow(alias, label);
  await untilPassphraseInput(name);
  await answerInputBox(name, passphrase());
  await untilConnected(name, alias);
  return name;
}

/** Ends the shared connection of `alias` with Kill Local Connection Server For Host..., run in window `name`. */
async function killSharedConnection(
  name: string,
  alias: string,
): Promise<void> {
  void inWindow(name, 'opensshremotes.cleanLocalServer');
  await waitFor(
    'the host pick',
    async () => (await quickPickOf(name)) !== undefined,
    60_000,
  );
  // The pick lists more hosts than it draws, so the alias is typed into its filter.
  await answerInputBox(name, alias);
}

/** The run's passphrase key file. */
function passphraseKeyFile(): string {
  return `${variable('HARNESS_RUN_FOLDER')}/id_passphrase`;
}

/** Opens a window through `alias` and waits until it is connected, noting whether a passphrase input showed on the way. */
async function connectedWithoutInput(
  alias: string,
  label: string,
): Promise<{name: string; sawInput: boolean}> {
  const name = await openKeyWindow(alias, label);
  let sawInput = false;
  await waitFor(
    'the window to connect',
    async () => {
      sawInput ||= (await inputBoxOf(name)) !== undefined;
      return (
        (await windowState(name)).remoteName === 'ssh-remote' &&
        (await connectSurface(name)).indicator === `SSH: ${alias}`
      );
    },
    120_000,
  );
  return {name, sawInput};
}

/** What a first connection through `alias` shows when the host refuses every key: the dialog, and no input after it. */
async function refusedWithoutInput(alias: string, label: string) {
  const name = await openKeyWindow(alias, label);
  try {
    const dialog = await refusedDialog(name);
    return {dialog, input: await inputBoxOf(name)};
  } finally {
    await closeWindow(name).catch(() => undefined);
  }
}

/** The shape of the question to add a key to the agent, as the placeholder of a masked input. */
function questionShown(shown: {
  placeholder: string;
  masked: boolean | undefined;
  message: string | undefined;
}) {
  return {
    beginsWithAdd: shown.placeholder.startsWith(' Add key '),
    endsWithQuestion: shown.placeholder.endsWith(
      ' (acceptance-passphrase) to agent?',
    ),
    masked: shown.masked,
    message: shown.message,
  };
}

/** The question to add the key, as it is to read. */
const QUESTION = {
  beginsWithAdd: true,
  endsWithQuestion: true,
  masked: true,
  message: MESSAGE,
};
/** The dialog of the refused key: its details and buttons, once it shows. */
async function refusedDialog(name: string) {
  const dialog = await waitForDialog(name, 120_000);
  return {details: dialog.details, buttons: [...dialog.buttons].sort()};
}

/** What the AC-7 dialog holds for the alias `alias`. */
function refused(alias: string) {
  return {
    details: `Could not establish connection to "${alias}": Permission denied (publickey).`,
    buttons: ['Close Remote', 'More Actions...', 'Retry'],
  };
}

/** The lines of every log file of the editor, by file: the lines a row adds are those after the count taken before it. */
function editorLogLines(): Map<string, string[]> {
  const lines = new Map<string, string[]>();
  function walk(folder: string): void {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.log')) {
        lines.set(full, readFileSync(full, 'utf8').split('\n'));
      }
    }
  }
  walk(editorLogsFolder());
  return lines;
}

/** The lines the editor's logs gained since `before`. */
function editorLogsSince(before: Map<string, string[]>): string[] {
  return [...editorLogLines()].flatMap(([file, lines]) =>
    lines.slice(before.get(file)?.length ?? 0),
  );
}

describe('the passphrase input of a key (card coverage-96)', function () {
  this.timeout(300_000);

  it('F-2307 AC-1, AC-2 (c96-input): a passphrase key opens a masked input with the placeholder and message of the criterion, no title and no items, while the progress stays', async () => {
    const name = await openKeyWindow('passkey-1', 'c96-input');
    try {
      const shown = await untilPassphraseInput(name);
      deepStrictEqual(shown, {
        placeholder: PLACEHOLDER,
        value: '',
        masked: true,
        title: '',
        message: MESSAGE,
        items: 0,
      });
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-3, AC-5, AC-6 (c96-wrong-then-right): a wrong passphrase opens the same input again, empty, and the right one connects the window after the two inputs', async () => {
    const name = await openKeyWindow('passkey-2', 'c96-wrong-then-right');
    try {
      await untilPassphraseInput(name);
      await answerInputBox(name, 'not-the-passphrase');
      await waitFor(
        'the input again',
        async () =>
          (await inputBoxOf(name))?.value === '' &&
          (await inputBoxOf(name)) !== undefined,
        60_000,
      );
      const again = await inputBoxOf(name);
      await answerInputBox(name, passphrase());
      await untilConnected(name, 'passkey-2');
      deepStrictEqual(
        {
          again,
          indicator: (await connectSurface(name)).indicator,
          input: await inputBoxOf(name),
        },
        {
          again: {
            placeholder: PLACEHOLDER,
            value: '',
            masked: true,
            title: '',
            message: MESSAGE,
            items: 0,
          },
          indicator: 'SSH: passkey-2',
          input: undefined,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-8 (c96-three-wrong): three wrong passphrases end in the Permission denied dialog, and Retry opens the input again, where the right passphrase connects', async () => {
    const name = await openKeyWindow('passkey-3', 'c96-three-wrong');
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await untilPassphraseInput(name);
        await answerInputBox(name, `wrong-${String(attempt)}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const failed = {dialog: await refusedDialog(name)};
      await answerDialog(name, 'Retry');
      await untilPassphraseInput(name);
      await answerInputBox(name, passphrase());
      await untilConnected(name, 'passkey-3');
      deepStrictEqual(failed, {dialog: refused('passkey-3')});
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-9 (c96-escape): Escape at the passphrase input of a first connection ends in the Permission denied dialog with no further input', async () => {
    const name = await openKeyWindow('passkey-4', 'c96-escape');
    try {
      await untilPassphraseInput(name);
      await pressEscape(name);
      const dialog = await refusedDialog(name);
      deepStrictEqual(
        {dialog, input: await inputBoxOf(name)},
        {dialog: refused('passkey-4'), input: undefined},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-10 (c96-empty): Enter on an empty value of a first connection ends in the Permission denied dialog without a second input', async () => {
    const name = await openKeyWindow('passkey-5', 'c96-empty');
    try {
      await untilPassphraseInput(name);
      await answerInputBox(name, '');
      const dialog = await refusedDialog(name);
      deepStrictEqual(
        {dialog, dialogOf: (await dialogOf(name)) !== undefined},
        {dialog: refused('passkey-5'), dialogOf: true},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-4 (c96-agent-unchanged): after a connect with a passphrase key and no AddKeysToAgent the agent lists the same keys as before', async () => {
    await agentClear();
    const before = await agentKeys();
    const name = await connectedWithPassphrase(
      'passkey-6',
      'c96-agent-unchanged',
    );
    try {
      deepStrictEqual(await agentKeys(), before);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-25 (c96-wait-60): an input left unanswered for 60 seconds is still open, and the right passphrase then connects', async () => {
    const name = await openKeyWindow('passkey-7', 'c96-wait-60');
    try {
      await untilPassphraseInput(name);
      await new Promise(resolve => setTimeout(resolve, 62_000));
      const still = (await inputBoxOf(name))?.placeholder;
      await answerInputBox(name, passphrase());
      await untilConnected(name, 'passkey-7');
      deepStrictEqual(still, PLACEHOLDER);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-27 (c96-escape-second): with a second accepted key behind the passphrase key, Escape at the input connects with the second key and shows no failure dialog', async () => {
    const name = await openKeyWindow(
      'passkey-then-second',
      'c96-escape-second',
    );
    try {
      await untilPassphraseInput(name);
      await pressEscape(name);
      await untilConnected(name, 'passkey-then-second');
      deepStrictEqual(await dialogOf(name), undefined);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-11 (c96-reload): a window connected with a passphrase key and reloaded reconnects with no passphrase input', async () => {
    const name = await connectedWithPassphrase('passkey-8', 'c96-reload');
    try {
      await reloadWindow(name);
      await untilConnected(name, 'passkey-8');
      deepStrictEqual(await inputBoxOf(name), undefined);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-12 (c96-kill-shared): ending the shared connection reconnects the window, which asks for the passphrase again, and the right one restores the connection', async () => {
    const name = await connectedWithPassphrase('passkey-9', 'c96-kill-shared');
    try {
      await killSharedConnection(name, 'passkey-9');
      const input = await untilPassphraseInput(name);
      await answerInputBox(name, passphrase());
      await untilConnected(name, 'passkey-9');
      deepStrictEqual(input?.placeholder, PLACEHOLDER);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-7 (ruling-1681-first-label): three wrong passphrases end in the Permission denied dialog, and the indicator of the authority that never connected names the host', async () => {
    const name = await openKeyWindow('passkey-12', 'c96-first-label');
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await untilPassphraseInput(name);
        await answerInputBox(name, `wrong-${String(attempt)}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      deepStrictEqual(
        {
          dialog: await refusedDialog(name),
          indicator: (await connectSurface(name)).indicator,
        },
        {
          dialog: refused('passkey-12'),
          indicator: 'Disconnected from SSH: passkey-12',
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  /** The dialog of a refusal for lack of a usable key, with the agent holding the passphrase key when `agentHolds`. */
  async function noUsableKey(
    alias: string,
    label: string,
    agentHolds: boolean,
  ) {
    if (agentHolds) {
      await agentAdd(passphraseKeyFile(), {confirm: false});
    }
    try {
      return await refusedWithoutInput(alias, label);
    } finally {
      await agentClear();
    }
  }

  it('F-2307 AC-14 (c96-agent-has-key): with the accepted key in the agent no input appears and the window connects', async () => {
    await agentAdd(passphraseKeyFile(), {confirm: false});
    try {
      const {name, sawInput} = await connectedWithoutInput(
        'passkey-13',
        'c96-agent-has-key',
      );
      await closeWindow(name).catch(() => undefined);
      deepStrictEqual(sawInput, false);
    } finally {
      await agentClear();
    }
  });

  it('F-2307 AC-15 (c96-add-yes): with AddKeysToAgent yes the agent holds the key afterwards, and a later connection offering it shows no input', async () => {
    await agentClear();
    const name = await connectedWithPassphrase(
      'passkey-add-yes',
      'c96-add-yes',
    );
    try {
      const held = await agentKeys();
      const later = await connectedWithoutInput(
        'passkey-14',
        'c96-add-yes-later',
      );
      await closeWindow(later.name).catch(() => undefined);
      deepStrictEqual(
        {
          held: held.includes(await fingerprintOf(passphraseKeyFile())),
          sawInput: later.sawInput,
        },
        {held: true, sawInput: false},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await agentClear();
    }
  });

  /** AddKeysToAgent ask: the question the second input shows, and whether the agent holds the key after `answer`; Escape when none. */
  async function askedToAdd(alias: string, label: string, answer?: string) {
    await agentClear();
    const name = await openKeyWindow(alias, label);
    try {
      await untilPassphraseInput(name);
      await answerInputBox(name, passphrase());
      await waitFor(
        'the question to add the key',
        async () =>
          (await inputBoxOf(name))?.placeholder.includes('to agent?') === true,
        90_000,
      );
      const asked = await inputBoxOf(name);
      if (answer === undefined) {
        await pressEscape(name);
      } else {
        await answerInputBox(name, answer);
      }
      await untilConnected(name, alias);
      return {
        shown: questionShown({
          placeholder: asked?.placeholder ?? '',
          masked: asked?.masked,
          message: asked?.message,
        }),
        held: (await agentKeys()).includes(
          await fingerprintOf(passphraseKeyFile()),
        ),
      };
    } finally {
      await closeWindow(name).catch(() => undefined);
      await agentClear();
    }
  }

  it('F-2307 AC-16 (c96-ask-yes): with AddKeysToAgent ask the question to add the key is a second masked input, and yes adds the key', async () => {
    deepStrictEqual(await askedToAdd('passkey-ask-yes', 'c96-ask-yes', 'yes'), {
      shown: QUESTION,
      held: true,
    });
  });

  it('F-2307 AC-16 (c96-ask-no): no to the question leaves the key out of the agent, and the window connects', async () => {
    deepStrictEqual(await askedToAdd('passkey-ask-no', 'c96-ask-no', 'no'), {
      shown: QUESTION,
      held: false,
    });
  });

  it('F-2307 AC-31 (c96-confirm-key): a key in the agent with the confirm constraint, which the agent cannot ask about, gives no input and the Permission denied dialog on a first connection', async () => {
    await agentAdd(passphraseKeyFile(), {confirm: true});
    try {
      deepStrictEqual(
        await refusedWithoutInput('passkey-15', 'c96-confirm-key'),
        {
          dialog: refused('passkey-15'),
          input: undefined,
        },
      );
    } finally {
      await agentClear();
    }
  });

  it('F-2307 AC-19 (c96-key-missing): an IdentityFile that is missing gives no input and the Permission denied dialog', async () => {
    deepStrictEqual(
      await noUsableKey('nokey-missing', 'c96-key-missing', false),
      {
        dialog: refused('nokey-missing'),
        input: undefined,
      },
    );
  });

  it('F-2307 AC-19 (c96-key-none): IdentityFile none gives no input and the Permission denied dialog', async () => {
    deepStrictEqual(await noUsableKey('nokey-none', 'c96-key-none', false), {
      dialog: refused('nokey-none'),
      input: undefined,
    });
  });

  it('F-2307 AC-19 (c96-no-pubkey): PubkeyAuthentication no gives no input and the Permission denied dialog', async () => {
    deepStrictEqual(
      await noUsableKey('nokey-nopubkey', 'c96-no-pubkey', false),
      {
        dialog: refused('nokey-nopubkey'),
        input: undefined,
      },
    );
  });

  it('F-2307 AC-19 (c96-ids-only): IdentitiesOnly yes with only the agent holding the key gives no input and the Permission denied dialog', async () => {
    deepStrictEqual(
      await noUsableKey('nokey-agent-only', 'c96-ids-only', true),
      {
        dialog: refused('nokey-agent-only'),
        input: undefined,
      },
    );
  });

  it('F-2307 AC-19 (c96-agent-none): IdentityAgent none with only the agent holding the key gives no input and the Permission denied dialog', async () => {
    deepStrictEqual(
      await noUsableKey('nokey-agent-none', 'c96-agent-none', true),
      {
        dialog: refused('nokey-agent-none'),
        input: undefined,
      },
    );
  });

  it('F-2307 AC-20 (c96-other-file): IdentitiesOnly no, the accepted key in the agent and another IdentityFile: it connects with the agent key and no input', async () => {
    await agentAdd(passphraseKeyFile(), {confirm: false});
    try {
      const {name, sawInput} = await connectedWithoutInput(
        'agent-other-file',
        'c96-other-file',
      );
      await closeWindow(name).catch(() => undefined);
      deepStrictEqual(sawInput, false);
    } finally {
      await agentClear();
    }
  });

  it('F-2307 AC-21 (c96-several-files): a missing file, a passphrase key the host refuses and an accepted key: no passphrase input, and the window connects', async () => {
    const {name, sawInput} = await connectedWithoutInput(
      'several-files',
      'c96-several-files',
    );
    await closeWindow(name).catch(() => undefined);
    deepStrictEqual(sawInput, false);
  });

  it('F-2307 AC-22 (c96-loose-key): a key file with mode 0644 gives the dialog with only Permission denied, and the warning is in the log, not in the dialog, a notification or a terminal', async () => {
    const name = await openKeyWindow('loosekey', 'c96-loose-key');
    try {
      const dialog = await refusedDialog(name);
      deepStrictEqual(
        {
          dialog,
          warned: connectionLog().some(line =>
            line.includes('UNPROTECTED PRIVATE KEY FILE'),
          ),
          toasts: (await notifications(name)).filter(
            text => !text.startsWith('Setting up SSH Host'),
          ),
        },
        {dialog: refused('loosekey'), warned: true, toasts: []},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-16 (c96-ask-escape): Escape at the question adds the key, and the window connects', async () => {
    deepStrictEqual(await askedToAdd('passkey-ask-escape', 'c96-ask-escape'), {
      shown: QUESTION,
      held: true,
    });
  });

  it('F-2307 AC-18 (c96-cert-only): a key with a certificate beside it, for a host that accepts only the certificate, connects with no input', async () => {
    const {name, sawInput} = await connectedWithoutInput(
      'certonly',
      'c96-cert-only',
    );
    await closeWindow(name).catch(() => undefined);
    deepStrictEqual(sawInput, false);
  });

  it('F-2307 AC-18 (c96-cert-missing): without any certificate found the connect ends in the Permission denied dialog, with no input', async () => {
    deepStrictEqual(
      await refusedWithoutInput('certonly-nocert', 'c96-cert-missing'),
      {
        dialog: refused('certonly-nocert'),
        input: undefined,
      },
    );
  });

  it('F-2307 AC-23 (c96-terminal-mode): in the terminal mode exactly one passphrase input appears per connection, and the right passphrase connects', async () => {
    await setUserSetting('remote.SSH.useLocalServer', false);
    const name = await openKeyWindow('passkey-16', 'c96-terminal-mode');
    try {
      const opened: string[] = [];
      await untilPassphraseInput(name);
      // The first input is still on screen when the answer is given.
      let open = true;
      await answerInputBox(name, passphrase());
      await waitFor(
        'the window to connect',
        async () => {
          const input = await inputBoxOf(name);
          const shown = input !== undefined;
          if (shown && !open) {
            opened.push(input.placeholder);
          }
          open = shown;
          return (
            (await windowState(name)).remoteName === 'ssh-remote' &&
            (await connectSurface(name)).indicator === 'SSH: passkey-16'
          );
        },
        120_000,
      );
      deepStrictEqual(opened, []);
    } finally {
      await closeWindow(name).catch(() => undefined);
      await setUserSetting('remote.SSH.useLocalServer', undefined);
    }
  });

  it('F-2307 AC-32 (c96-no-attempts): with maxReconnectionAttempts 0 the shared connection ended still reconnects and asks for the passphrase again', async () => {
    await setUserSetting('remote.SSH.maxReconnectionAttempts', 0);
    const name = await connectedWithPassphrase('passkey-17', 'c96-no-attempts');
    try {
      await killSharedConnection(name, 'passkey-17');
      const input = await untilPassphraseInput(name);
      await answerInputBox(name, passphrase());
      await untilConnected(name, 'passkey-17');
      deepStrictEqual(input?.placeholder, PLACEHOLDER);
    } finally {
      await closeWindow(name).catch(() => undefined);
      await setUserSetting('remote.SSH.maxReconnectionAttempts', undefined);
    }
  });

  it('F-2307 AC-33 (c96-config-mode): a configuration file with mode 0666 in a folder with mode 0777 gives no warning or dialog, and the window connects', async () => {
    const before = readUserSettings();
    const original = (JSON.parse(before ?? '{}') as Record<string, unknown>)[
      'remote.SSH.configFile'
    ];
    const folder = mkdtempSync(
      path.join(variable('HARNESS_RUN_FOLDER'), 'config-mode-'),
    );
    chmodSync(folder, 0o777);
    const file = path.join(folder, 'config');
    writeFileSync(file, readFileSync(String(original)), {mode: 0o666});
    chmodSync(file, 0o666);
    await setUserSetting('remote.SSH.configFile', file);
    try {
      const {name, sawInput} = await connectedWithoutInput(
        'several-files',
        'c96-config-mode',
      );
      try {
        deepStrictEqual(
          {
            sawInput,
            dialog: await dialogOf(name),
            toasts: (await notifications(name)).filter(
              text => !text.startsWith('Setting up SSH Host'),
            ),
          },
          {sawInput: false, dialog: undefined, toasts: []},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    } finally {
      restoreUserSettings(before);
    }
  });

  it('F-2307 AC-13, AC-26 (c96-reconnect-escape): Escape at the reconnection input ends in an unhandled NotAvailable that core gives up on, the indicator is disconnected with the host, and no failure dialog of ours is shown', async () => {
    const name = await connectedWithPassphrase(
      'passkey-18',
      'c96-reconnect-escape',
    );
    try {
      const before = editorLogLines();
      await killSharedConnection(name, 'passkey-18');
      await untilPassphraseInput(name);
      await pressEscape(name);
      await waitFor(
        'core to give up',
        () =>
          editorLogsSince(before).some(line =>
            line.includes('Will give up now!'),
          ),
        60_000,
      );
      const added = editorLogsSince(before);
      deepStrictEqual(
        {
          unhandled: added.some(
            line =>
              line.includes('resolveAuthority(ssh-remote,2)') &&
              line.includes('"code":"NotAvailable"') &&
              line.includes('"detail":false'),
          ),
          gaveUp: added.some(line =>
            line.includes(
              'A RemoteAuthorityResolverError occurred while trying to reconnect. Will give up now!',
            ),
          ),
          indicator: (await connectSurface(name)).indicator,
          ownDialog:
            (await dialogOf(name))?.details.startsWith(
              'Could not establish connection',
            ) === true,
        },
        {
          unhandled: true,
          gaveUp: true,
          indicator: 'Disconnected from SSH: passkey-18',
          ownDialog: false,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-17 (c96-confirm-added): with AddKeysToAgent confirm the first connection adds the key, and a later connection offering it fails with no input, Permission denied in the log and the dialog of a first connection', async () => {
    await agentClear();
    const first = await connectedWithPassphrase(
      'passkey-add-confirm',
      'c96-confirm-added',
    );
    try {
      const held = (await agentKeys()).includes(
        await fingerprintOf(passphraseKeyFile()),
      );
      const mark = connectionLog().length;
      const later = await refusedWithoutInput(
        'passkey-19',
        'c96-confirm-later',
      );
      deepStrictEqual(
        {
          held,
          later,
          logged: connectionLog()
            .slice(mark)
            .some(line => line.includes('Permission denied (publickey).')),
        },
        {
          held: true,
          later: {dialog: refused('passkey-19'), input: undefined},
          logged: true,
        },
      );
    } finally {
      await closeWindow(first).catch(() => undefined);
      await agentClear();
    }
  });

  it('F-2307 AC-28 (c96-cert-passphrase): a passphrase key with a certificate, for a host that accepts only the certificate, asks for the passphrase and connects with it', async () => {
    const name = await openKeyWindow('certpass', 'c96-cert-passphrase');
    try {
      const input = await untilPassphraseInput(name);
      await answerInputBox(name, passphrase());
      await untilConnected(name, 'certpass');
      deepStrictEqual(input?.placeholder, PLACEHOLDER);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2307 AC-30 (c96-agent-var-set): IdentityAgent naming a variable of the editor’s environment reaches the agent holding the key: no input, it connects', async () => {
    await agentAdd(passphraseKeyFile(), {confirm: false});
    try {
      const {name, sawInput} = await connectedWithoutInput(
        'agent-var-set',
        'c96-agent-var-set',
      );
      await closeWindow(name).catch(() => undefined);
      deepStrictEqual(sawInput, false);
    } finally {
      await agentClear();
    }
  });

  it('F-2307 AC-30 (c96-agent-var-unset): IdentityAgent naming a variable the editor was not started with finds no agent: no input and the dialog of a first connection', async () => {
    await agentAdd(passphraseKeyFile(), {confirm: false});
    try {
      deepStrictEqual(
        await refusedWithoutInput('agent-var-unset', 'c96-agent-var-unset'),
        {
          dialog: refused('agent-var-unset'),
          input: undefined,
        },
      );
    } finally {
      await agentClear();
    }
  });

  it('F-2307 AC-24 (c96-nowhere): after the flows of this feature, the passphrase is in no file of the profile, the logs, the extensions’ folders or the user’s home, and the search finds it where the harness keeps it', () => {
    const folder = variable('HARNESS_RUN_FOLDER');
    const places = [
      {client: path.join(folder, 'home-passphrase')},
      {client: variable('HARNESS_USER_DATA')},
      {client: editorLogsFolder()},
      ...readdirSync(folder)
        .filter(name => name.startsWith('extensions'))
        .map(name => ({client: path.join(folder, name)})),
      {client: variable('REMOTE_OSS_ACCEPTANCE_LOG')},
      {client: variable('REMOTE_OSS_ACCEPTANCE_RECORD')},
    ];
    deepStrictEqual(
      {
        found: secretHits([passphrase()], places),
        control: secretHits(
          [passphrase()],
          [{client: path.join(folder, 'passphrase')}],
        ).length,
      },
      {found: [], control: 1},
    );
  });
});
