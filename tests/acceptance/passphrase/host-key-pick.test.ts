import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import {
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
  pressEscape,
  quickPickOf,
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
  const ending = inWindow('local', 'opensshremotes.cleanDevBox').then(
    () => 'done',
    (caught: unknown) => String(caught),
  );
  await waitFor(
    'the host pick',
    async () => (await quickPickOf('local')) !== undefined,
    60_000,
  );
  await answerInputBox('local', 'stranger');
  await waitFor(
    'the question about the host key',
    async () => (await quickPickOf('local'))?.placeholder === PLACEHOLDER,
    60_000,
  );
  return {ending};
}

describe('the host-key question of a maintenance command (card coverage-100)', function () {
  this.timeout(300_000);

  let settingsBefore: string | undefined;

  before(async () => {
    settingsBefore = readUserSettings();
    await userSettings({'remote.SSH.remotePlatform': {stranger: 'linux'}});
  });

  after(() => {
    restoreUserSettings(settingsBefore);
  });

  it('F-2412 AC-10 (ruling-1601-host-key-pick): the host key of an unknown host is asked as the pick with the fingerprint in its title and Continue and Cancel; Continue goes on and records the key, and Escape ends the command with the error of AC-12 and records nothing', async () => {
    const {ending: proceeding} = await startedOnStranger();
    const asked = await quickPickOf('local');
    const title = await quickPickTitle('local');
    await chooseQuickPickItem('local', 'Continue');
    const continued = await proceeding;
    const recorded = readFileSync(knownHosts(), 'utf8').trim() !== '';

    const {ending: refusing} = await startedOnStranger();
    await pressEscape('local');
    const escaped = await refusing;
    deepStrictEqual(
      {
        placeholder: asked?.placeholder,
        items: asked?.items,
        title: /^"stranger" has fingerprint "SHA256:[^"]+"\.$/.test(title),
        continued,
        recorded,
        escaped: escaped.includes(UNINSTALL_FAILED),
        keptEmpty: readFileSync(knownHosts(), 'utf8').trim() === '',
      },
      {
        placeholder: PLACEHOLDER,
        items: ['Continue', 'Cancel'],
        title: true,
        continued: 'done',
        recorded: true,
        escaped: true,
        keptEmpty: true,
      },
    );
  });
});
