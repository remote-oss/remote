import {deepStrictEqual} from 'node:assert';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  closeWindow,
  hostPassword,
  inWindow,
  onHostAs,
  reloadWindow,
  terminalFacts,
  terminalNames,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerInputBox,
  chooseQuickPickItem,
  paletteRun,
  pressEscape,
  clickToastLink,
  connectSurface,
  dialogOf,
  notifications,
  panelShown,
  quickPickOf,
  terminalFocused,
  terminalSpans,
  terminalTabsOf,
  typeInTerminal,
  waitForDialog,
} from '../windows/renderer.ts';

/** The setting that shows the login terminal. */
const SHOW_TERMINAL = 'remote.SSH.showLoginTerminal';

/** The setting that turns dynamic forwarding on; off makes the connect set up an SSH tunnel of its own. */
const DYNAMIC_FORWARDING = 'remote.SSH.enableDynamicForwarding';

/** The setting of the seconds a connect may take. */
const CONNECT_TIMEOUT = 'remote.SSH.connectTimeout';

/** The setting that chooses the local server mode. */
const LOCAL_SERVER = 'remote.SSH.useLocalServer';

/** The folder of the password account that a window opens, one per row, so that each window has a name of its own. */
async function passwordFolder(account: string, label: string): Promise<string> {
  await onHostAs(account, 'mkdir', '-p', `/home/${account}/${label}`);
  return label;
}

/** Opens a window on folder `label` of the home of `account`, the user behind the alias `host`, from the local window; the window is named `label`. */
async function openAccountWindow(
  host: string,
  label: string,
  account = 'harness-pw',
): Promise<string> {
  await passwordFolder(account, label);
  void inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+${host}/home/${account}/${label}`,
  );
  return label;
}

/** Opens a window on the password host's folder `label`. */
function openPasswordWindow(label: string): Promise<string> {
  return openAccountWindow('password', label);
}

/** The password prompt of the install terminal of the password account. */
const PASSWORD_PROMPT = "harness-pw@127.0.0.1's password:";

/** The password prompt of the install terminal of the password-only account. */
const PASSWORD_ONLY_PROMPT = "harness-pwonly@127.0.0.1's password:";

/** A tab label as the panel lists it: core adds the terminal's description after the name. */
function tabName(label: string): string {
  return label.startsWith('install') ? 'install' : label;
}

/** Waits until window `name`'s Terminal panel lists the install tab, then 2 s more, reading no terminal facts, which would focus it. */
async function untilInstallTab(name: string): Promise<void> {
  await waitFor(
    'the install tab',
    async () =>
      (await terminalTabsOf(name)).some(label => label.startsWith('install')),
    90_000,
  );
  await new Promise(resolve => setTimeout(resolve, 2000));
}

/** The labels of window `name`'s terminal tabs, as {@link tabName} names them; the uninstall terminal keeps its name. */
async function tabNames(name: string): Promise<string[]> {
  return (await terminalTabsOf(name)).map(label =>
    label.startsWith('Uninstall VS Code Server')
      ? 'Uninstall VS Code Server'
      : tabName(label),
  );
}

/** Waits until the login terminal of window `name` shows `prompt`; gives the terminal's facts. */
async function untilPrompt(name: string, prompt: string) {
  let facts = await terminalFacts(name).catch(() => undefined);
  try {
    await waitFor(
      `the login terminal of ${name} to show ${prompt}`,
      async () => {
        facts = await terminalFacts(name).catch(() => undefined);
        return facts?.text?.includes(prompt) === true;
      },
      90_000,
    );
  } catch (error) {
    throw new Error(
      `${(error as Error).message}; it held ${JSON.stringify({terminals: facts?.terminals, active: facts?.active, end: facts?.text?.slice(-200)})}`,
      {cause: error},
    );
  }
  return facts;
}

describe('the login terminal of the terminal mode (card coverage-82)', function () {
  this.timeout(300_000);

  after(async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    await setUserSetting(LOCAL_SERVER, false);
    await setUserSetting(CONNECT_TIMEOUT, undefined);
    await setUserSetting(DYNAMIC_FORWARDING, undefined);
  });

  it('F-2308 AC-2 (c82-reveal): with the setting on the install terminal is revealed and focused with ssh’s password prompt, and no quick input appears', async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openPasswordWindow('c82-reveal');
    await untilInstallTab(name);
    const shown = {
      panel: await panelShown(name),
      focused: await terminalFocused(name),
    };
    const facts = await untilPrompt(name, PASSWORD_PROMPT);
    // The extension asks its questions a moment after the prompt is printed.
    await new Promise(resolve => setTimeout(resolve, 2000));
    deepStrictEqual(
      {
        ...shown,
        quick: await quickPickOf(name),
        terminals: facts?.terminals,
        active: facts?.active,
      },
      {
        panel: true,
        focused: true,
        quick: undefined,
        terminals: ['install'],
        active: 'install',
      },
    );
    await closeWindow(name);
  });

  it('F-2308 AC-3 (c82-password): the correct password typed in the terminal connects the window, and the terminal stays open and focused', async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openPasswordWindow('c82-password');
    await untilPrompt(name, PASSWORD_PROMPT);
    await typeInTerminal(name, `${hostPassword()}\n`);
    await waitFor(
      'the window to connect',
      async () => (await windowState(name)).remoteName === 'ssh-remote',
      120_000,
    );
    const shown = {
      panel: await panelShown(name),
      focused: await terminalFocused(name),
      quick: await quickPickOf(name),
    };
    const facts = await terminalFacts(name);
    deepStrictEqual(
      {...shown, terminals: facts.terminals, active: facts.active},
      {
        panel: true,
        focused: true,
        quick: undefined,
        terminals: ['install'],
        active: 'install',
      },
    );
    await closeWindow(name);
  });

  it('F-2308 AC-6, AC-27 (c82-details): details in the progress notification reveals and focuses the install terminal, which is then listed, while the quick input stays open', async () => {
    await setUserSetting(SHOW_TERMINAL, false);
    const name = await openPasswordWindow('c82-details');
    await waitFor(
      'the password quick input',
      async () => (await quickPickOf(name)) !== undefined,
      90_000,
    );
    const before = {
      panel: await panelShown(name),
      tabs: await terminalTabsOf(name),
    };
    await clickToastLink(name, 'Setting up SSH Host', 'details');
    await waitFor('the panel', () => panelShown(name), 30_000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    deepStrictEqual(
      {
        before,
        panel: await panelShown(name),
        tabs: (await terminalTabsOf(name)).map(tabName),
        focused: await terminalFocused(name),
        quick: (await quickPickOf(name))?.placeholder,
      },
      {
        before: {panel: false, tabs: []},
        panel: true,
        tabs: ['install'],
        focused: true,
        quick: 'Enter password for harness-pw@127.0.0.1',
      },
    );
    await closeWindow(name);
  });

  it('F-2308 AC-16 (c82-wrong): a wrong password typed in the terminal brings ssh’s Permission denied line and the prompt again, and no editor UI', async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openAccountWindow(
      'password-retry',
      'c82-wrong',
      'harness-pwonly',
    );
    await untilPrompt(name, PASSWORD_ONLY_PROMPT);
    await typeInTerminal(name, 'not-the-password\n');
    const facts = await untilPrompt(
      name,
      'Permission denied, please try again.',
    );
    deepStrictEqual(
      {
        prompts: (
          facts?.text?.match(/harness-pwonly@127\.0\.0\.1's password:/g) ?? []
        ).length,
        quick: await quickPickOf(name),
        dialog: await dialogOf(name),
        toasts: (await notifications(name)).filter(
          text => !text.startsWith('Setting up SSH Host'),
        ),
      },
      {prompts: 2, quick: undefined, dialog: undefined, toasts: []},
    );
    await closeWindow(name);
  });

  it('F-2308 AC-25 (c82-denied): wrong passwords as often as ssh allows end in the Permission denied dialog, the indicator is disconnected, the install terminal is gone, and Retry makes a new revealed one with the prompt', async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openAccountWindow(
      'password-retry',
      'c82-denied',
      'harness-pwonly',
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await untilPrompt(
        name,
        attempt === 0
          ? PASSWORD_ONLY_PROMPT
          : 'Permission denied, please try again.',
      );
      await typeInTerminal(name, `wrong-${String(attempt)}\n`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    const dialog = await waitForDialog(name, 120_000);
    const failed = {
      dialog: [dialog.details, [...dialog.buttons].sort()],
      indicator: (await connectSurface(name)).indicator.startsWith(
        'Disconnected from SSH',
      ),
      terminals: await terminalNames(name),
      tabs: await terminalTabsOf(name),
    };
    await answerDialog(name, 'Retry');
    await untilInstallTab(name);
    const again = {
      panel: await panelShown(name),
      focused: await terminalFocused(name),
      tabs: (await terminalTabsOf(name)).map(tabName),
    };
    const facts = await untilPrompt(name, PASSWORD_ONLY_PROMPT);
    deepStrictEqual(
      {failed, again, retried: facts?.terminals},
      {
        failed: {
          dialog: [
            'Could not establish connection to "password-retry": Permission denied (password).',
            ['Close Remote', 'More Actions...', 'Retry'],
          ],
          indicator: true,
          terminals: [],
          tabs: [],
        },
        again: {panel: true, focused: true, tabs: ['install']},
        retried: ['install'],
      },
    );
    await closeWindow(name);
  });

  it('F-2308 AC-20 (c82-reload): reloading a connected window with the setting on reveals exactly one new install terminal, focused', async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openPasswordWindow('c82-reload');
    await untilPrompt(name, PASSWORD_PROMPT);
    await typeInTerminal(name, `${hostPassword()}\n`);
    await waitFor(
      'the window to connect',
      async () => (await windowState(name)).remoteName === 'ssh-remote',
      120_000,
    );
    await reloadWindow(name);
    await untilInstallTab(name);
    const shown = {
      panel: await panelShown(name),
      tabs: (await terminalTabsOf(name)).map(tabName),
      focused: await terminalFocused(name),
    };
    await untilPrompt(name, PASSWORD_PROMPT);
    deepStrictEqual(
      {...shown, active: (await terminalFacts(name)).active},
      {panel: true, tabs: ['install'], focused: true, active: 'install'},
    );
    await closeWindow(name);
  });

  it('F-2308 AC-10 (c82-reveal-answer): revealing the terminal with details and answering the unrecognized question there continues the connect, and the next recognized prompt is a quick input', async () => {
    const name = await proxyAskTerminalOpened('c82-reveal-answer');
    await clickToastLink(name, 'Setting up SSH Host', 'details');
    await untilPrompt(name, 'Proceed?');
    await typeInTerminal(name, 'y\n');
    await waitFor(
      'the password quick input',
      async () => (await quickPickOf(name)) !== undefined,
      90_000,
    );
    const asked = (await quickPickOf(name))?.placeholder;
    await answerInputBox(name, hostPassword());
    await waitFor(
      'the window to connect',
      async () => (await windowState(name)).remoteName === 'ssh-remote',
      120_000,
    );
    deepStrictEqual(asked, 'Enter password for harness-pw@127.0.0.1');
    await closeWindow(name);
  });

  it('F-2308 AC-23 (c82-answer-there): answering the open password question in the revealed terminal instead ends the window connected, with no input left open', async () => {
    await setUserSetting(SHOW_TERMINAL, false);
    const name = await openPasswordWindow('c82-answer-there');
    await waitFor(
      'the password quick input',
      async () => (await quickPickOf(name)) !== undefined,
      90_000,
    );
    await clickToastLink(name, 'Setting up SSH Host', 'details');
    // The hidden terminal was laid out narrow, so its buffer holds the prompt wrapped; ssh's own line before it is whole.
    await untilPrompt(name, 'Next authentication method: password');
    await typeInTerminal(name, `${hostPassword()}\n`);
    await waitFor(
      'the window to connect',
      async () => (await windowState(name)).remoteName === 'ssh-remote',
      120_000,
    );
    await new Promise(resolve => setTimeout(resolve, 2000));
    deepStrictEqual(
      {quick: await quickPickOf(name), dialog: await dialogOf(name)},
      {quick: undefined, dialog: undefined},
    );
    await closeWindow(name);
  });

  it('F-2308 AC-15 (c82-kill): killing the install terminal of a connected window drops the connection at once and a reconnection makes a new install terminal with the password prompt', async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openPasswordWindow('c82-kill');
    await untilPrompt(name, PASSWORD_PROMPT);
    await typeInTerminal(name, `${hostPassword()}\n`);
    await waitFor(
      'the window to connect',
      async () => (await windowState(name)).remoteName === 'ssh-remote',
      120_000,
    );
    await paletteRun(name, 'Terminal: Kill the Active Terminal');
    const facts = await untilPrompt(name, PASSWORD_PROMPT);
    deepStrictEqual(facts?.terminals, ['install']);
    await closeWindow(name);
  });

  it('F-2308 AC-18 (c82-switch): switching the setting on during a hidden attempt changes nothing, and the next attempt reveals its terminal', async () => {
    await setUserSetting(SHOW_TERMINAL, false);
    const name = await openPasswordWindow('c82-switch');
    await waitFor(
      'the password quick input',
      async () => (await quickPickOf(name)) !== undefined,
      90_000,
    );
    await setUserSetting(SHOW_TERMINAL, true);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const pending = {
      panel: await panelShown(name),
      tabs: await terminalTabsOf(name),
      quick: (await quickPickOf(name))?.placeholder,
    };
    await pressEscape(name);
    const dialog = await waitForDialog(name, 60_000);
    await answerDialog(name, 'Retry');
    await untilInstallTab(name);
    deepStrictEqual(
      {
        pending,
        dialog: dialog.details.startsWith(
          'Could not establish connection to "password"',
        ),
        panel: await panelShown(name),
        tabs: (await terminalTabsOf(name)).map(tabName),
      },
      {
        pending: {
          panel: false,
          tabs: [],
          quick: 'Enter password for harness-pw@127.0.0.1',
        },
        dialog: true,
        panel: true,
        tabs: ['install'],
      },
    );
    await closeWindow(name);
  });

  /** A window on the password host, connected by the password typed in its terminal; the setting is on. */
  async function connectedByTerminal(label: string): Promise<string> {
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openPasswordWindow(label);
    await untilPrompt(name, PASSWORD_PROMPT);
    await typeInTerminal(name, `${hostPassword()}\n`);
    await waitFor(
      'the window to connect',
      async () => (await windowState(name)).remoteName === 'ssh-remote',
      120_000,
    );
    return name;
  }

  /** Runs Uninstall VS Code Server on Host... in window `name` and picks the host `alias` once the pick is open. */
  async function uninstallHost(name: string, alias: string): Promise<void> {
    void inWindow(name, 'opensshremotes.cleanDevBox');
    await waitFor(
      'the host pick',
      async () => (await quickPickOf(name)) !== undefined,
      60_000,
    );
    await chooseQuickPickItem(name, alias);
  }

  it('F-2308 AC-19 (c82-uninstall-hidden): with the setting off the Uninstall VS Code Server terminal stays hidden and the password comes as a quick input', async () => {
    const name = await connectedByTerminal('c82-uninstall-hidden');
    await setUserSetting(SHOW_TERMINAL, false);
    await uninstallHost(name, 'password');
    await waitFor(
      'the password quick input',
      async () =>
        (await quickPickOf(name))?.placeholder.startsWith('Enter password') ===
        true,
      60_000,
    );
    const hidden = {
      tabs: await tabNames(name),
      quick: (await quickPickOf(name))?.placeholder,
    };
    await answerInputBox(name, hostPassword());
    deepStrictEqual(hidden, {
      tabs: ['install'],
      quick: 'Enter password for harness-pw@127.0.0.1',
    });
    await closeWindow(name);
  });

  /** The text on the screen of the terminal window `name` shows, read in the page. */
  async function screenOf(name: string): Promise<string> {
    return (await terminalSpans(name))
      .map(span => span.text)
      .join('')
      .replaceAll('\u00a0', ' ');
  }

  it('F-2308 AC-8 (c82-tunnel-hidden): with dynamic forwarding off and the setting off the tunnel phase reads Setting up SSH tunnel, the SSH Tunnel terminal stays hidden, its password comes as a second quick input, and details reveals it', async () => {
    await setUserSetting(DYNAMIC_FORWARDING, false);
    await setUserSetting(SHOW_TERMINAL, false);
    const name = await openPasswordWindow('c82-tunnel-hidden');
    await waitFor(
      'the password quick input',
      async () => (await quickPickOf(name)) !== undefined,
      90_000,
    );
    await answerInputBox(name, hostPassword());
    await waitFor(
      'the tunnel phase',
      async () =>
        (await notifications(name)).some(text =>
          text.includes('Setting up SSH tunnel'),
        ),
      90_000,
    );
    const phase = (await notifications(name)).find(text =>
      text.includes('Setting up SSH tunnel'),
    );
    await waitFor(
      'the second password quick input',
      async () =>
        (await quickPickOf(name))?.placeholder.startsWith('Enter password') ===
        true,
      90_000,
    );
    const hidden = {
      panel: await panelShown(name),
      tabs: (await terminalTabsOf(name)).map(tabName),
    };
    await clickToastLink(name, 'Setting up SSH Host', 'details');
    await waitFor('the panel', () => panelShown(name), 30_000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    deepStrictEqual(
      {
        phase,
        hidden,
        revealed: (await terminalTabsOf(name)).map(label =>
          label.replace(/Local - .*$/, ''),
        ),
        quick: (await quickPickOf(name))?.placeholder,
      },
      {
        phase: 'Setting up SSH Host password: (details) Setting up SSH tunnel',
        hidden: {panel: false, tabs: []},
        revealed: ['SSH Tunnel'],
        quick: 'Enter password for harness-pw@127.0.0.1',
      },
    );
    await closeWindow(name);
  });

  it('F-2308 AC-8, AC-21 (c82-tunnel-shown): with the setting on the SSH Tunnel terminal is revealed and focused with its own prompt, and once the tunnel is up it reads Connected to SSH Host - Please do not close this terminal', async () => {
    await setUserSetting(DYNAMIC_FORWARDING, false);
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openPasswordWindow('c82-tunnel-shown');
    await untilPrompt(name, PASSWORD_PROMPT);
    await typeInTerminal(name, `${hostPassword()}\n`);
    await waitFor(
      'the SSH Tunnel tab',
      async () =>
        (await terminalTabsOf(name)).some(label =>
          label.startsWith('SSH Tunnel'),
        ),
      90_000,
    );
    await new Promise(resolve => setTimeout(resolve, 2000));
    const shown = {
      panel: await panelShown(name),
      focused: await terminalFocused(name),
      quick: await quickPickOf(name),
      prompt: (await screenOf(name)).includes(PASSWORD_PROMPT),
    };
    await typeInTerminal(name, `${hostPassword()}\n`);
    await waitFor(
      'the window to connect',
      async () => (await windowState(name)).remoteName === 'ssh-remote',
      120_000,
    );
    deepStrictEqual(
      {
        shown,
        connected: (await screenOf(name)).includes(
          'Connected to SSH Host - Please do not close this terminal',
        ),
      },
      {
        shown: {panel: true, focused: true, quick: undefined, prompt: true},
        connected: true,
      },
    );
    await closeWindow(name);
  });

  it('F-2308 AC-5 (c82-hidden): with the setting off the panel stays hidden, the install terminal has no tab in it, and the password comes as the quick input', async () => {
    await setUserSetting(SHOW_TERMINAL, false);
    const name = await openPasswordWindow('c82-hidden');
    await waitFor(
      'the password quick input',
      async () => (await quickPickOf(name)) !== undefined,
      90_000,
    );
    deepStrictEqual(
      {
        panel: await panelShown(name),
        tabs: await terminalTabsOf(name),
        quick: (await quickPickOf(name))?.placeholder,
      },
      {
        panel: false,
        tabs: [],
        quick: 'Enter password for harness-pw@127.0.0.1',
      },
    );
    await closeWindow(name);
  });

  /** The local server mode's connect with the setting `shown`: nothing of the login terminal shows, and the password is a quick input. */
  async function localConnectShows(
    shown: boolean,
    host: string,
    account: string,
  ): Promise<void> {
    const label = `c82-local-${String(shown)}`;
    await setUserSetting(LOCAL_SERVER, true);
    await setUserSetting(SHOW_TERMINAL, shown);
    const name = await openAccountWindow(host, label, account);
    await waitFor(
      'the password quick input',
      async () => (await quickPickOf(name)) !== undefined,
      90_000,
    );
    deepStrictEqual(
      {
        panel: await panelShown(name),
        tabs: await terminalTabsOf(name),
        terminals: await terminalNames(name),
        quick: (await quickPickOf(name))?.placeholder,
      },
      {
        panel: false,
        tabs: [],
        terminals: [],
        quick: `Enter password for ${account}@127.0.0.1`,
      },
    );
    await closeWindow(name);
    await setUserSetting(LOCAL_SERVER, false);
  }

  it('F-2308 AC-13 (c82-local-true): in the local server mode with the setting true no login terminal is revealed or listed, the panel stays hidden, and the password comes as a quick input', () =>
    // Each row has a host of its own, so that the second connect does not join the local server the first left waiting.
    localConnectShows(true, 'password', 'harness-pw'));

  it('F-2308 AC-13 (c82-local-false): in the local server mode with the setting false no login terminal is revealed or listed, the panel stays hidden, and the password comes as a quick input', () =>
    localConnectShows(false, 'password-retry', 'harness-pwonly'));

  /** A local-server window on the ProxyCommand that asks on the terminal, with the setting `shown`: the failure dialog and how long it took. */
  async function proxyAskFails(shown: boolean, label: string) {
    await setUserSetting(LOCAL_SERVER, true);
    await setUserSetting(SHOW_TERMINAL, shown);
    const name = await openAccountWindow('proxy-ask', label);
    await waitFor(
      'the window',
      async () =>
        (await windowState(name).catch(() => undefined)) !== undefined,
      60_000,
    );
    const opened = Date.now();
    const dialog = await waitForDialog(name, 30_000);
    const seconds = (Date.now() - opened) / 1000;
    await closeWindow(name);
    await setUserSetting(LOCAL_SERVER, false);
    return {
      shown: {details: dialog.details, buttons: [...dialog.buttons].sort()},
      seconds,
    };
  }

  /** The AC-14 row's assertion for the setting `shown`. */
  async function proxyAskAsserted(shown: boolean, label: string) {
    const {shown: dialog, seconds} = await proxyAskFails(shown, label);
    deepStrictEqual(
      {...dialog, withinTwoSeconds: seconds <= 2, seconds},
      {
        details: 'Could not establish connection to "proxy-ask".',
        buttons: ['Close Remote', 'More Actions...', 'Retry'],
        withinTwoSeconds: true,
        seconds,
      },
    );
  }

  it('F-2308 AC-14 (c82-proxy-true): in the local server mode a ProxyCommand that asks on the terminal fails the connect at once with the dialog, with the setting true', () =>
    proxyAskAsserted(true, 'c82-proxy-true'));

  it('F-2308 AC-14 (c82-proxy-false): in the local server mode a ProxyCommand that asks on the terminal fails the connect at once with the dialog, with the setting false', () =>
    proxyAskAsserted(false, 'c82-proxy-false'));

  /** A terminal-mode window on the ProxyCommand that asks before the handshake, with the setting off, once its progress shows. */
  async function proxyAskTerminalOpened(label: string): Promise<string> {
    await setUserSetting(LOCAL_SERVER, false);
    await setUserSetting(SHOW_TERMINAL, false);
    const name = await openAccountWindow('proxy-ask-terminal', label);
    await waitFor(
      'the progress notification',
      async () =>
        (await notifications(name).catch(() => [])).some(text =>
          text.startsWith('Setting up SSH Host'),
        ),
      60_000,
    );
    return name;
  }

  it('F-2308 AC-9 (c82-unknown): with the setting off a question the extension does not recognize shows no quick input, notification or hint, and the progress stays', async () => {
    const name = await proxyAskTerminalOpened('c82-unknown');
    await new Promise(resolve => setTimeout(resolve, 6000));
    deepStrictEqual(
      {
        quick: await quickPickOf(name),
        dialog: await dialogOf(name),
        toasts: (await notifications(name)).map(text =>
          text.slice(0, 'Setting up SSH Host'.length),
        ),
        panel: await panelShown(name),
      },
      {
        quick: undefined,
        dialog: undefined,
        toasts: ['Setting up SSH Host'],
        panel: false,
      },
    );
    await closeWindow(name);
  });

  /** The seconds from the progress to the failure dialog of the unanswered question with `connectTimeout` N, and the dialog's text. */
  async function unansweredAfter(timeout: number, label: string) {
    await setUserSetting(CONNECT_TIMEOUT, timeout);
    const name = await proxyAskTerminalOpened(label);
    const asked = Date.now();
    const dialog = await waitForDialog(name, (timeout + 30) * 1000);
    const seconds = (Date.now() - asked) / 1000;
    await closeWindow(name);
    await setUserSetting(CONNECT_TIMEOUT, undefined);
    return {details: dialog.details, seconds};
  }

  it('F-2308 AC-11 (c82-wait-5): with connectTimeout 5 an unanswered question before the handshake ends in the failure dialog about 5 seconds after', async () => {
    const {details, seconds} = await unansweredAfter(5, 'c82-wait-5');
    deepStrictEqual(
      {details, about: seconds >= 4 && seconds <= 9, seconds},
      {
        details: 'Could not establish connection to "proxy-ask-terminal".',
        about: true,
        seconds,
      },
    );
  });

  it('F-2308 AC-11 (c82-wait-30): with connectTimeout 30 an unanswered question before the handshake ends in the failure dialog about 30 seconds after', async () => {
    const {details, seconds} = await unansweredAfter(30, 'c82-wait-30');
    deepStrictEqual(
      {details, about: seconds >= 29 && seconds <= 34, seconds},
      {
        details: 'Could not establish connection to "proxy-ask-terminal".',
        about: true,
        seconds,
      },
    );
  });
});
