/**
 * @fileoverview The "details" link of the connect's progress notification in terminal mode, while ssh waits for the
 * answer to an unknown host key (F-2304 AC-12, AC-33): with the login terminal hidden the wait is F-2305's fingerprint
 * pick and the panel stays hidden until the link is clicked; with it shown the link reveals the terminal with ssh's
 * question, and the answer typed there lets the connect go on.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  ASK_WITHOUT,
  askLines,
  freshKnown,
  hostBlock,
  writeConfig,
} from '../windows/config-keywords-support.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  chooseQuickPickRow,
  clickToastLink,
  notifications,
  panelShown,
  pressEscape,
  quickPickOf,
  quickPickRows,
  terminalFocused,
  terminalText,
  typeInTerminal,
  waitForQuickPick,
} from '../windows/renderer.ts';

/** The start of the message of the progress notification that carries the "details" link. */
const PROGRESS = 'Setting up SSH Host';

/** What ssh asks about an unknown host key. */
const QUESTION = 'Are you sure you want to continue connecting';

/**
 * Points the window's settings at a host `alias` whose key is unknown, in terminal mode with the login terminal shown
 * or not, and opens window `alias` on it.
 */
async function openAsking(alias: string, shown: boolean): Promise<void> {
  const file = writeConfig(alias, [
    hostBlock(alias, askLines(freshKnown(alias)), ASK_WITHOUT),
  ]);
  await userSettings({
    'remote.SSH.configFile': file,
    'remote.SSH.useLocalServer': false,
    'remote.SSH.showLoginTerminal': shown,
    'remote.SSH.remotePlatform': {[alias]: 'linux'},
  });
  await openWindow(alias, alias);
}

describe('"details" while ssh waits for a host-key answer (card #2654)', function () {
  this.timeout(300_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2304 AC-33 (c2654-hidden): with the login terminal hidden, the panel stays hidden while the fingerprint pick waits, and "details" shows it', async () => {
    const name = 'c2654-hidden';
    await openAsking(name, false);
    await waitForQuickPick(name, 90_000);
    const waiting = {
      panel: await panelShown(name),
      pick: (await quickPickOf(name))?.items,
    };
    await clickToastLink(name, PROGRESS, 'details');
    await waitFor('the panel after "details"', () => panelShown(name), 30_000);
    await pressEscape(name);
    await closeWindow(name).catch(() => undefined);
    deepStrictEqual(waiting, {panel: false, pick: ['Continue', 'Cancel']});
  });

  it('F-2304 AC-12 (c2654-terminal): with the login terminal shown, "details" reveals it focused with ssh’s question, and the answer typed there lets the connect go on to installing the server', async () => {
    const name = 'c2654-terminal';
    await openAsking(name, true);
    await waitFor(
      'ssh’s question in the login terminal',
      async () => (await terminalText(name).catch(() => '')).includes(QUESTION),
      90_000,
    );
    await clickToastLink(name, PROGRESS, 'details');
    const revealed = {
      panel: await panelShown(name),
      focused: await terminalFocused(name),
      asked: (await terminalText(name)).includes(QUESTION),
      pick: await quickPickOf(name),
    };
    await typeInTerminal(name, 'yes\n');
    await waitFor(
      'the phase "Installing VS Code Server"',
      async () =>
        (await notifications(name)).some(text =>
          text.includes('Installing VS Code Server'),
        ),
      120_000,
    );
    await connectedWithin(name, 120_000);
    await closeWindow(name);
    deepStrictEqual(revealed, {
      panel: true,
      focused: true,
      asked: true,
      pick: undefined,
    });
  });

  it('F-2304 AC-12 (c2654-pick): with the login terminal hidden, the fingerprint pick holds focus and its Continue lets the connect go on without "details"', async () => {
    const name = 'c2654-pick';
    await openAsking(name, false);
    await waitForQuickPick(name, 90_000);
    const focused = (await quickPickRows(name)).find(
      entry => entry.focused,
    )?.label;
    await chooseQuickPickRow(name, 'Continue');
    await connectedWithin(name, 120_000);
    await closeWindow(name);
    deepStrictEqual(focused, 'Continue');
  });
});
