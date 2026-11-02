import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  inWindow,
  onHostAs,
  openWindow,
  reloadWindow,
  terminalNames,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  freshServer,
  removeHomeFiles,
  takeEnvironment,
  taskEnvironment,
  writeHomeFile,
} from './shell-support.ts';

/** The account the rows connect as: its login shell is bash, and node is on its PATH. */
const USER = 'harness-bash';

/** Opens window `name` on the account, with its folder in the account's home, and waits until it is connected. */
async function openAccountWindow(name: string): Promise<void> {
  await openWindow(USER, name, USER);
  await connectedWithin(name, INSTALL_MILLISECONDS, USER);
}

/** Whether `file` exists on the host, as the account. */
async function exists(file: string): Promise<boolean> {
  return onHostAs(USER, 'test', '-e', file).then(
    () => true,
    () => false,
  );
}

/** The environment a new terminal of `window` has: the shell writes it to a file, so that no line of a terminal is read. */
async function terminalEnvironment(
  window: string,
  label: string,
): Promise<Record<string, string>> {
  const file = `/tmp/${label}-terminal-env`;
  const before = (await terminalNames(window)).length;
  await inWindow(window, 'workbench.action.terminal.new');
  await waitFor(
    `a new terminal in ${window}`,
    async () => (await terminalNames(window)).length > before,
    30_000,
  );
  await inWindow(window, 'workbench.action.terminal.sendSequence', {
    text: `env > ${file}\n`,
  });
  await waitFor(`${file} to be written`, () => exists(file), 30_000);
  return takeEnvironment(USER, file);
}

/** The environment a debuggee started by `window` has: the program writes it to a file. */
async function debuggeeEnvironment(
  window: string,
  label: string,
): Promise<Record<string, string>> {
  const file = `/tmp/${label}-debuggee-env`;
  await writeHomeFile(
    USER,
    `${window}/app.js`,
    `require('fs').writeFileSync('${file}', Object.entries(process.env).map(([name, value]) => name + '=' + value).join('\\n'));\n`,
  );
  await writeHomeFile(
    USER,
    `${window}/.vscode/launch.json`,
    JSON.stringify({
      version: '0.2.0',
      configurations: [
        {
          type: 'node',
          request: 'launch',
          name: 'Run app',
          program: '${workspaceFolder}/app.js',
        },
      ],
    }),
  );
  await inWindow(window, 'workbench.action.debug.start');
  await waitFor(`${file} to be written`, () => exists(file), 60_000);
  return takeEnvironment(USER, file);
}

describe('the environment of an account whose login shell is bash (card connect-125, #1600)', function () {
  this.timeout(600_000);

  after(async () => {
    await removeHomeFiles(USER, '.profile', '.bashrc', 'f2508-injection');
  });

  it('F-2508 AC-7 (c125-injection): the documented VSCODE_INJECTION condition of ~/.bashrc matches while a VS Code terminal starts', async () => {
    await freshServer(USER);
    await removeHomeFiles(USER, '.bash_profile', '.bash_login', '.profile');
    await writeHomeFile(
      USER,
      '.bashrc',
      'if [[ "$VSCODE_INJECTION" == "1" ]]; then echo matched > "$HOME/f2508-injection"; fi\n',
    );
    await openAccountWindow('c125-injection');
    try {
      await inWindow('c125-injection', 'workbench.action.terminal.new');
      await waitFor(
        'the condition to match',
        () => exists(`/home/${USER}/f2508-injection`),
        30_000,
      );
      deepStrictEqual(
        (await onHostAs(USER, 'cat', `/home/${USER}/f2508-injection`)).trim(),
        'matched',
      );
    } finally {
      await closeWindow('c125-injection').catch(() => undefined);
    }
  });

  describe('a value exported in ~/.profile', () => {
    before(async () => {
      await freshServer(USER);
      await removeHomeFiles(USER, '.bash_profile', '.bash_login');
      await writeHomeFile(USER, '.profile', 'export F2508_PROFILE=one\n');
      await writeHomeFile(USER, '.bashrc', 'export F2508_RC=one\n');
      await openAccountWindow('c125-profile');
    });

    it('F-2508 AC-2 (c125-profile): a terminal, a shell task and a debuggee see a variable exported only in ~/.profile before the server starts', async () => {
      const terminal = await terminalEnvironment('c125-profile', 'ac2');
      const task = await taskEnvironment('c125-profile', USER, 'ac2');
      const debuggee = await debuggeeEnvironment('c125-profile', 'ac2');
      deepStrictEqual(
        [terminal.F2508_PROFILE, task.F2508_PROFILE, debuggee.F2508_PROFILE],
        ['one', 'one', 'one'],
      );
    });

    it('F-2508 AC-18 (c125-profile-changed): after ~/.profile changes on the host a new terminal and a reload still see the old login value, and a ~/.bashrc change is seen', async () => {
      await writeHomeFile(USER, '.profile', 'export F2508_PROFILE=two\n');
      await writeHomeFile(USER, '.bashrc', 'export F2508_RC=two\n');
      const fresh = await terminalEnvironment('c125-profile', 'ac18a');
      await reloadWindow('c125-profile');
      await connectedWithin('c125-profile', INSTALL_MILLISECONDS, USER);
      const reloaded = await terminalEnvironment('c125-profile', 'ac18b');
      deepStrictEqual(
        [
          fresh.F2508_PROFILE,
          fresh.F2508_RC,
          reloaded.F2508_PROFILE,
          reloaded.F2508_RC,
        ],
        ['one', 'two', 'one', 'two'],
      );
    });

    it('F-2508 AC-37 (c125-profile-restart): after every server process of the host has ended, a window that connects again has the new ~/.profile value in a new terminal', async () => {
      await closeWindow('c125-profile');
      await freshServer(USER);
      await openAccountWindow('c125-profile-restart');
      try {
        const terminal = await terminalEnvironment(
          'c125-profile-restart',
          'ac37',
        );
        deepStrictEqual(terminal.F2508_PROFILE, 'two');
      } finally {
        await closeWindow('c125-profile-restart').catch(() => undefined);
      }
    });

    after(async () => {
      await closeWindow('c125-profile').catch(() => undefined);
    });
  });
});
