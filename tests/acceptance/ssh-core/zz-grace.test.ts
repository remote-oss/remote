import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  editorLogsFolder,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal, dismissals} from '../windows/maintenance.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';

const DATA = '/home/harness/.vscodium-server-insiders';

function logFiles(folder: string): string[] {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory()
      ? logFiles(file)
      : file.endsWith('.log')
        ? [file]
        : [];
  });
}

async function noServers(): Promise<void> {
  await onHost('pkill', '-u', 'harness', '-f', `${DATA}/`).catch(
    () => undefined,
  );
  await onHost('pkill', '-u', 'harness', '-f', 'code-insiders').catch(
    () => undefined,
  );
  await waitFor(
    'no server processes',
    async () =>
      onHost('pgrep', '-u', 'harness', '-f', `${DATA}/`).then(
        () => false,
        () => true,
      ),
    60_000,
  );
}

const VARIANTS: Array<[string, Record<string, unknown>]> = [
  ['sixty', {'remote.SSH.reconnectionGraceTime': 60}],
  ['unset', {}],
  [
    'legacy-sixty',
    {'remote.SSH.reconnectionGraceTime': 60, 'remote.SSH.useExecServer': false},
  ],
  [
    'terminal-sixty',
    {
      'remote.SSH.reconnectionGraceTime': 60,
      'remote.SSH.useLocalServer': false,
    },
  ],
  ['string-thirty', {'remote.SSH.reconnectionGraceTime': '30'}],
  ['minus-five', {'remote.SSH.reconnectionGraceTime': -5}],
  ['one-and-half', {'remote.SSH.reconnectionGraceTime': 1.5}],
  ['zero', {'remote.SSH.reconnectionGraceTime': 0}],
  [
    'legacy-minus-five',
    {'remote.SSH.reconnectionGraceTime': -5, 'remote.SSH.useExecServer': false},
  ],
];

describe('what a row can read of the grace time (card #2651, throwaway scouting)', function () {
  this.timeout(1_800_000);
  const saved = readUserSettings();
  beforeEach(closeAllButLocal);
  after(() => {
    restoreUserSettings(saved);
  });

  it('each variant from no server', async () => {
    const results: unknown[] = [];
    for (const [variant, settings] of VARIANTS) {
      await noServers();
      restoreUserSettings(saved);
      await userSettings({...PLATFORMS, ...settings});
      const name = `grace-${variant}`;
      appendScript(dismissals(name));
      const mark = connectionLog().length;
      await openWindow('harness', name);
      let outcome = 'timeout';
      const dialog = () => recordLines('failureDialog', name)[0]?.question;
      await waitFor(
        `${name} to connect or fail`,
        async () => {
          if (dialog() !== undefined) {
            outcome = 'dialog';
            return true;
          }
          try {
            await connectedWithin(name, 1);
            outcome = 'connected';
            return true;
          } catch {
            return false;
          }
        },
        180_000,
      ).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 4000));
      const processes = (
        await onHost(
          'sh',
          '-c',
          `ps -eo args | grep -i '${DATA}\\|code-insiders' | grep -v grep | cut -c1-400 || true`,
        )
      )
        .split('\n')
        .filter(line => /grace|serve|server-main|--port|--socket/.test(line));
      const serverLog = (
        await onHost(
          'sh',
          '-c',
          `grep -ih 'grace\\|reconnection' ${DATA}/.*.log 2>/dev/null | cut -c1-300 | tail -12 || true`,
        )
      ).split('\n');
      const remoteLog = connectionLog()
        .slice(mark)
        .filter(line => /grace|reconnection/i.test(line));
      const clientLog = logFiles(editorLogsFolder()).flatMap(file =>
        readFileSync(file, 'utf8')
          .split('\n')
          .filter(line => /grace/i.test(line))
          .map(
            line =>
              `${path.basename(path.dirname(file))}/${path.basename(file)}: ${line.slice(0, 260)}`,
          ),
      );
      results.push({
        variant,
        outcome,
        dialog: dialog(),
        processes,
        serverLog,
        remoteLog,
        clientLog: clientLog.slice(-8),
      });
      await closeWindow(name).catch(() => undefined);
    }
    process.stdout.write(`GRACE ${JSON.stringify(results)}\n`);
  });
});
