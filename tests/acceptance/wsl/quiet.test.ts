import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  auditScript,
  outboundConnectionsOf,
} from '../../../tools/connection-audit.ts';
import {closeWindow, variable} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {runFolder} from './wsl-support.ts';

const execFileAsync = promisify(execFile);

/** The settings that leave the editor and the extension nothing to contact but what the row measures. */
const QUIET_SETTINGS: Readonly<Record<string, unknown>> = {
  'telemetry.telemetryLevel': 'all',
  'update.mode': 'none',
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
  'workbench.enableExperiments': false,
};

/** The telemetry logs of the extension host and of the editor, which must stay empty. */
const TELEMETRY_LOGS: readonly string[] = [
  'extHostTelemetry.log',
  'telemetry.log',
];

/** The paths below `folder` named one of `names` that are not empty. */
function nonEmptyLogs(folder: string, names: readonly string[]): string[] {
  return readdirSync(folder, {recursive: true})
    .map(String)
    .filter(
      each =>
        names.includes(path.basename(each)) &&
        statSync(path.join(folder, each)).size > 0,
    )
    .map(each => path.join(folder, each));
}

/** The process id of the extension host of window `name`: the pid file of the agent's pid folder that holds the window's name. */
function extensionHostOf(name: string): number {
  const pids = variable('REMOTE_OSS_ACCEPTANCE_WINDOWS');
  const files = readdirSync(pids).filter(
    file => readFileSync(path.join(pids, file), 'utf8') === name,
  );
  if (files.length !== 1) {
    throw new Error(
      `expected one pid file for window ${name} in ${pids}, found ${JSON.stringify(files)}`,
    );
  }
  return Number(files[0]);
}

/** The addresses of the run's download host, which the server download may reach. */
function downloadHosts(): string[] {
  return ['HARNESS_DOWNLOADS_HTTP', 'HARNESS_DOWNLOADS_HTTPS'].map(name =>
    new URL(variable(name)).hostname.replace(/^\[|\]$/gu, ''),
  );
}

describe('the WSL extension stays quiet (F-6005, card #3141)', function () {
  this.timeout(300_000);

  it('F-6005 AC-10, AC-13 (w6005-quiet): with telemetry all and every update and experiment off, the telemetry logs stay empty and the extension host contacts only the download host, from activation (todo: the connect to a distro and the recommendation are not in the product yet: #2389)', async () => {
    if (variable('HARNESS_CONNECTION_AUDIT') !== '1') {
      throw new Error('the job does not audit connections');
    }
    const started = new Date();
    for (const [setting, value] of Object.entries(QUIET_SETTINGS)) {
      await setUserSetting(setting, value);
    }
    const folder = runFolder('w6005-quiet');
    const window = await openFolderWindow(folder);
    try {
      const host = extensionHostOf(window);
      const {stdout} = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        auditScript(started),
      ]);
      const contacted = outboundConnectionsOf(stdout, host).map(
        connection => `${connection.address}:${String(connection.port)}`,
      );
      const allowed = downloadHosts();
      deepStrictEqual(
        {
          logs: [
            ...nonEmptyLogs(variable('HARNESS_EDITOR_LOGS'), TELEMETRY_LOGS),
            ...nonEmptyLogs(variable('HARNESS_USER_DATA'), TELEMETRY_LOGS),
          ],
          elsewhere: contacted.filter(
            each => !allowed.includes(each.slice(0, each.lastIndexOf(':'))),
          ),
        },
        {logs: [], elsewhere: []},
        `the extension host ${String(host)} contacted: ${JSON.stringify(contacted)}`,
      );
    } finally {
      for (const setting of Object.keys(QUIET_SETTINGS)) {
        await setUserSetting(setting, undefined);
      }
      await closeWindow(window);
    }
  });
});
