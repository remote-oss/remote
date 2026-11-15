import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import {
  connectionLog,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerInputBox,
  chooseQuickPickItem,
  dialogOf,
  notifications,
  pageOf,
  pressEscape,
  quickPickOf,
  quickPickRows,
  quickPickTitle,
} from '../windows/renderer.ts';

/** The placeholder of the pick that asks for the host key (F-2305's question). */
const PLACEHOLDER = 'Are you sure you want to continue?';

/** The message of the handler's error when an uninstall could not run. */
const UNINSTALL_FAILED = 'Failed to run command';

/** The known-hosts file of the alias `stranger`, which the rows empty so that its host key is unknown. */
function knownHosts(): string {
  return `${variable('HARNESS_RUN_FOLDER')}/known_hosts_stranger`;
}

/**
 * Runs Uninstall VS Code Server from Host... in the local window and picks `stranger` from its host pick; gives what
 * the command ended with once it has: `done`, or the text of its error.
 */
async function startedOnStranger(): Promise<{ending: Promise<string>}> {
  writeFileSync(knownHosts(), '');
  // The command holds the window's agent until the row answers it, and the page of a window that has none of its own
  // is found by asking the agent for its state: so the page is found first, and the reads that follow reuse it.
  await pageOf('local');
  const ending = inWindow('local', 'opensshremotes.cleanDevBox').then(
    () => 'done',
    (caught: unknown) => String(caught),
  );
  await waitFor(
    'the host pick',
    async () => (await quickPickOf('local')) !== undefined,
    60_000,
  ).catch(failedWithFacts);
  await answerInputBox('local', 'stranger');
  await waitFor(
    'the question about the host key',
    async () => (await quickPickOf('local'))?.placeholder === PLACEHOLDER,
    60_000,
  ).catch(failedWithFacts);
  return {ending};
}

/** Throws `caught` with what the local window shows and the end of the connection log, so a wait that ran out says why. */
async function failedWithFacts(caught: unknown): Promise<never> {
  const shown = await quickPickOf('local').catch((failed: unknown) =>
    String(failed),
  );
  const dialog = await dialogOf('local').catch((failed: unknown) =>
    String(failed),
  );
  const toasts = await notifications('local').catch((failed: unknown) =>
    String(failed),
  );
  throw new Error(
    `${String(caught)}; the quick pick: ${JSON.stringify(shown)}; the dialog: ${JSON.stringify(dialog)}; the notifications: ${JSON.stringify(toasts)}; the end of the connection log:\n${connectionLog().slice(-20).join('\n')}`,
    {cause: caught},
  );
}

describe('the host-key question of a maintenance command, in the wording of OpenSSH 10.2 (cards coverage-100, #2653)', function () {
  this.timeout(300_000);

  let settingsBefore: string | undefined;

  before(async () => {
    settingsBefore = readUserSettings();
    await userSettings({'remote.SSH.remotePlatform': {stranger: 'linux'}});
  });

  after(() => {
    restoreUserSettings(settingsBefore);
  });

  it('F-2412 AC-10 (c2653-host-key-pick): with ssh asking in the wording of OpenSSH 10.2, the host key of an unknown host is asked as the pick with the fingerprint in its title, Continue focused and Cancel; Continue goes on and records the key, and Cancel and Escape, each in an attempt of its own, end the command with the error of AC-12 and record nothing', async () => {
    const {ending: proceeding} = await startedOnStranger();
    const asked = await quickPickOf('local');
    const title = await quickPickTitle('local');
    const focused = (await quickPickRows('local'))
      .filter(entry => entry.focused)
      .map(entry => entry.label);
    await chooseQuickPickItem('local', 'Continue');
    const continued = await proceeding;
    const recorded = readFileSync(knownHosts(), 'utf8').trim() !== '';

    const {ending: cancelling} = await startedOnStranger();
    await chooseQuickPickItem('local', 'Cancel');
    const cancelled = await cancelling;
    const keptAfterCancel = readFileSync(knownHosts(), 'utf8').trim() === '';

    const {ending: refusing} = await startedOnStranger();
    await pressEscape('local');
    const escaped = await refusing;
    deepStrictEqual(
      {
        placeholder: asked?.placeholder,
        items: asked?.items,
        focused,
        title: /^"stranger" has fingerprint "SHA256:[^"]+"\.$/.test(title),
        continued,
        recorded,
        cancelled: cancelled.includes(UNINSTALL_FAILED),
        keptAfterCancel,
        escaped: escaped.includes(UNINSTALL_FAILED),
        keptAfterEscape: readFileSync(knownHosts(), 'utf8').trim() === '',
      },
      {
        placeholder: PLACEHOLDER,
        items: ['Continue', 'Cancel'],
        focused: ['Continue'],
        title: true,
        continued: 'done',
        recorded: true,
        cancelled: true,
        keptAfterCancel: true,
        escaped: true,
        keptAfterEscape: true,
      },
    );
  });
});
