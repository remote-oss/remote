import {deepStrictEqual, throws} from 'node:assert';
import {runCommand, spawnedCommandOf} from './command-runner.ts';

/** The editor's command-line wrapper on a Windows runner, and the arguments of one install. */
const WINDOWS_CLI = 'D:\\a\\remote\\.vscode-test\\bin\\codium-insiders.cmd';
const INSTALL = [
  '--extensions-dir=C:\\Temp\\run 1\\extensions',
  '--install-extension',
  'C:\\Temp\\run 1\\remote-ssh-0.1.0.vsix',
];

describe('the command runner', () => {
  it('#2350: a Windows batch file runs through cmd.exe, every word quoted, the line passed as it is', () => {
    deepStrictEqual(spawnedCommandOf(WINDOWS_CLI, INSTALL, 'win32'), {
      file: 'cmd.exe',
      fileArguments: [
        '/d',
        '/s',
        '/c',
        '""D:\\a\\remote\\.vscode-test\\bin\\codium-insiders.cmd" "--extensions-dir=C:\\Temp\\run 1\\extensions" "--install-extension" "C:\\Temp\\run 1\\remote-ssh-0.1.0.vsix""',
      ],
      verbatim: true,
    });
  });

  it('#2350: a batch file is known by its extension in any case', () => {
    deepStrictEqual(
      ['C:\\tools\\RUN.BAT', 'C:\\tools\\code.Cmd'].map(
        program => spawnedCommandOf(program, [], 'win32').file,
      ),
      ['cmd.exe', 'cmd.exe'],
    );
  });

  it('#2350: any other program, and any program off Windows, starts as it is', () => {
    deepStrictEqual(
      [
        spawnedCommandOf(
          'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
          ['-V'],
          'win32',
        ),
        spawnedCommandOf('/editor/bin/codium-insiders.cmd', ['-v'], 'linux'),
      ],
      [
        {
          file: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
          fileArguments: ['-V'],
          verbatim: false,
        },
        {
          file: '/editor/bin/codium-insiders.cmd',
          fileArguments: ['-v'],
          verbatim: false,
        },
      ],
    );
  });

  it('#2350: a word that cmd.exe would change is refused, not passed changed', () => {
    throws(() => spawnedCommandOf(WINDOWS_CLI, ['--label=100%'], 'win32'), {
      message: `cmd.exe can't pass --label=100% to ${WINDOWS_CLI} unchanged`,
    });
  });

  it('#2350: a program that does not start gives status 1 and its error', () => {
    deepStrictEqual(runCommand('/nonexistent/program', []), {
      status: 1,
      stdout: '',
      stderr: 'spawnSync /nonexistent/program ENOENT',
    });
  });
});
