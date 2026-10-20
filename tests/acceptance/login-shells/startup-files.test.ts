import {deepStrictEqual} from 'node:assert';
import {
  inWindow,
  terminalBuffer,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  newTerminalIs,
  removeHomeFiles,
  freshServer,
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

describe.skip('login shells and their startup files: which files the connect reads (F-2704)', function () {
  this.timeout(900_000);

  it('F-2704 AC-1 (bash-default): a bash host in the default mode connects with no notice and no dialog', async () => {
    await freshServer('harness-bash');
    const state = await withWindow('harness-bash', 'sf-ac1', async () => ({
      remoteName: (await windowState('sf-ac1')).remoteName,
      notices: surfaceLines('sf-ac1', 'notice'),
      dialogs: surfaceLines('sf-ac1', 'failureDialog'),
    }));
    deepStrictEqual(state, {
      remoteName: 'ssh-remote',
      notices: [],
      dialogs: [],
    });
  });

  it('F-2704 AC-2 (zsh-terminal): a zsh host without a startup file, and with an empty .zshrc, connects and opens a zsh terminal that does not run the new-user setup', async () => {
    const seen: Array<[boolean, boolean]> = [];
    for (const runCommands of [undefined, '# mine\n']) {
      await freshServer('harness-zsh');
      if (runCommands !== undefined) {
        await writeHomeFile('harness-zsh', '.zshrc', runCommands);
      }
      try {
        await withWindow('harness-zsh', 'sf-ac2', async () => {
          const named = await newTerminalIs('sf-ac2', 'zsh');
          await new Promise(resolve => setTimeout(resolve, 3000));
          seen.push([
            named,
            (await terminalBuffer('sf-ac2')).includes('zsh-newuser-install'),
          ]);
        });
      } finally {
        await removeHomeFiles('harness-zsh', '.zshrc');
      }
    }
    deepStrictEqual(seen, [
      [true, false],
      [true, false],
    ]);
  });

  it('F-2704 AC-4 (bash-files): the .profile and the .bashrc above and below its non-interactive guard each export a variable, and all three reach a task', async () => {
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
    try {
      const environment = await withWindow('harness-bash', 'sf-ac4', () =>
        taskEnvironment('sf-ac4', 'harness-bash', 'sf-ac4'),
      );
      deepStrictEqual(marked(environment, 'F2704_'), [
        'F2704_ABOVE',
        'F2704_BELOW',
        'F2704_PROFILE',
      ]);
    } finally {
      await removeHomeFiles('harness-bash', '.profile', '.bashrc');
    }
  });

  it('F-2704 AC-5 (zsh-files): the .zshenv, .zprofile and .zshrc exports reach a task and a terminal, and a .profile export does not', async () => {
    await freshServer('harness-zsh');
    await writeHomeFile('harness-zsh', '.zshenv', 'export F2704_ZSHENV=1\n');
    await writeHomeFile(
      'harness-zsh',
      '.zprofile',
      'export F2704_ZPROFILE=1\n',
    );
    await writeHomeFile('harness-zsh', '.zshrc', 'export F2704_ZSHRC=1\n');
    await writeHomeFile('harness-zsh', '.profile', 'export F2704_PROFILE=1\n');
    try {
      const seen = await withWindow('harness-zsh', 'sf-ac5', async () => {
        const environment = await taskEnvironment(
          'sf-ac5',
          'harness-zsh',
          'sf-ac5',
        );
        await newTerminalIs('sf-ac5', 'zsh');
        await inWindow('sf-ac5', 'workbench.action.terminal.sendSequence', {
          text: 'echo "z:$F2704_ZSHENV$F2704_ZPROFILE$F2704_ZSHRC$F2704_PROFILE"\n',
        });
        await waitFor(
          'the terminal to print the variables',
          async () => (await terminalBuffer('sf-ac5')).includes('z:'),
          30_000,
        );
        return {
          task: marked(environment, 'F2704_'),
          terminal: (await terminalBuffer('sf-ac5'))
            .split('\n')
            .includes('z:111'),
        };
      });
      deepStrictEqual(seen, {
        task: ['F2704_ZPROFILE', 'F2704_ZSHENV', 'F2704_ZSHRC'],
        terminal: true,
      });
    } finally {
      await removeHomeFiles(
        'harness-zsh',
        '.zshenv',
        '.zprofile',
        '.zshrc',
        '.profile',
      );
    }
  });

  it('F-2704 AC-6 (dash-files): the .profile export and the export of the file ENV names reach a task', async () => {
    await freshServer('harness-dash');
    await writeHomeFile(
      'harness-dash',
      '.profile',
      'export F2704_PROFILE=1\nENV=$HOME/.envfile\nexport ENV\n',
    );
    await writeHomeFile('harness-dash', '.envfile', 'export F2704_ENV=1\n');
    try {
      const environment = await withWindow('harness-dash', 'sf-ac6', () =>
        taskEnvironment('sf-ac6', 'harness-dash', 'sf-ac6'),
      );
      deepStrictEqual(marked(environment, 'F2704_'), [
        'F2704_ENV',
        'F2704_PROFILE',
      ]);
    } finally {
      await removeHomeFiles('harness-dash', '.profile', '.envfile');
    }
  });

  it('F-2704 AC-7 (noisy-startup): startup files that print 200 lines to stdout and one to stderr still connect, with no notice and no dialog', async () => {
    await freshServer('harness-bash');
    await writeHomeFile(
      'harness-bash',
      '.profile',
      'i=0\nwhile [ $i -lt 200 ]; do echo "noise $i"; i=$((i+1)); done\necho "to stderr" >&2\n',
    );
    try {
      const seen = await withWindow('harness-bash', 'sf-ac7', async () => ({
        remoteName: (await windowState('sf-ac7')).remoteName,
        notices: surfaceLines('sf-ac7', 'notice'),
        dialogs: surfaceLines('sf-ac7', 'failureDialog'),
      }));
      deepStrictEqual(seen, {
        remoteName: 'ssh-remote',
        notices: [],
        dialogs: [],
      });
    } finally {
      await removeHomeFiles('harness-bash', '.profile');
    }
  });

  it('F-2704 AC-8 (shell-from-profile): a bash host whose .profile sets SHELL to zsh opens a zsh terminal, and the .zshrc export reaches a task', async () => {
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.profile', 'export SHELL=/bin/zsh\n');
    await writeHomeFile('harness-bash', '.zshrc', 'export F2704_ZSHRC=1\n');
    try {
      const seen = await withWindow('harness-bash', 'sf-ac8', async () => {
        const environment = await taskEnvironment(
          'sf-ac8',
          'harness-bash',
          'sf-ac8',
        );
        return {
          task: marked(environment, 'F2704_'),
          terminal: await newTerminalIs('sf-ac8', 'zsh'),
        };
      });
      deepStrictEqual(seen, {task: ['F2704_ZSHRC'], terminal: true});
    } finally {
      await removeHomeFiles('harness-bash', '.profile', '.zshrc');
    }
  });

  it('F-2704 AC-9 (exec-into-zsh): a .bash_profile that ends by running zsh in place connects with no notice, the .profile export reaches a task, and the .bashrc and .zshrc exports do not', async () => {
    await freshServer('harness-bash');
    await writeHomeFile(
      'harness-bash',
      '.bash_profile',
      '. "$HOME/.profile"\nexec zsh\n',
    );
    await writeHomeFile('harness-bash', '.profile', 'export F2704_PROFILE=1\n');
    await writeHomeFile('harness-bash', '.bashrc', 'export F2704_BASHRC=1\n');
    await writeHomeFile('harness-bash', '.zshrc', 'export F2704_ZSHRC=1\n');
    try {
      const seen = await withWindow('harness-bash', 'sf-ac9', async () => {
        const environment = await taskEnvironment(
          'sf-ac9',
          'harness-bash',
          'sf-ac9',
        );
        return {
          task: marked(environment, 'F2704_'),
          notices: surfaceLines('sf-ac9', 'notice'),
          dialogs: surfaceLines('sf-ac9', 'failureDialog'),
        };
      });
      deepStrictEqual(seen, {
        task: ['F2704_PROFILE'],
        notices: [],
        dialogs: [],
      });
    } finally {
      await removeHomeFiles(
        'harness-bash',
        '.bash_profile',
        '.profile',
        '.bashrc',
        '.zshrc',
      );
    }
  });
});
