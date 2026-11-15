import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  POWERSHELL_SESSION_LOOP,
  interpreterOfPlatform,
  powershellCommandsFor,
  powershellSessionStart,
} from '../../src/connection-server/powershell-session.ts';
import {
  POWERSHELL_COMMAND_LIMIT,
  powershellPrelude,
} from '../../src/process/remote-program.ts';

const GOLDEN_LOOP = path.join(
  import.meta.dirname,
  'golden',
  'powershell',
  'session-loop.ps1',
);

const COMMAND_START =
  'powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand ';

const PLAIN_RUN = {
  script: 'Write-Output hi',
  environment: {},
  inputBase64: null,
  deadlineMilliseconds: 1000,
};

describe('the PowerShell session loop (card #1899)', () => {
  it('F-2701 5.0 step 5: the loop is the golden text that the PowerShell 5.1 check reads', () => {
    deepStrictEqual(POWERSHELL_SESSION_LOOP, readFileSync(GOLDEN_LOOP, 'utf8'));
  });

  it('F-2701 5.0 step 5 (reading-1835-loop-length): the session runs the loop as one encoded command under 8192 characters, with an empty prelude', () => {
    const start = powershellSessionStart();
    const encoded = start.remoteProgram.slice(COMMAND_START.length);
    deepStrictEqual(
      [
        start.remoteProgram.startsWith(COMMAND_START),
        /^[A-Za-z0-9+/=]+$/.test(encoded),
        Buffer.from(encoded, 'base64').toString('utf16le'),
        start.prelude,
        start.remoteProgram.length <= POWERSHELL_COMMAND_LIMIT,
      ],
      [true, true, POWERSHELL_SESSION_LOOP, '', true],
    );
  });

  it('F-2701 5.0 step 5: a run without input is its header and its prelude, with no base64', () => {
    const prelude = powershellPrelude({}, PLAIN_RUN.script);
    deepStrictEqual(
      powershellCommandsFor('m1', PLAIN_RUN),
      `m1 ${String(Buffer.byteLength(prelude, 'utf8'))} 0\n${prelude}`,
    );
  });

  it("F-2701 5.0 step 5: a run's environment value with ' is doubled in its prelude, and its input follows as base64", () => {
    const commands = powershellCommandsFor('m2', {
      ...PLAIN_RUN,
      environment: {GREETING: "it's é"},
      inputBase64: 'aGk=',
    });
    const prelude = `$env:GREETING = 'it''s é'\n${PLAIN_RUN.script}\n`;
    deepStrictEqual(
      commands,
      `m2 ${String(Buffer.byteLength(prelude, 'utf8'))} 4\n${prelude}aGk=`,
    );
  });

  it('F-2701 5.0 step 5: a Windows host runs PowerShell scripts, and every other platform POSIX ones', () => {
    deepStrictEqual(
      (['windows', 'linux', 'macOS', 'unknown'] as const).map(
        interpreterOfPlatform,
      ),
      ['powershell', 'posixShell', 'posixShell', 'posixShell'],
    );
  });
});
