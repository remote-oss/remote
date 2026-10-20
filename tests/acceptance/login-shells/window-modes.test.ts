import {deepStrictEqual} from 'node:assert';
import {connectedWithin, reloadWindow, waitFor} from '../windows/harness.ts';
import {
  INSTALL_MILLISECONDS,
  linesSince,
  pickHost,
  runWith,
  serverProcesses,
  serversGoneWithin,
} from '../windows/maintenance.ts';
import {
  removeHomeFiles,
  freshServer,
  taskEnvironment,
  withWindow,
  writeHomeFile,
} from './shell-support.ts';

describe('login shells in the window, by mode and by command (card coverage-49)', function () {
  this.timeout(900_000);

  it('F-2704 AC-22 (kill-server): after Kill VS Code Server on Host the window reconnects to a new server within 60 s, and after a reload a task sees the changed .profile', async () => {
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.profile', 'export F2704_KILL=old\n');
    try {
      await withWindow('harness-bash', 'wm-ac22', async () => {
        const window = 'wm-ac22';
        const servers = await serverProcesses();
        await writeHomeFile(
          'harness-bash',
          '.profile',
          'export F2704_KILL=new\n',
        );
        const mark = await runWith(
          'local',
          'opensshremotes.cleanRemoteServer',
          [pickHost('harness-bash')],
        );
        await serversGoneWithin(servers, 10_000);
        await waitFor(
          `${window} to be resolved again by core’s reconnection`,
          () =>
            linesSince(mark, window).some(
              line =>
                line.surface === 'progress' &&
                line.question === 'Setting up SSH Host harness-bash',
            ),
          60_000,
        );
        await reloadWindow(window);
        await connectedWithin(window, INSTALL_MILLISECONDS);
        deepStrictEqual(
          (await taskEnvironment(window, 'harness-bash', 'wm-ac22')).F2704_KILL,
          'new',
        );
      });
    } finally {
      await removeHomeFiles('harness-bash', '.profile');
    }
  });
});
