import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  inWindow,
  onHostAs,
  openWindow,
  runProcessTask,
  terminalNamed,
  terminalNames,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';

/** One account per login shell, side by side on one host (card tooling-55). */
describe('one account per login shell (card tooling-55)', function () {
  this.timeout(600_000);

  it("#1220: harness-bash connects, a task reads the server's environment, and a new terminal is named after the login shell", async () => {
    await openWindow('harness-bash', 'ls-bash');
    try {
      await connectedWithin('ls-bash', INSTALL_MILLISECONDS);
      const exitCode = await runProcessTask('ls-bash', '/bin/sh', [
        '-c',
        'env > /tmp/ls-env-bash',
      ]);
      const homeLine = (
        await onHostAs('harness-bash', 'cat', '/tmp/ls-env-bash')
      )
        .split('\n')
        .includes('HOME=/home/harness-bash');
      await inWindow('ls-bash', 'workbench.action.terminal.new');
      const shellTerminal = (await terminalNames('ls-bash')).includes('bash');
      deepStrictEqual(
        {exitCode, homeLine, shellTerminal},
        {exitCode: 0, homeLine: true, shellTerminal: true},
      );
    } finally {
      await closeWindow('ls-bash');
    }
  });

  it("#1220: harness-zsh connects, a task reads the server's environment, and a new terminal is named after the login shell", async () => {
    await openWindow('harness-zsh', 'ls-zsh');
    try {
      await connectedWithin('ls-zsh', INSTALL_MILLISECONDS);
      const exitCode = await runProcessTask('ls-zsh', '/bin/sh', [
        '-c',
        'env > /tmp/ls-env-zsh',
      ]);
      const homeLine = (await onHostAs('harness-zsh', 'cat', '/tmp/ls-env-zsh'))
        .split('\n')
        .includes('HOME=/home/harness-zsh');
      await inWindow('ls-zsh', 'workbench.action.terminal.new');
      const shellTerminal = (await terminalNames('ls-zsh')).includes('zsh');
      deepStrictEqual(
        {exitCode, homeLine, shellTerminal},
        {exitCode: 0, homeLine: true, shellTerminal: true},
      );
    } finally {
      await closeWindow('ls-zsh');
    }
  });

  it("#1220: harness-dash connects, a task reads the server's environment, and a new terminal is named after the login shell", async () => {
    await openWindow('harness-dash', 'ls-dash');
    try {
      await connectedWithin('ls-dash', INSTALL_MILLISECONDS);
      const exitCode = await runProcessTask('ls-dash', '/bin/sh', [
        '-c',
        'env > /tmp/ls-env-dash',
      ]);
      const homeLine = (
        await onHostAs('harness-dash', 'cat', '/tmp/ls-env-dash')
      )
        .split('\n')
        .includes('HOME=/home/harness-dash');
      await inWindow('ls-dash', 'workbench.action.terminal.new');
      const shellTerminal = (await terminalNames('ls-dash')).includes('sh');
      deepStrictEqual(
        {exitCode, homeLine, shellTerminal},
        {exitCode: 0, homeLine: true, shellTerminal: true},
      );
    } finally {
      await closeWindow('ls-dash');
    }
  });

  it("#1220: harness-ksh connects, a task reads the server's environment, and a new terminal is named after the login shell", async () => {
    await openWindow('harness-ksh', 'ls-ksh');
    try {
      await connectedWithin('ls-ksh', INSTALL_MILLISECONDS);
      const exitCode = await runProcessTask('ls-ksh', '/bin/sh', [
        '-c',
        'env > /tmp/ls-env-ksh',
      ]);
      const homeLine = (await onHostAs('harness-ksh', 'cat', '/tmp/ls-env-ksh'))
        .split('\n')
        .includes('HOME=/home/harness-ksh');
      await inWindow('ls-ksh', 'workbench.action.terminal.new');
      const shellTerminal = (await terminalNames('ls-ksh')).includes('ksh');
      deepStrictEqual(
        {exitCode, homeLine, shellTerminal},
        {exitCode: 0, homeLine: true, shellTerminal: true},
      );
    } finally {
      await closeWindow('ls-ksh');
    }
  });

  it("#1220: harness-csh connects, a task reads the server's environment, and a new terminal is named after the login shell", async () => {
    await openWindow('harness-csh', 'ls-csh');
    try {
      await connectedWithin('ls-csh', INSTALL_MILLISECONDS);
      const exitCode = await runProcessTask('ls-csh', '/bin/sh', [
        '-c',
        'env > /tmp/ls-env-csh',
      ]);
      const homeLine = (await onHostAs('harness-csh', 'cat', '/tmp/ls-env-csh'))
        .split('\n')
        .includes('HOME=/home/harness-csh');
      await inWindow('ls-csh', 'workbench.action.terminal.new');
      const shellTerminal = await terminalNamed('ls-csh', 'tcsh');
      deepStrictEqual(
        {exitCode, homeLine, shellTerminal},
        {exitCode: 0, homeLine: true, shellTerminal: true},
      );
    } finally {
      await closeWindow('ls-csh');
    }
  });

  it("#1220: harness-tcsh connects, a task reads the server's environment, and a new terminal is named after the login shell", async () => {
    await openWindow('harness-tcsh', 'ls-tcsh');
    try {
      await connectedWithin('ls-tcsh', INSTALL_MILLISECONDS);
      const exitCode = await runProcessTask('ls-tcsh', '/bin/sh', [
        '-c',
        'env > /tmp/ls-env-tcsh',
      ]);
      const homeLine = (
        await onHostAs('harness-tcsh', 'cat', '/tmp/ls-env-tcsh')
      )
        .split('\n')
        .includes('HOME=/home/harness-tcsh');
      await inWindow('ls-tcsh', 'workbench.action.terminal.new');
      const shellTerminal = await terminalNamed('ls-tcsh', 'tcsh');
      deepStrictEqual(
        {exitCode, homeLine, shellTerminal},
        {exitCode: 0, homeLine: true, shellTerminal: true},
      );
    } finally {
      await closeWindow('ls-tcsh');
    }
  });

  it("#1220: harness-fish connects, a task reads the server's environment, and a new terminal is named after the login shell", async () => {
    await openWindow('harness-fish', 'ls-fish');
    try {
      await connectedWithin('ls-fish', INSTALL_MILLISECONDS);
      const exitCode = await runProcessTask('ls-fish', '/bin/sh', [
        '-c',
        'env > /tmp/ls-env-fish',
      ]);
      const homeLine = (
        await onHostAs('harness-fish', 'cat', '/tmp/ls-env-fish')
      )
        .split('\n')
        .includes('HOME=/home/harness-fish');
      await inWindow('ls-fish', 'workbench.action.terminal.new');
      const shellTerminal = await terminalNamed('ls-fish', 'fish');
      deepStrictEqual(
        {exitCode, homeLine, shellTerminal},
        {exitCode: 0, homeLine: true, shellTerminal: true},
      );
    } finally {
      await closeWindow('ls-fish');
    }
  });
});
