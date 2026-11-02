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
  panelShown,
  answerInputBox,
  quickPickOf,
  terminalTabsOf,
} from '../windows/renderer.ts';

/** The setting that shows the login terminal. */
const SHOW_TERMINAL = 'remote.SSH.showLoginTerminal';

/** The setting that chooses the local server mode. */
const LOCAL_SERVER = 'remote.SSH.useLocalServer';

/** The folder of the password account that a window opens, one per row, so that each window has a name of its own. */
async function passwordFolder(label: string): Promise<string> {
  await onHostAs('harness-pw', 'mkdir', '-p', `/home/harness-pw/${label}`);
  return label;
}

/** Opens a window on the password host's folder `label`, from the local window; the window is named `label`. */
async function openPasswordWindow(label: string): Promise<string> {
  await passwordFolder(label);
  void inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+password/home/harness-pw/${label}`,
  );
  return label;
}

/** Waits until the login terminal of window `name` exists and shows `prompt`; gives the terminal's facts. */
async function untilPrompt(name: string, prompt: string) {
  let facts = await terminalFacts(name).catch(() => undefined);
  await waitFor(
    `the login terminal of ${name} to show ${prompt}`,
    async () => {
      facts = await terminalFacts(name).catch(() => undefined);
      return facts?.text?.includes(prompt) === true;
    },
    90_000,
  );
  return facts;
}

describe('the login terminal of the terminal mode (card coverage-82)', function () {
  this.timeout(300_000);

  after(async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    await setUserSetting(LOCAL_SERVER, false);
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

  it('F-2308 AC-20 (c82-reload): reloading a connected window with the setting on reveals exactly one new install terminal, focused', async () => {
    await setUserSetting(SHOW_TERMINAL, true);
    const name = await openPasswordWindow('c82-reload');
    await waitFor(
      'the password quick input',
      async () => (await quickPickOf(name)) !== undefined,
      90_000,
    );
    await answerInputBox(name, hostPassword());
    await waitFor(
      'the window to connect',
      async () => (await windowState(name)).remoteName === 'ssh-remote',
      120_000,
    );
    await reloadWindow(name);
    const facts = await untilPrompt(name, "harness-pw@127.0.0.1's password:");
    deepStrictEqual(
      {terminals: facts?.terminals, active: facts?.active},
      {terminals: ['install'], active: 'install'},
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
});
