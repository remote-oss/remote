/**
 * @fileoverview F-2103, the setting `remote.SSH.useExecServer` and the legacy bootstrap on the standard editor (card
 * #3027): the editor of the run names no CLI source, so every connect of the standard launches takes the direct install,
 * the legacy layout `<data folder>/bin/<commit>`, whatever the setting says; the rows here are the setting's entry in
 * the Settings editor and what a connect in that layout shows and leaves on the host.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionHelpers,
  connectionLog,
  inWindow,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreUserSettings,
  sshdLog,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  DATA_FOLDER,
  freshHost,
  INSTALL_MILLISECONDS,
  password,
  serverMainProcesses,
} from '../windows/maintenance.ts';
import {
  notifications,
  pageText,
  settingRow,
  statusBarText,
  windowTitle,
} from '../windows/renderer.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';
import {hostBlock, writeConfig} from '../windows/config-keywords-support.ts';

const SETTING = 'remote.SSH.useExecServer';

/** The line the log says once for a connect that did not take the CLI path because the editor names no CLI source. */
const CLI_NOT_USED =
  'the CLI path was not used: the editor names no CLI source';

/** The entries of the host's `bin` folder: the commits of the servers installed in the legacy layout. */
async function installs(): Promise<string[]> {
  return (
    await onHost('sh', '-c', `ls -1 ${DATA_FOLDER}/bin 2>/dev/null; true`)
  )
    .split('\n')
    .filter(line => line !== '');
}

/** The command lines of the host's processes of the CLI's server (`code-<commit>`), none in the legacy layout. */
async function cliProcesses(): Promise<string> {
  return (
    await onHost(
      'sh',
      '-c',
      "pgrep -u harness -fa '[c]ode-[0-9a-f]\\{40\\}'; true",
    )
  ).trim();
}

/** The steps the window's progress notification showed, in order. */
function stepsOf(name: string): string[] {
  return recordLines('progress', name).map(line => line.question);
}

describe('the setting and the legacy bootstrap on the standard editor (card #3027, F-2103)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
  });

  after(() => {
    restoreUserSettings(saved);
  });

  it('F-2103 AC-1 (c3027-setting): searching the setting in the Settings editor lists one boolean entry titled Remote.SSH: Use Exec Server, applying to all profiles, checked by default, with the exact description', async () => {
    await inWindow('local', 'workbench.action.openSettings', SETTING);
    try {
      await waitFor(
        'the setting on the Settings editor list',
        async () => (await settingRow('local')) !== undefined,
        30_000,
      );
      deepStrictEqual(
        {
          listed: await settingRow('local'),
          setByUser: (readUserSettings() ?? '').includes(SETTING),
        },
        {
          listed: {
            lines: [
              'Remote.SSH: Use Exec Server(Applies to all profiles)',
              'Uses the a new bootstrapping mode when connecting to a server. Can be toggled off in the event of connection issues.',
            ],
            checked: true,
            section: 'User',
            count: 1,
          },
          setByUser: false,
        },
      );
    } finally {
      await inWindow('local', 'workbench.action.closeActiveEditor').catch(
        () => undefined,
      );
    }
  });

  it.skip('F-2103 AC-4 (c3027-off): waits for #3092, athena’s ruling-3027-legacy-label: with the setting off on a fresh host the legacy layout is installed, no CLI process runs, no download notification shows, and the title and the indicator change together', async () => {
    await freshHost();
    // An alias no earlier window of the run resolved: the editor caches the label of a remote it has shown, so a window on
    // a known one is titled with the host before it connects.
    const alias = 'c3027-off-host';
    const before = readUserSettings();
    await userSettings({
      'remote.SSH.configFile': writeConfig(alias, [hostBlock(alias, [])]),
      'remote.SSH.remotePlatform': {[alias]: 'linux'},
      [SETTING]: false,
    });
    const name = 'c3027-off';
    await openWindow(alias, name);
    const samples: Array<{
      time: number;
      title: string;
      indicator: string;
      shown: string[];
    }> = [];
    /** The polls at which the title or the indicator changed: when, the title and the indicator. */
    function transitions(): string {
      return JSON.stringify(
        samples
          .filter(
            (sample, index) =>
              sample.title !== samples[index - 1]?.title ||
              sample.indicator !== samples[index - 1]?.indicator,
          )
          .map(sample => [
            sample.time - (samples[0]?.time ?? 0),
            sample.title,
            sample.indicator,
          ]),
      );
    }
    try {
      await waitFor(
        `${name} to show the host in its title and its indicator`,
        async () => {
          samples.push({
            time: Date.now(),
            title: await windowTitle(name).catch(() => ''),
            indicator: await statusBarText(name, 'status.host').catch(() => ''),
            shown: await notifications(name).catch(() => []),
          });
          const last = samples.at(-1);
          return (
            last?.indicator === `SSH: ${alias}` &&
            last.title.includes(`SSH: ${alias}`)
          );
        },
        INSTALL_MILLISECONDS,
      ).catch((caught: unknown) => {
        throw new Error(`${String(caught)}\n${transitions()}`);
      });
      await connectedWithin(name, INSTALL_MILLISECONDS);
      const firstNamed = samples.find(sample =>
        sample.title.includes(`SSH: ${alias}`),
      );
      deepStrictEqual(
        {
          installed: (await installs()).map(commit =>
            /^[0-9a-f]{40}$/u.test(commit),
          ),
          cliProcess: await cliProcesses(),
          downloadNotice: samples.some(sample =>
            sample.shown.some(text =>
              text.includes('Downloading VS Code Server...'),
            ),
          ),
          opening: [
            samples[0]?.title.includes('SSH: ') ?? true,
            samples[0]?.indicator,
          ],
          together: firstNamed?.indicator,
        },
        {
          installed: [true],
          cliProcess: '',
          downloadNotice: false,
          opening: [false, 'Opening Remote...'],
          together: `SSH: ${alias}`,
        },
        transitions(),
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      restoreUserSettings(before);
    }
  });

  /** A connect with the setting `value` on a fresh host, and what it installed, fetched, logged and showed. */
  async function noCliSourceFor(label: string, value: boolean | undefined) {
    await freshHost();
    await userSettings({...PLATFORMS, [SETTING]: value});
    const name = `c3027-no-cli-${label}`;
    const mark = connectionLog().length;
    await openWindow('harness', name);
    try {
      await connectedWithin(name, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {
          installed: (await installs()).length,
          cliProcess: await cliProcesses(),
          cliFolder: (await onHost('sh', '-c', `ls -1 ${DATA_FOLDER}`))
            .split('\n')
            .filter(entry => entry.startsWith('cli')),
          logged: connectionLog()
            .slice(mark)
            .filter(line => line.includes(CLI_NOT_USED)).length,
          modeNotices: (await notifications(name)).filter(text =>
            /exec server/iu.test(text),
          ),
        },
        {
          installed: 1,
          cliProcess: '',
          cliFolder: [],
          logged: 1,
          modeNotices: [],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  }

  it('F-2103 AC-32 (c3027-no-cli-source-true): with the setting true, an editor that names no CLI source installs the legacy layout, fetches no CLI, says nothing of the mode and logs once why', async () => {
    await noCliSourceFor('true', true);
  });

  it('F-2103 AC-32 (c3027-no-cli-source-unset): with the setting unset, an editor that names no CLI source installs the legacy layout, fetches no CLI, says nothing of the mode and logs once why', async () => {
    await noCliSourceFor('unset', undefined);
  });

  it('F-2103 AC-23 (c3027-progress): on a fresh host the progress shows Downloading and then Installing before the window resolves', async () => {
    await freshHost();
    await userSettings({...PLATFORMS, [SETTING]: undefined});
    const name = 'c3027-progress';
    await openWindow('harness', name);
    try {
      await connectedWithin(name, INSTALL_MILLISECONDS);
      const steps = stepsOf(name);
      deepStrictEqual(
        [
          steps.includes('Downloading VS Code Server'),
          steps.indexOf('Downloading VS Code Server') <
            steps.indexOf('Installing VS Code Server'),
        ],
        [true, true],
        JSON.stringify(steps),
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2103 AC-24, AC-33 (c3027-reuse-part): a new SSH connection reuses the running legacy server with no download or install, and the server outlives the closed window', async () => {
    await freshHost();
    await userSettings({...PLATFORMS, [SETTING]: false});
    const first = 'c3027-reuse-first';
    await openWindow('harness', first);
    await connectedWithin(first, INSTALL_MILLISECONDS);
    const servers = await serverMainProcesses();
    await closeWindow(first);
    await waitFor(
      'the SSH connection to end',
      async () => (await connectionHelpers()).length === 0,
      15_000,
    );
    const stillRunning = (await serverMainProcesses()).filter(processId =>
      servers.includes(processId),
    );
    const second = 'c3027-reuse-second';
    await openWindow('harness', second);
    try {
      await connectedWithin(second, INSTALL_MILLISECONDS);
      const steps = stepsOf(second);
      deepStrictEqual(
        {
          outlived: stillRunning,
          download: steps.includes('Downloading VS Code Server'),
          install: steps.includes('Installing VS Code Server'),
          reused: (await serverMainProcesses()).includes(servers[0] ?? -1),
        },
        {outlived: servers, download: false, install: false, reused: true},
      );
    } finally {
      await closeWindow(second).catch(() => undefined);
    }
  });

  it('F-2103 AC-21 (c3027-no-mode-part): a connected window shows nowhere which bootstrap mode it took', async () => {
    await freshHost();
    await userSettings({...PLATFORMS, [SETTING]: undefined});
    const name = 'c3027-no-mode';
    await openWindow('harness', name);
    try {
      await connectedWithin(name, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {
          mentions: /exec server|legacy|bootstrap/iu.exec(
            await pageText(name),
          )?.[0],
          indicator: await statusBarText(name, 'status.host'),
        },
        {mentions: undefined, indicator: 'SSH: harness'},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2103 AC-25 (c3027-ride-reload): a second window that rides another window’s connection reconnects after a reload with no new SSH login', async () => {
    await freshHost();
    await userSettings({
      ...PLATFORMS,
      'remote.SSH.remotePlatform': {harness: 'linux', password: 'linux'},
      [SETTING]: false,
    });
    const first = 'c3027-ride-first';
    const second = 'c3027-ride-second';
    appendScript([
      {...password(), window: first},
      {...password(), window: second},
    ]);
    await openWindow('password', first);
    await connectedWithin(first, INSTALL_MILLISECONDS);
    await openWindow('password', second);
    await connectedWithin(second, INSTALL_MILLISECONDS);
    const asked = recordLines('maskedInput', second).length;
    const since = new Date().toISOString();
    try {
      await reloadWindow(second);
      await connectedWithin(second, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {
          askedAfterReload: recordLines('maskedInput', second).length - asked,
          logins: (await sshdLog(since)).filter(line =>
            line.includes('Accepted password for harness-pw'),
          ),
        },
        {askedAfterReload: 0, logins: []},
      );
    } finally {
      await closeWindow(second).catch(() => undefined);
      await closeWindow(first).catch(() => undefined);
    }
  });
});
