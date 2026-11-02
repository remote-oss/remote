import {deepStrictEqual} from 'node:assert';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  closeWindow,
  inWindow,
  onHostAs,
  terminalNames,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  panelShown,
  quickPickOf,
  terminalTabsOf,
  waitForDialog,
} from '../windows/renderer.ts';

/** The setting that shows the login terminal. */
const SHOW_TERMINAL = 'remote.SSH.showLoginTerminal';

/** The setting of the seconds a connect may take. */
const CONNECT_TIMEOUT = 'remote.SSH.connectTimeout';

/** The setting that chooses the local server mode. */
const LOCAL_SERVER = 'remote.SSH.useLocalServer';

/** The folder of the password account that a window opens, one per row, so that each window has a name of its own. */
async function passwordFolder(label: string): Promise<string> {
  await onHostAs('harness-pw', 'mkdir', '-p', `/home/harness-pw/${label}`);
  return label;
}

/** Opens a window on folder `label` of the password account behind the alias `host`, from the local window; the window is named `label`. */
async function openAccountWindow(host: string, label: string): Promise<string> {
  await passwordFolder(label);
  void inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+${host}/home/harness-pw/${label}`,
  );
  return label;
}

/** Opens a window on the password host's folder `label`. */
function openPasswordWindow(label: string): Promise<string> {
  return openAccountWindow('password', label);
}

describe('the login terminal of the terminal mode (card coverage-82)', function () {
  this.timeout(300_000);

  after(async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    await setUserSetting(LOCAL_SERVER, false);
    await setUserSetting(CONNECT_TIMEOUT, undefined);
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
  async function localConnectShows(shown: boolean): Promise<void> {
    const label = `c82-local-${String(shown)}`;
    await setUserSetting(LOCAL_SERVER, true);
    await setUserSetting(SHOW_TERMINAL, shown);
    const name = await openPasswordWindow(label);
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
        quick: 'Enter password for harness-pw@127.0.0.1',
      },
    );
    await closeWindow(name);
    await setUserSetting(LOCAL_SERVER, false);
  }

  it('F-2308 AC-13 (c82-local-true): in the local server mode with the setting true no login terminal is revealed or listed, the panel stays hidden, and the password comes as a quick input', () =>
    localConnectShows(true));

  it('F-2308 AC-13 (c82-local-false): in the local server mode with the setting false no login terminal is revealed or listed, the panel stays hidden, and the password comes as a quick input', () =>
    localConnectShows(false));

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
