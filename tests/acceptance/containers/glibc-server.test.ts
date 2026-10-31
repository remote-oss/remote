import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  GLIBC_IMAGE,
  reopenInContainer,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

describe('the glibc server of the run (card tooling-68)', function () {
  this.timeout(600_000);

  it("#1359: a Debian container's window connects with the run's glibc server", async () => {
    const folder = devContainerFolder('glibc-server', {
      name: 'glibc-server',
      image: GLIBC_IMAGE,
    });
    try {
      const name = await openFolderWindow(folder);
      try {
        await reopenInContainer(name);
        const [containerId = ''] = await devContainersOf(folder);
        // The server's Node.js is linked against the C library of its archive: a musl one doesn't start on glibc.
        const {stdout} = await execFileAsync('docker', [
          'exec',
          containerId,
          'sh',
          '-c',
          'ldd --version 2>&1 | head -n 1',
        ]);
        deepStrictEqual(
          {
            remoteName: (await windowState(name)).remoteName,
            glibc: /GLIBC|GNU libc/.test(stdout),
          },
          {remoteName: 'dev-container', glibc: true},
        );
      } finally {
        await closeWindow(name);
      }
    } finally {
      await removeContainers(folder);
    }
  });
});
