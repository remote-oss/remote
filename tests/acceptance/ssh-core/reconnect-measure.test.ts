import {execFileSync} from 'node:child_process';
import {
  connectedWithin,
  connectionLog,
  inWindow,
  onHostAs,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {attemptsSince, pauseHost, unpauseHost} from '../windows/outage.ts';

function sh(command: string): string {
  try {
    return execFileSync('sh', ['-c', command], {encoding: 'utf8'});
  } catch (caught) {
    return `failed: ${String(caught)}`;
  }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('measure: host processes and the old ssh under a pause (card #2703)', function () {
  this.timeout(600_000);
  let saved: string | undefined;
  before(async () => {
    saved = readUserSettings();
    await userSettings({'window.dialogStyle': 'custom'});
  });
  after(async () => {
    unpauseHost();
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('P5: host processes with a terminal, before and after a kill of the ssh; P6: the old ssh under a pause', async () => {
    await openWindow('harness', 'm-host');
    await connectedWithin('m-host', 120_000);
    await inWindow('m-host', 'workbench.action.terminal.new');
    await sleep(5000);
    const hostPs = () =>
      onHostAs(
        'root',
        'sh',
        '-c',
        'ps -u harness -o pid=,ppid=,comm=,args= | cut -c1-210',
      );
    console.log('P5 host before:\n' + (await hostPs()));
    const localSsh = () =>
      sh(
        "ps -eo pid,ppid,etimes,args | grep -E '^ *[0-9]+ +[0-9]+ +[0-9]+ ssh ' | grep -v grep | cut -c1-200",
      );
    console.log('P5 local ssh before:\n' + localSsh());
    const pids = sh(
      "ps -eo pid,args | grep -E '^ *[0-9]+ ssh ' | grep -E ' -D ' | grep -v grep | awk '{print $1}'",
    )
      .split('\n')
      .filter(x => x !== '');
    for (const pid of pids) sh(`kill ${pid}`);
    await sleep(6000);
    console.log('P5 host after:\n' + (await hostPs()));
    console.log('P5 local ssh after:\n' + localSsh());
    // P6
    const old = sh(
      "ps -eo pid,args | grep -E '^ *[0-9]+ ssh ' | grep -E ' -D ' | grep -v grep | awk '{print $1}'",
    )
      .split('\n')
      .filter(x => x !== '');
    console.log(`P6 ssh pids before pause ${JSON.stringify(old)}`);
    const mark = connectionLog().length;
    pauseHost();
    await waitFor(
      'attempt 2',
      () => attemptsSince(mark, 'harness').length > 0,
      90_000,
    );
    const began = Date.now();
    const gone: string[] = [];
    while (Date.now() - began < 20_000) {
      gone.push(
        `${String(Date.now() - began)}ms ${old.map(pid => sh(`kill -0 ${pid} 2>&1 && echo alive || echo gone`).trim()).join(',')}`,
      );
      await sleep(500);
    }
    console.log(
      'P6 old ssh liveness since attempt 2 started:\n' + gone.join('\n'),
    );
    console.log('P6 local ssh now:\n' + localSsh());
    unpauseHost();
  });
});
