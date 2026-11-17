import {execFileSync} from 'node:child_process';
import {
  closeWindow,
  connectedWithin,
  connectionLog,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {dialogOf, statusBarText} from '../windows/renderer.ts';

describe('measure: the reconnection loop of a paused host (card #2703)', function () {
  this.timeout(900_000);
  let saved: string | undefined;
  before(async () => {
    saved = readUserSettings();
    await userSettings({'window.dialogStyle': 'custom'});
  });
  after(async () => {
    execFileSync('docker', ['unpause', variable('HARNESS_CONTAINER')], {
      stdio: 'ignore',
    });
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('measure: unset limit, 330 s of outage', async () => {
    await openWindow('harness', 'm2703');
    await connectedWithin('m2703', 120_000);
    const mark = connectionLog().length;
    const began = Date.now();
    execFileSync('docker', ['pause', variable('HARNESS_CONTAINER')]);
    const indicators: string[] = [];
    while (Date.now() - began < 330_000) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      indicators.push(
        `${String(Math.round((Date.now() - began) / 1000))}s ${await statusBarText('m2703', 'status.host').catch(() => '?')} dialog=${(await dialogOf('m2703').catch(() => undefined))?.details ?? ''}`,
      );
    }
    execFileSync('docker', ['unpause', variable('HARNESS_CONTAINER')]);
    console.log(`pause began ${new Date(began).toISOString()}`);
    console.log(connectionLog({withTimes: true}).slice(mark).join('\n'));
    console.log(indicators.join('\n'));
    await closeWindow('m2703').catch(() => undefined);
  });
});
