import {deepStrictEqual} from 'node:assert';
import {
  isProbeAnswer,
  isProbeExecLine,
  platformProbeInput,
  PlatformProbeReader,
  probeHandOverLine,
} from '../../src/connection-server/platform-probe.ts';

/** The connection's nonce in the rows: hex, as the helper draws it. */
const NONCE = '0f1e2d3c';

/** What the reader gives for each line of `output`, split as the session's line splitter splits it, at `\n`. */
function answers(output: string): unknown[] {
  const reader = new PlatformProbeReader(NONCE);
  return output
    .split('\n')
    .map(line => reader.hear(line))
    .filter(found => found !== undefined);
}

/** cmd as OpenSSH for Windows' DefaultShell, as measured on windows-2025: our input echoed after its prompt, LF kept. */
const CMD_OUTPUT =
  'Microsoft Windows [Version 10.0.26100.33674]\r\n(c) Microsoft Corporation. All rights reserved.\r\n\r\n' +
  `runneradmin@host C:\\Users\\runneradmin>echo REMOTE-OSS-PROBE-${NONCE}-%OS%\n` +
  `REMOTE-OSS-PROBE-${NONCE}-Windows_NT\r\n\r\n` +
  `runneradmin@host C:\\Users\\runneradmin>echo REMOTE-OSS-HOME-${NONCE}-$HOME\n` +
  `REMOTE-OSS-HOME-${NONCE}-$HOME\r\n\r\n` +
  `runneradmin@host C:\\Users\\runneradmin>echo REMOTE-OSS-PROBE-${NONCE}-DONE\n` +
  `REMOTE-OSS-PROBE-${NONCE}-DONE\r\n\r\n` +
  'runneradmin@host C:\\Users\\runneradmin>';

/** Windows PowerShell 5.1 as the DefaultShell, as measured on windows-2025. */
const POWERSHELL_OUTPUT =
  'Windows PowerShell\r\nCopyright (C) Microsoft Corporation. All rights reserved.\r\n\r\n' +
  `PS C:\\Users\\runneradmin> echo REMOTE-OSS-PROBE-${NONCE}-%OS%\n` +
  `REMOTE-OSS-PROBE-${NONCE}-%OS%\r\n` +
  `PS C:\\Users\\runneradmin> echo REMOTE-OSS-HOME-${NONCE}-$HOME\n` +
  `REMOTE-OSS-HOME-${NONCE}-C:\\Users\\runneradmin\r\n` +
  `PS C:\\Users\\runneradmin> echo REMOTE-OSS-PROBE-${NONCE}-DONE\n` +
  `REMOTE-OSS-PROBE-${NONCE}-DONE\r\n` +
  'PS C:\\Users\\runneradmin> ';

/** PowerShell 7 as the DefaultShell, as measured on windows-2025. */
const PWSH_OUTPUT =
  'PowerShell 7.6.9\r\n' +
  `PS C:\\Users\\runneradmin> echo REMOTE-OSS-PROBE-${NONCE}-%OS%\n` +
  `REMOTE-OSS-PROBE-${NONCE}-%OS%\r\n` +
  `PS C:\\Users\\runneradmin> echo REMOTE-OSS-HOME-${NONCE}-$HOME\n` +
  `REMOTE-OSS-HOME-${NONCE}-C:\\Users\\runneradmin\r\n` +
  `PS C:\\Users\\runneradmin> echo REMOTE-OSS-PROBE-${NONCE}-DONE\n` +
  `REMOTE-OSS-PROBE-${NONCE}-DONE\r\n` +
  'PS C:\\Users\\runneradmin> ';

/** A POSIX login shell (sh, bash, dash, mksh, zsh, tcsh, fish): nothing expands `%OS%`, `$HOME` is a path. */
const POSIX_OUTPUT = `REMOTE-OSS-PROBE-${NONCE}-%OS%\nREMOTE-OSS-HOME-${NONCE}-/home/harness\nREMOTE-OSS-PROBE-${NONCE}-DONE\n`;

/** pwsh 7 as the login shell of a Linux host: each command echoed after its prompt, each output line after a terminal code. */
const LINUX_PWSH_OUTPUT =
  `PS /home/harness> echo REMOTE-OSS-PROBE-${NONCE}-%OS%\n` +
  `\u001b[?1lREMOTE-OSS-PROBE-${NONCE}-%OS%\n` +
  `PS /home/harness> echo REMOTE-OSS-HOME-${NONCE}-$HOME\n` +
  `\u001b[?1lREMOTE-OSS-HOME-${NONCE}-/home/harness\n` +
  `PS /home/harness> echo REMOTE-OSS-PROBE-${NONCE}-DONE\n` +
  `\u001b[?1lREMOTE-OSS-PROBE-${NONCE}-DONE\n`;

describe('the platform probe of a session whose host platform is unknown (card server-27, #1835)', () => {
  it("#1835: the probe is four echo lines carrying the connection's nonce: a start that answers nothing, the OS name for cmd, the home for PowerShell, and the end", () => {
    deepStrictEqual(platformProbeInput(NONCE).split('\n'), [
      `echo REMOTE-OSS-PROBE-${NONCE}-START`,
      `echo REMOTE-OSS-PROBE-${NONCE}-%OS%`,
      `echo REMOTE-OSS-HOME-${NONCE}-$HOME`,
      `echo REMOTE-OSS-PROBE-${NONCE}-DONE`,
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
        `C:\\>echo REMOTE-OSS-PROBE-${NONCE}-Windows_NT\n` +
          `banner REMOTE-OSS-PROBE-${NONCE}-Windows_NT\n` +
          `REMOTE-OSS-HOME-${NONCE}-$HOME\n` +
          `REMOTE-OSS-HOME-${NONCE}-C:/Users/x\n` +
          `REMOTE-OSS-HOME-${NONCE}-\n` +
          `REMOTE-OSS-PROBE-${NONCE}-DONE\n`,
      ),
      ['posix'],
    );
  });

  it('#1835: nothing is read before the end line, however many Windows answers come first', () => {
    deepStrictEqual(
      answers(
        `REMOTE-OSS-PROBE-${NONCE}-Windows_NT\r\nREMOTE-OSS-HOME-${NONCE}-D:\\home\r\n`,
      ),
      [],
    );
  });

  it('#1835: the hand-over line counts whole, after a CRLF end or a terminal code, and not inside another line', () => {
    deepStrictEqual(
      [
        `REMOTE-OSS-PROBE-${NONCE}-EXEC`,
        `REMOTE-OSS-PROBE-${NONCE}-EXEC\r`,
        `\u001b[?1lREMOTE-OSS-PROBE-${NONCE}-EXEC`,
        `echo REMOTE-OSS-PROBE-${NONCE}-EXEC; exec sh`,
        `REMOTE-OSS-PROBE-${NONCE}-DONE`,
      ].map(line => isProbeExecLine(line, NONCE)),
      [true, true, true, false, false],
    );
  });

  it("#1835: the hand-over line a POSIX shell reads prints this connection's hand-over and gives the session to the reader", () => {
    deepStrictEqual(
      probeHandOverLine(NONCE, "sh -c 'reader'"),
      `echo REMOTE-OSS-PROBE-${NONCE}-EXEC; exec sh -c 'reader'\n`,
    );
  });

  it('#1835: lines a startup file or a message of the day could print, with no nonce or another one, never count', () => {
    deepStrictEqual(
      [
        answers(
          'REMOTE-OSS-PROBE-Windows_NT\nREMOTE-OSS-HOME-C:\\Users\\x\nREMOTE-OSS-PROBE-DONE\n' +
            'REMOTE-OSS-PROBE-ffff-Windows_NT\nREMOTE-OSS-PROBE-ffff-DONE\n',
        ),
        isProbeExecLine('REMOTE-OSS-PROBE-EXEC', NONCE),
        isProbeExecLine('REMOTE-OSS-PROBE-ffff-EXEC', NONCE),
      ],
      [[], false, false],
    );
  });

  it("#1835: a whole line of this connection's nonce is an answer, and neither the echo of the input nor another nonce's line is", () => {
    deepStrictEqual(
      [
        `REMOTE-OSS-PROBE-${NONCE}-%OS%`,
        `\u001b[?1lREMOTE-OSS-HOME-${NONCE}-/home/h\r`,
        `C:\\>echo REMOTE-OSS-PROBE-${NONCE}-%OS%`,
        'REMOTE-OSS-PROBE-ffff-DONE',
        'out-marker',
      ].map(line => isProbeAnswer(line, NONCE)),
      [true, true, false, false, false],
    );
  });
});
