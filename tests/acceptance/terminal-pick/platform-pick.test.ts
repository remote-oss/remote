import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openWindow, recordLines, windowState} from '../windows/harness.ts';

/** How long the user settings file may take to gain the platform after the window connects, in milliseconds. */
const SETTINGS_WAIT_MILLISECONDS = 10_000;

/** The `remote.SSH.remotePlatform` entry of the launch's user settings, or nothing while it is not written. */
function storedPlatform(): unknown {
  const file = path.join(
    process.env.HARNESS_USER_DATA ?? '',
    'User',
    'settings.json',
  );
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)[
        'remote.SSH.remotePlatform'
      ]
    : undefined;
}

/** Polls until the platform is stored, or the wait is over, and gives what is stored. */
async function storedWithin(milliseconds: number): Promise<unknown> {
  const deadline = Date.now() + milliseconds;
  while (storedPlatform() === undefined && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return storedPlatform();
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
    deepStrictEqual(
      [
        (await windowState('tp1')).remoteName,
        recordLines('platformPick').map(line => line.answer),
        await storedWithin(SETTINGS_WAIT_MILLISECONDS),
      ],
      ['ssh-remote', ['linux'], {harness: 'linux'}],
    );
  });
});
