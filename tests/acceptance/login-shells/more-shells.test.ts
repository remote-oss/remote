import {deepStrictEqual} from 'node:assert';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  connectedWithin,
  connectionLog,
  openWindow,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS, setting} from '../windows/maintenance.ts';
import {
  freshServer,
  newTerminalIs,
  removeHomeFiles,
  surfaceLines,
  taskEnvironment,
  withWindow,
  writeHomeFile,
} from './shell-support.ts';

/** The names of the variables of `environment` that start with `prefix`, sorted. */
function marked(environment: Record<string, string>, prefix: string): string[] {
  return Object.keys(environment)
    .filter(key => key.startsWith(prefix))
    .sort();
}

/** The log lines written since `mark` lines of it were there. */
function logSince(mark: number): string[] {
  return connectionLog().slice(mark);
}

describe('login shells: the shell the host reports, the other shells and the other modes (F-2704)', function () {
  this.timeout(900_000);

  it('F-2704 AC-3 (dash-terminal): a dash host connects and opens a terminal named sh', async () => {
    await freshServer('harness-dash');
    const seen = await withWindow('harness-dash', 'ms-ac3', async () =>
      newTerminalIs('ms-ac3', 'sh'),
    );
    deepStrictEqual(seen, true);
  });

  it('F-2704 AC-26 (shell-line-exec): a bash host whose .bash_profile runs zsh in place has its login shell named /bin/bash (bash) in the log', async () => {
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.bash_profile', 'exec zsh\n');
    const mark = connectionLog().length;
    try {
      await withWindow('harness-bash', 'ms-ac26', () => Promise.resolve());
      deepStrictEqual(
        logSince(mark).filter(line => line.includes('login shell is')),
        ["the host's login shell is /bin/bash (bash)"],
      );
    } finally {
      await removeHomeFiles('harness-bash', '.bash_profile');
    }
  });

  it('F-2704 AC-27 (zsh-last-line): a .bash_profile that ends by running zsh as a child lets the .bashrc and .zshenv exports reach a task, and the .zshrc export not', async () => {
    await freshServer('harness-bash');
    await writeHomeFile(
      'harness-bash',
      '.bash_profile',
      '. "$HOME/.bashrc"\nzsh\n',
    );
    await writeHomeFile('harness-bash', '.bashrc', 'export F2704_BASHRC=1\n');
    await writeHomeFile('harness-bash', '.zshenv', 'export F2704_ZSHENV=1\n');
    await writeHomeFile('harness-bash', '.zshrc', 'export F2704_ZSHRC=1\n');
    try {
      const seen = await withWindow('harness-bash', 'ms-ac27', async () => ({
        exports: marked(
          await taskEnvironment('ms-ac27', 'harness-bash', 'ms-ac27'),
          'F2704_',
        ),
        notices: surfaceLines('ms-ac27', 'notice'),
        dialogs: surfaceLines('ms-ac27', 'failureDialog'),
      }));
      deepStrictEqual(seen, {
        exports: ['F2704_BASHRC', 'F2704_ZSHENV'],
        notices: [],
        dialogs: [],
      });
    } finally {
      await removeHomeFiles(
        'harness-bash',
        '.bash_profile',
        '.bashrc',
        '.zshenv',
        '.zshrc',
      );
    }
  });

  it('F-2704 AC-28 (no-exec-server): with remote.SSH.useExecServer false the exports of the .profile and of the .bashrc above and below its guard reach a task', async () => {
    await setting('remote.SSH.useExecServer', false);
    try {
      await freshServer('harness-bash');
      await writeHomeFile(
        'harness-bash',
        '.profile',
        'export F2704_PROFILE=1\n[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
      );
      await writeHomeFile(
        'harness-bash',
        '.bashrc',
        'export F2704_ABOVE=1\ncase $- in *i*) ;; *) return;; esac\nexport F2704_BELOW=1\n',
      );
      const environment = await withWindow('harness-bash', 'ms-ac28', () =>
        taskEnvironment('ms-ac28', 'harness-bash', 'ms-ac28'),
      );
      deepStrictEqual(marked(environment, 'F2704_'), [
        'F2704_ABOVE',
        'F2704_BELOW',
        'F2704_PROFILE',
      ]);
    } finally {
      await setting('remote.SSH.useExecServer', undefined);
      await removeHomeFiles('harness-bash', '.profile', '.bashrc');
    }
  });

  it('F-2704 AC-29 (pty-allowed): with remote.SSH.permitPtyAllocation true a .bashrc that prints below its guard still connects, and the line is not in the log', async () => {
    await setting('remote.SSH.permitPtyAllocation', true);
    try {
      await freshServer('harness-bash');
      await writeHomeFile(
        'harness-bash',
        '.profile',
        '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n',
      );
      await writeHomeFile(
        'harness-bash',
        '.bashrc',
        'case $- in *i*) ;; *) return;; esac\necho F2704-NOISE-LINE\n',
      );
      const mark = connectionLog().length;
      await withWindow('harness-bash', 'ms-ac29', () => Promise.resolve());
      deepStrictEqual(
        logSince(mark).some(line => line.includes('F2704-NOISE-LINE')),
        false,
      );
    } finally {
      await setting('remote.SSH.permitPtyAllocation', undefined);
      await removeHomeFiles('harness-bash', '.profile', '.bashrc');
    }
  });

  it('F-2704 AC-33 (other-shells): ksh, csh and tcsh hosts connect with the exec server on and off, and the log names the shell', async () => {
    const seen: Array<[string, string]> = [];
    for (const execServer of [true, false]) {
      await setting('remote.SSH.useExecServer', execServer);
      for (const shell of ['ksh', 'csh', 'tcsh']) {
        const user = `harness-${shell}`;
        await freshServer(user);
        const mark = connectionLog().length;
        await withWindow(user, `ms-ac33-${shell}`, () => Promise.resolve());
        seen.push([
          `${shell} ${String(execServer)}`,
          logSince(mark).find(line => line.includes('login shell is')) ?? '',
        ]);
      }
    }
    await setting('remote.SSH.useExecServer', undefined);
    // The host's csh is tcsh (Alpine links one to the other), and tcsh sets $SHELL to itself: its line names tcsh.
    deepStrictEqual(seen, [
      ['ksh true', "the host's login shell is /bin/ksh (ksh)"],
      ['csh true', "the host's login shell is /bin/tcsh (tcsh)"],
      ['tcsh true', "the host's login shell is /bin/tcsh (tcsh)"],
      ['ksh false', "the host's login shell is /bin/ksh (ksh)"],
      ['csh false', "the host's login shell is /bin/tcsh (tcsh)"],
      ['tcsh false', "the host's login shell is /bin/tcsh (tcsh)"],
    ]);
  });

  it('F-2704 AC-15 (fish-per-window): a fish host connects with no local server once the platform is picked, opens a fish terminal, and the config.fish export reaches a task while the .profile export does not', async () => {
    await setting('remote.SSH.useLocalServer', false);
    try {
      await freshServer('harness-fish');
      await writeHomeFile(
        'harness-fish',
        '.config/fish/config.fish',
        'set -gx F2704_FISH 1\n',
      );
      await writeHomeFile(
        'harness-fish',
        '.profile',
        'export F2704_PROFILE=1\n',
      );
      appendScript([
        {
          surface: 'platformPick',
          match: 'platform',
          answer: 'linux',
          window: 'ms-ac15',
        },
      ] satisfies AppendedEntry[]);
      const seen = await withWindow('harness-fish', 'ms-ac15', async () => ({
        task: marked(
          await taskEnvironment('ms-ac15', 'harness-fish', 'ms-ac15'),
          'F2704_',
        ),
        terminal: await newTerminalIs('ms-ac15', 'fish'),
      }));
      deepStrictEqual(seen, {task: ['F2704_FISH'], terminal: true});
    } finally {
      await setting('remote.SSH.useLocalServer', undefined);
      await setting('remote.SSH.remotePlatform', undefined);
      await removeHomeFiles(
        'harness-fish',
        '.config/fish/config.fish',
        '.profile',
      );
    }
  });

  it('F-2704 AC-16 (reused-server): a second window to a running server sees the environment of its start, and a server that was stopped and started again sees the changed startup file', async () => {
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.profile', 'export F2704_VALUE=old\n');
    try {
      await openWindow('harness-bash', 'ms-ac16a');
      await connectedWithin('ms-ac16a', INSTALL_MILLISECONDS);
      await writeHomeFile(
        'harness-bash',
        '.profile',
        'export F2704_VALUE=new\n',
      );
      await openWindow('harness-bash', 'ms-ac16b');
      await connectedWithin('ms-ac16b', INSTALL_MILLISECONDS);
      const second = (
        await taskEnvironment('ms-ac16b', 'harness-bash', 'ms-ac16b')
      ).F2704_VALUE;
      await freshServer('harness-bash');
      const third = await withWindow(
        'harness-bash',
        'ms-ac16c',
        async () =>
          (await taskEnvironment('ms-ac16c', 'harness-bash', 'ms-ac16c'))
            .F2704_VALUE,
      );
      deepStrictEqual([second, third], ['old', 'new']);
    } finally {
      await removeHomeFiles('harness-bash', '.profile');
    }
  });
});
