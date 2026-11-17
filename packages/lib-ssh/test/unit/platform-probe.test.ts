import {deepStrictEqual} from 'node:assert';
import {
  isProbeExecLine,
  PLATFORM_PROBE_INPUT,
  PlatformProbeReader,
} from '../../src/connection-server/platform-probe.ts';

/** What the reader gives for each line of `output`, split as the session's line splitter splits it, at `\n`. */
function answers(output: string): unknown[] {
  const reader = new PlatformProbeReader();
  return output
    .split('\n')
    .map(line => reader.hear(line))
    .filter(found => found !== undefined);
}

/** cmd as OpenSSH for Windows' DefaultShell, as measured on windows-2025: our input echoed after its prompt, LF kept. */
const CMD_OUTPUT =
  'Microsoft Windows [Version 10.0.26100.33674]\r\n(c) Microsoft Corporation. All rights reserved.\r\n\r\n' +
  'runneradmin@host C:\\Users\\runneradmin>echo REMOTE-OSS-PROBE-%OS%\n' +
  'REMOTE-OSS-PROBE-Windows_NT\r\n\r\n' +
  'runneradmin@host C:\\Users\\runneradmin>echo REMOTE-OSS-HOME-$HOME\n' +
  'REMOTE-OSS-HOME-$HOME\r\n\r\n' +
  'runneradmin@host C:\\Users\\runneradmin>echo REMOTE-OSS-PROBE-DONE\n' +
  'REMOTE-OSS-PROBE-DONE\r\n\r\n' +
  'runneradmin@host C:\\Users\\runneradmin>';

/** Windows PowerShell 5.1 as the DefaultShell, as measured on windows-2025. */
const POWERSHELL_OUTPUT =
  'Windows PowerShell\r\nCopyright (C) Microsoft Corporation. All rights reserved.\r\n\r\n' +
  'PS C:\\Users\\runneradmin> echo REMOTE-OSS-PROBE-%OS%\n' +
  'REMOTE-OSS-PROBE-%OS%\r\n' +
  'PS C:\\Users\\runneradmin> echo REMOTE-OSS-HOME-$HOME\n' +
  'REMOTE-OSS-HOME-C:\\Users\\runneradmin\r\n' +
  'PS C:\\Users\\runneradmin> echo REMOTE-OSS-PROBE-DONE\n' +
  'REMOTE-OSS-PROBE-DONE\r\n' +
  'PS C:\\Users\\runneradmin> ';

/** PowerShell 7 as the DefaultShell, as measured on windows-2025. */
const PWSH_OUTPUT =
  'PowerShell 7.6.9\r\n' +
  'PS C:\\Users\\runneradmin> echo REMOTE-OSS-PROBE-%OS%\n' +
  'REMOTE-OSS-PROBE-%OS%\r\n' +
  'PS C:\\Users\\runneradmin> echo REMOTE-OSS-HOME-$HOME\n' +
  'REMOTE-OSS-HOME-C:\\Users\\runneradmin\r\n' +
  'PS C:\\Users\\runneradmin> echo REMOTE-OSS-PROBE-DONE\n' +
  'REMOTE-OSS-PROBE-DONE\r\n' +
  'PS C:\\Users\\runneradmin> ';

/** A POSIX login shell (sh, bash, dash, mksh, zsh, tcsh, fish): nothing expands `%OS%`, `$HOME` is a path. */
const POSIX_OUTPUT =
  'REMOTE-OSS-PROBE-%OS%\nREMOTE-OSS-HOME-/home/harness\nREMOTE-OSS-PROBE-DONE\n';

/** pwsh 7 as the login shell of a Linux host: each command echoed after its prompt, each output line after a terminal code. */
const LINUX_PWSH_OUTPUT =
  'PS /home/harness> echo REMOTE-OSS-PROBE-%OS%\n' +
  '\u001b[?1lREMOTE-OSS-PROBE-%OS%\n' +
  'PS /home/harness> echo REMOTE-OSS-HOME-$HOME\n' +
  '\u001b[?1lREMOTE-OSS-HOME-/home/harness\n' +
  'PS /home/harness> echo REMOTE-OSS-PROBE-DONE\n' +
  '\u001b[?1lREMOTE-OSS-PROBE-DONE\n';

describe('the platform probe of a session whose host platform is unknown (card server-27, #1835)', () => {
  it('#1835: the probe is three echo lines: the OS name for cmd, the home for PowerShell, and the end', () => {
    deepStrictEqual(PLATFORM_PROBE_INPUT.split('\n'), [
      'echo REMOTE-OSS-PROBE-%OS%',
      'echo REMOTE-OSS-HOME-$HOME',
      'echo REMOTE-OSS-PROBE-DONE',
      '',
    ]);
  });

  it('#1835: cmd, Windows PowerShell 5.1 and PowerShell 7 on Windows each read as windows, once, at the end line', () => {
    deepStrictEqual([CMD_OUTPUT, POWERSHELL_OUTPUT, PWSH_OUTPUT].map(answers), [
      ['windows'],
      ['windows'],
      ['windows'],
    ]);
  });

  it('#1835: a POSIX login shell and pwsh as a Linux login shell read as posix, once, at the end line', () => {
    deepStrictEqual([POSIX_OUTPUT, LINUX_PWSH_OUTPUT].map(answers), [
      ['posix'],
      ['posix'],
    ]);
  });

  it('#1835: the echo of our input, a banner holding a marker inside a line, and a home that is no drive path never read as windows', () => {
    deepStrictEqual(
      answers(
        'C:\\>echo REMOTE-OSS-PROBE-Windows_NT\n' +
          'banner REMOTE-OSS-PROBE-Windows_NT\n' +
          'REMOTE-OSS-HOME-$HOME\n' +
          'REMOTE-OSS-HOME-C:/Users/x\n' +
          'REMOTE-OSS-HOME-\n' +
          'REMOTE-OSS-PROBE-DONE\n',
      ),
      ['posix'],
    );
  });

  it('#1835: nothing is read before the end line, however many Windows answers come first', () => {
    deepStrictEqual(
      answers('REMOTE-OSS-PROBE-Windows_NT\r\nREMOTE-OSS-HOME-D:\\home\r\n'),
      [],
    );
  });

  it('#1835: the hand-over line counts whole, after a CRLF end or a terminal code, and not inside another line', () => {
    deepStrictEqual(
      [
        'REMOTE-OSS-PROBE-EXEC',
        'REMOTE-OSS-PROBE-EXEC\r',
        '\u001b[?1lREMOTE-OSS-PROBE-EXEC',
        'echo REMOTE-OSS-PROBE-EXEC; exec sh',
        'REMOTE-OSS-PROBE-DONE',
      ].map(isProbeExecLine),
      [true, true, true, false, false],
    );
  });
});
