import {execFileSync} from 'node:child_process';
import {
  connectedWithin,
  connectionLog,
  openWindow,
  onHostAs,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {attemptsSince, pauseHost, unpauseHost} from '../windows/outage.ts';
import {dialogOf, notifications, statusBarText} from '../windows/renderer.ts';

function sh(command: string): string {
  try {
    return execFileSync('sh', ['-c', command], {encoding: 'utf8'});
  } catch (caught) {
    return `failed: ${String(caught)}`;
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('measure: processes, a killed ssh, the notification and a silent outage (card #2703)', function () {
  this.timeout(900_000);
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

  it('P1 and P2: the local processes, then the ssh killed', async () => {
    await openWindow('harness', 'm-ps');
    await connectedWithin('m-ps', 120_000);
    console.log(
      'P1 local processes:\n' +
        sh(
          "ps -eo pid,ppid,etimes,args | grep -E 'ssh|socks|helper' | grep -v grep | cut -c1-260",
        ),
    );
    console.log(
      'P1 host processes:\n' +
        (await onHostAs(
          'root',
          'sh',
          '-c',
          "ps -eo pid,ppid,etimes,args | grep -E 'server|ext|node|bash' | grep -v grep | cut -c1-200",
        )),
    );
    const mark = connectionLog().length;
    const pids = sh(
      "ps -eo pid,args | grep -E '^ *[0-9]+ ssh ' | grep -E ' -D ' | grep -v grep | awk '{print $1}'",
    )
      .split('\n')
      .filter(x => x !== '');
    console.log(
      `P2 killing ${JSON.stringify(pids)} at ${new Date().toISOString()}`,
    );
    const began = Date.now();
    for (const pid of pids) sh(`kill ${pid}`);
    const seen: string[] = [];
    while (Date.now() - began < 12_000) {
      seen.push(
        `${String(Date.now() - began)}ms ${await statusBarText('m-ps', 'status.host').catch(() => '?')} | ${(await notifications('m-ps').catch(() => [])).join(' / ')} | dialog=${(await dialogOf('m-ps').catch(() => undefined))?.details ?? ''}`,
      );
      await sleep(300);
    }
    console.log('P2 samples:\n' + seen.join('\n'));
    console.log(
      'P2 log:\n' +
        connectionLog({withTimes: true})
          .slice(mark)
          .filter(l =>
            /Resolving|reconnect|connect|ssh|window port|ended/i.test(l),
          )
          .slice(0, 40)
          .join('\n'),
    );
    console.log(
      'P2 local processes after:\n' +
        sh(
          "ps -eo pid,ppid,etimes,args | grep -E 'ssh' | grep -v grep | cut -c1-200",
        ),
    );
  });

  it('P3: the notification during a reconnection attempt', async () => {
    await closeAllButLocal();
    await openWindow('harness', 'm-note');
    await connectedWithin('m-note', 120_000);
    const mark = connectionLog().length;
    pauseHost();
    await waitFor(
      'attempt 2',
      () => attemptsSince(mark, 'harness').length > 0,
      90_000,
    );
    unpauseHost();
    const began = Date.now();
    const seen: string[] = [];
    while (Date.now() - began < 40_000) {
      seen.push(
        `${String(Date.now() - began)}ms ${await statusBarText('m-note', 'status.host').catch(() => '?')} | ${(await notifications('m-note').catch(() => [])).join(' / ')}`,
      );
      await sleep(400);
    }
    console.log('P3 samples:\n' + seen.join('\n'));
  });

  it('P4: a silent outage by disconnecting the container from its network', async () => {
    await closeAllButLocal();
    const container = variable('HARNESS_CONTAINER');
    console.log(
      'P4 networks: ' +
        sh(
          `docker inspect -f '{{json .NetworkSettings.Networks}}' ${container}`,
        ),
    );
    console.log('P4 ports: ' + sh(`docker port ${container}`));
    const networks = JSON.parse(
      sh(`docker inspect -f '{{json .NetworkSettings.Networks}}' ${container}`),
    ) as Record<string, {IPAddress: string}>;
    const [network, info] = Object.entries(networks)[0] ?? [
      '',
      {IPAddress: ''},
    ];
    await openWindow('harness', 'm-silent');
    await connectedWithin('m-silent', 120_000);
    const mark = connectionLog().length;
    const began = Date.now();
    console.log(
      'P4 disconnect: ' +
        sh(`docker network disconnect ${network} ${container} 2>&1`),
    );
    await sleep(150_000);
    console.log(
      'P4 attempts: ' + JSON.stringify(attemptsSince(mark, 'harness')),
    );
    console.log(
      'P4 log:\n' +
        connectionLog({withTimes: true})
          .slice(mark)
          .filter(l =>
            /Resolving|timed out|Offline|connect failed|banner/i.test(l),
          )
          .slice(0, 30)
          .join('\n'),
    );
    console.log(
      'P4 reconnect: ' +
        sh(
          `docker network connect --ip ${info.IPAddress} ${network} ${container} 2>&1; docker port ${container}`,
        ),
    );
    console.log(`P4 took ${String(Date.now() - began)} ms`);
    await sleep(60_000);
    console.log(
      'P4 indicator after reconnect: ' +
        (await statusBarText('m-silent', 'status.host').catch(() => '?')),
    );
  });
});
