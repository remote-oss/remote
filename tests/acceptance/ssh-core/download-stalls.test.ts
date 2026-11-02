import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  commandsOf,
  openWindow,
  readUserSettings,
  recordLines,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  dismissals,
  freshHost,
} from '../windows/maintenance.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

/** The failure dialog of a client download that stops. */
const DOWNLOAD_DIALOG =
  'Could not establish connection to "harness": Downloading VS Code Server failed. Please try again later.';

/** The failure dialog of a copy that stops. */
const COPY_DIALOG = 'Could not establish connection to "harness".';

/** What a stalled step left of the window, the settings and the ssh_config, and when its dialog came. */
interface Stalled {
  dialog: string | undefined;
  seconds: number;
  usableDuringWait: boolean;
  settingsKept: boolean;
  sshConfigKept: boolean;
}

/** The bytes of the run's ssh_config. */
function sshConfig(): string {
  return readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
}

/** The seconds the window waits in the stalled stage before it is asked, well under the 30 seconds that end the stage. */
const STALLED_SECONDS = 8;

/** Opens window `name` on the host with `settings`, waits until the progress shows `stage` and the step has stalled, and reports what the window and the files did. */
async function stalled(
  name: string,
  stage: string,
  settings: Record<string, unknown>,
): Promise<Stalled> {
  await freshHost();
  await userSettings({
    ...PLATFORMS,
    'remote.SSH.localServerDownload': 'always',
    ...settings,
  });
  const settingsBefore = readUserSettings();
  const sshConfigBefore = sshConfig();
  appendScript(dismissals(name));
  await openWindow('harness', name);
  try {
    await waitFor(
      `the progress to show ${stage}`,
      () => recordLines('progress', name).some(line => line.question === stage),
      60_000,
    );
    await new Promise(resolve => setTimeout(resolve, STALLED_SECONDS * 1000));
    const usableDuringWait =
      (await commandsOf(name, 'opensshremotes.')).length > 0 &&
      recordLines('failureDialog', name).length === 0;
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', name).length > 0,
      120_000,
    );
    const began = recordLines('progress', name)[0]?.time ?? 0;
    const ended = recordLines('failureDialog', name)[0]?.time ?? 0;
    return {
      dialog: recordLines('failureDialog', name)[0]?.question,
      seconds: (ended - began) / 1000,
      usableDuringWait,
      settingsKept: readUserSettings() === settingsBefore,
      sshConfigKept: sshConfig() === sshConfigBefore,
    };
  } finally {
    await closeWindow(name).catch(() => undefined);
  }
}

/** A stall's outcome with its seconds reduced to whether they fall in `least` to `most`. */
function withinBound(
  outcome: Stalled,
  least: number,
  most: number,
): Omit<Stalled, 'seconds'> & {seconds: string} {
  const inRange = outcome.seconds >= least && outcome.seconds <= most;
  return {
    ...outcome,
    seconds: inRange
      ? `${String(least)} to ${String(most)}`
      : String(outcome.seconds),
  };
}

describe('the download steps that stop (card coverage-87)', function () {
  this.timeout(300_000);

  after(async () => {
    await closeAllButLocal();
  });

  it('F-2405 AC-21 (local-stall): a client download that stops ends 25 to 50 seconds after it began, with the window usable meanwhile and the settings and ssh_config unchanged', async () => {
    await keepingSettings(async () => {
      const outcome = await stalled(
        'c87-stall',
        'Downloading VS Code Server locally',
        {
          'remote.SSH.serverDownloadUrlTemplate': `${variable('HARNESS_DOWNLOADS_LOCAL')}/stall/\${os}-\${arch}/\${commit}`,
        },
      );
      deepStrictEqual(withinBound(outcome, 25, 50), {
        dialog: DOWNLOAD_DIALOG,
        seconds: '25 to 50',
        usableDuringWait: true,
        settingsKept: true,
        sshConfigKept: true,
      });
    });
  });

  it('F-2405 AC-21 (local-copy-stall): a copy that stops ends 25 to 70 seconds after it began, with the window usable meanwhile and the settings and ssh_config unchanged', async () => {
    await keepingSettings(async () => {
      const outcome = await stalled(
        'c87-copy-stall',
        'Copying VS Code Server to host with scp',
        {
          'remote.SSH.serverDownloadUrlTemplate': `${variable('HARNESS_DOWNLOADS_LOCAL')}/ok/\${os}-\${arch}/\${commit}`,
          'remote.SSH.path': path.join(
            variable('HARNESS_RUN_FOLDER'),
            'clients/copy-stalls/ssh',
          ),
        },
      );
      deepStrictEqual(withinBound(outcome, 25, 70), {
        dialog: COPY_DIALOG,
        seconds: '25 to 70',
        usableDuringWait: true,
        settingsKept: true,
        sshConfigKept: true,
      });
    });
  });
});
