import {deepStrictEqual} from 'node:assert';
import {writeFileSync} from 'node:fs';
import {
  connectionLog,
  openWindow,
  readUserSettings,
  recordLines,
  userSettingsFile,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {PlatformNotYet, storedPlatformOf} from '../windows/stored-platform.ts';

/** How long the connect may take to resolve after the window opens, in milliseconds. */
const CONNECT_WAIT_MILLISECONDS = 120_000;

/** How long the user settings file may take to gain the platform after the connect resolves, in milliseconds. */
const SETTINGS_WAIT_MILLISECONDS = 10_000;

/** The text of the launch's user settings file, or a word for its absence. */
function settingsText(): string {
  const text = readUserSettings();
  return text ?? '(no settings file)';
}

/** The `remote.SSH.remotePlatform` entry once stored, waited up to `milliseconds`, or the wait's timeout. */
async function storedWithin(milliseconds: number): Promise<unknown> {
  const found: unknown[] = [];
  await waitFor(
    'the platform to be stored',
    () => {
      const value = storedPlatformOf(userSettingsFile());
      if (value === undefined) {
        throw new PlatformNotYet('the platform is not stored yet');
      }
      found.push(value);
      return true;
    },
    milliseconds,
  );
  return found.at(-1);
}

describe('a terminal-mode connect that picks the platform', function () {
  this.timeout(180000);

  it('#664, F-2206 5.2: in terminal mode, a connect whose platform is picked connects and stores the platform', async () => {
    writeFileSync(
      process.env.REMOTE_OSS_ACCEPTANCE_SCRIPT ?? '',
      JSON.stringify({
        entries: [{surface: 'platformPick', match: 'harness', answer: 'linux'}],
      }),
    );
    await openWindow('harness', 'tp1');
    // The window carries the remote's name from the start; the platform is stored when the connect has resolved.
    await waitFor(
      'the connect to resolve',
      () =>
        connectionLog().some(line =>
          line.startsWith('Resolved ssh-remote+harness to local port'),
        ),
      CONNECT_WAIT_MILLISECONDS,
    );
    const remoteName = (await windowState('tp1')).remoteName;
    const answers = recordLines('platformPick').map(line => line.answer);
    const stored = await storedWithin(SETTINGS_WAIT_MILLISECONDS);
    deepStrictEqual(
      [remoteName, answers, stored],
      ['ssh-remote', ['linux'], {harness: 'linux'}],
      // When the platform is not stored, what the user settings file and the extension's log hold: the write is made
      // after the connect, and a failure of it is only a line in the log.
      `the settings file: ${settingsText()}; the log: ${JSON.stringify(connectionLog().slice(-20))}`,
    );
  });
});
