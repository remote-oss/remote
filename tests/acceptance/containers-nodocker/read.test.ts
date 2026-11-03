import {chmodSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  containersLog,
  devContainerFolder,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';
import {recordedCalls} from '../windows/folder-wrapper.ts';
import {removeContainersOf} from '../containers-shutdown/support.ts';

describe('probe: a relative dockerPath with no docker on the PATH', function () {
  this.timeout(600_000);
  it('probe nodocker', async () => {
    const calls = path.join(variable('HARNESS_RUN_FOLDER'), 'nd-calls');
    const folder = devContainerFolder('nodocker-folder', {name: 'ND'});
    // The editor was started with no docker on its PATH; this process only needs one for its own clean-up.
    process.env.PATH = '/usr/bin:/bin';
    const real = execFileSync('/usr/bin/which', ['docker']).toString().trim();
    const wrapper = path.join(folder, 'tools', 'dk');
    mkdirSync(path.dirname(wrapper), {recursive: true});
    writeFileSync(
      wrapper,
      `#!/bin/sh\nprintf '%s\\n' "$*" >>"${calls}"\nexec ${real} "$@"\n`,
    );
    chmodSync(wrapper, 0o755);
    await setUserSetting(
      'dev.containers.dockerPath',
      process.env.PROBE_ABSOLUTE === '1' ? wrapper : 'tools/dk',
    );
    const name = await openFolderWindow(folder);
    let outcome = 'connected';
    try {
      const reopened = reopenInContainer(name, 150_000);
      await waitForDialog(name);
      await answerDialog(name, 'Trust Folder & Continue');
      await reopened.catch((caught: unknown) => {
        outcome = String(caught);
      });
      deepStrictEqual(
        {
          outcome,
          remoteName: await windowState(name).then(
            state => state.remoteName,
            (caught: unknown) => String(caught).slice(0, 80),
          ),
          calls: recordedCalls(calls).slice(-8),
          log: containersLog().slice(-25),
        },
        {},
        'probe',
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainersOf(folder);
    }
  });
});
