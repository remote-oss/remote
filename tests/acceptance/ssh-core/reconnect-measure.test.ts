import {execFileSync} from 'node:child_process';
import {
  connectedWithin,
  inWindow,
  onHostAs,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';

function sh(command: string): string {
  try {
    return execFileSync('sh', ['-c', command], {encoding: 'utf8'});
  } catch (caught) {
    return `failed: ${String(caught)}`;
  }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('measure: host processes by pgrep and the per-window ssh (card #2703)', function () {
  this.timeout(600_000);
  let saved: string | undefined;
  before(async () => {
    saved = readUserSettings();
    await userSettings({'window.dialogStyle': 'custom'});
  });
  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('P7: host processes with a terminal', async () => {
    await openWindow('harness', 'm-host');
    await connectedWithin('m-host', 120_000);
    await inWindow('m-host', 'workbench.action.terminal.new');
    await sleep(8000);
    console.log(
      'P7 host:\n' +
        (await onHostAs(
          'root',
          'sh',
          '-c',
          'pgrep -a -u harness | cut -c1-230',
        ).catch(e => `failed ${String(e)}`)),
    );
    console.log(
      'P7 host tree:\n' +
        (await onHostAs(
          'root',
          'sh',
          '-c',
          "for p in $(pgrep -u harness); do echo \"$p ppid=$(awk '{print $4}' /proc/$p/stat) $(tr '\\0' ' ' < /proc/$p/cmdline | cut -c1-160)\"; done",
        ).catch(e => `failed ${String(e)}`)),
    );
  });

  it('P8: the per-window mode', async () => {
    await closeAllButLocal();
    await userSettings({
      'remote.SSH.useLocalServer': false,
      'remote.SSH.remotePlatform': {harness: 'linux'},
    });
    await openWindow('harness', 'm-pw');
    await connectedWithin('m-pw', 180_000);
    await sleep(3000);
    console.log(
      'P8 local ssh:\n' +
        sh("ps -eo pid,ppid,args | grep -E 'ssh' | grep -v grep | cut -c1-260"),
    );
  });
});
