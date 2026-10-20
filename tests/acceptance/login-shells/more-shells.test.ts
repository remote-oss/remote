import {deepStrictEqual} from 'node:assert';
import {connectionLog} from '../windows/harness.ts';
import {setting} from '../windows/maintenance.ts';
import {
  freshServer,
  newTerminalIs,
  removeHomeFiles,
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
      const environment = await withWindow('harness-bash', 'ms-ac27', () =>
        taskEnvironment('ms-ac27', 'harness-bash', 'ms-ac27'),
      );
      deepStrictEqual(marked(environment, 'F2704_'), [
        'F2704_BASHRC',
        'F2704_ZSHENV',
      ]);
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
});
