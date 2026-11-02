import {deepStrictEqual} from 'node:assert';
import {
  agentClear,
  agentKeys,
  closeWindow,
  reloadWindow,
  inWindow,
  onHostAs,
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
  quickPickOf,
  waitForDialog,
} from '../windows/renderer.ts';
import {readFileSync} from 'node:fs';

/** The placeholder of the passphrase input, with nothing after it (STR:S064). */
const PLACEHOLDER = 'Enter passphrase for ssh key ';

/** The message line core puts under every input box. */
const MESSAGE = "Press 'Enter' to confirm your input or 'Escape' to cancel";

/** The run's passphrase. */
function passphrase(): string {
  return readFileSync(variable('HARNESS_PASSPHRASE_FILE'), 'utf8').trim();
}

/** Opens a window on folder `label` of the user `harness` through the alias `alias`; the window is named `label`. */
async function openKeyWindow(alias: string, label: string): Promise<string> {
  await onHostAs('harness', 'mkdir', '-p', `/home/harness/${label}`);
  void inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+${alias}/home/harness/${label}`,
  );
  return label;
}

/** Waits until the passphrase input of window `name` is open; gives what it shows. */
async function untilPassphraseInput(name: string, milliseconds = 90_000) {
  await waitFor(
    `the passphrase input of ${name}`,
    async () =>
      (await inputBoxOf(name))?.placeholder.startsWith('Enter passphrase') ===
      true,
    milliseconds,
  );
  return inputBoxOf(name);
}

/** Waits until window `name` is connected through `alias`: its remote name and its indicator say so. */
async function untilConnected(name: string, alias: string): Promise<void> {
  await waitFor(
    'the window to connect',
    async () =>
      (await windowState(name)).remoteName === 'ssh-remote' &&
      (await connectSurface(name)).indicator === `SSH: ${alias}`,
    120_000,
  );
}

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
});
