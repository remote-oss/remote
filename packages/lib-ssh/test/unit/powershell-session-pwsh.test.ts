import {createHash, randomBytes} from 'node:crypto';
import {type ChildProcessByStdio, spawn, spawnSync} from 'node:child_process';
import type {Readable, Writable} from 'node:stream';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deepStrictEqual} from 'node:assert';
import {
  POWERSHELL_SESSION_LOOP,
  powershellCommandsFor,
  powershellSessionStart,
} from '../../src/connection-server/powershell-session.ts';

/** What the loop printed and how it ended. */
interface SessionEnd {
  lines: string[];
  output: Buffer;
  status: number | null;
}

/** The folder of the loop's file, made once for the rows. */
const loopFolder = {path: ''};

/** A run of `script` with `environment` and `input` as the loop reads it. */
function framed(
  marker: string,
  script: string,
  environment: Record<string, string> = {},
  input: Buffer | null = null,
): string {
  return powershellCommandsFor(marker, {
    script,
    environment,
    inputBase64: input === null ? null : input.toString('base64'),
  });
}

/**
 * What `child` printed and how it ended, once it has read all of `input`: written at once, or `delay` ms after the
 * ready line when a delay is given.
 */
async function ended(
  child: ChildProcessByStdio<Writable, Readable, null>,
  input: string,
  delay?: number,
): Promise<SessionEnd> {
  const chunks: Buffer[] = [];
  let written = false;
  child.stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    if (
      delay !== undefined &&
      !written &&
      Buffer.concat(chunks).includes('LAYER1-READY')
    ) {
      written = true;
      setTimeout(() => {
        child.stdin.end(input);
      }, delay);
    }
  });
  child.stdin.on('error', () => undefined);
  if (delay === undefined) {
    child.stdin.end(input);
  }
  const status = await new Promise<number | null>(resolve => {
    child.once('close', resolve);
  });
  const output = Buffer.concat(chunks);
  return {
    lines: output.toString('utf8').split('\n').filter(Boolean),
    output,
    status,
  };
}

/**
 * Runs the loop's file under `pwsh`, its children `pwsh` too, with `input` on its standard input, written `delay` ms
 * after the ready line when a delay is given.
 */
async function session(input: string, delay?: number): Promise<SessionEnd> {
  const loop = path.join(loopFolder.path, 'loop.ps1');
  return ended(
    spawn(
      'pwsh',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        loop,
        '-ChildProgram',
        'pwsh',
      ],
      {stdio: ['pipe', 'pipe', 'inherit']},
    ),
    input,
    delay,
  );
}

/**
 * Runs the session's own remote program, the one encoded command a Windows host gets, with `powershell` and
 * `powershell.exe` on the path standing for `pwsh`.
 */
async function hostSession(input: string): Promise<SessionEnd> {
  return ended(
    spawn('sh', ['-c', powershellSessionStart().remoteProgram], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        PATH: `${path.join(loopFolder.path, 'bin')}:${process.env.PATH ?? ''}`,
      },
    }),
    input,
  );
}

describe('the PowerShell session loop, run under pwsh (card #1899)', function () {
  this.timeout(120_000);

  before(() => {
    loopFolder.path = mkdtempSync(path.join(tmpdir(), 'powershell-session-'));
    writeFileSync(
      path.join(loopFolder.path, 'loop.ps1'),
      POWERSHELL_SESSION_LOOP,
    );
    const pwsh = spawnSync('sh', ['-c', 'command -v pwsh'], {
      encoding: 'utf8',
    }).stdout.trim();
    mkdirSync(path.join(loopFolder.path, 'bin'));
    for (const name of ['powershell', 'powershell.exe']) {
      symlinkSync(pwsh, path.join(loopFolder.path, 'bin', name));
    }
  });

  after(() => {
    rmSync(loopFolder.path, {recursive: true, force: true});
  });

  it("F-2701 5.0 step 5: three runs on one input print LAYER1-READY first, each run's lines between its markers with its status, and the end of input ends the loop with 0", async () => {
    const binary = randomBytes(70_000);
    const ended = await session(
      [
        framed('m1', 'Write-Output "a=$env:GREETING"', {GREETING: "it's"}),
        framed(
          'm2',
          'function Twice {\n  param($Value)\n  "t:$($Value * 2)"\n}\nTwice 7\nexit 3',
        ),
        framed(
          'm3',
          '$Stream = [Console]::OpenStandardInput(); $Copy = New-Object System.IO.MemoryStream; $Stream.CopyTo($Copy); $Hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($Copy.ToArray()); "sha:" + [BitConverter]::ToString($Hash).Replace("-", "").ToLower()',
          {},
          binary,
        ),
      ].join(''),
    );
    deepStrictEqual(
      [ended.lines, ended.status],
      [
        [
          'LAYER1-READY',
          'm1:start',
          "a=it's",
          'm1:end 0',
          'm2:start',
          't:14',
          'm2:end 3',
          'm3:start',
          `sha:${createHash('sha256').update(binary).digest('hex')}`,
          'm3:end 0',
        ],
        0,
      ],
    );
  });

  it('F-2701 5.0 step 5: a non-ASCII line reaches the session as UTF-8 with no byte-order mark', async () => {
    const ended = await session(framed('m1', 'Write-Output "é"'));
    deepStrictEqual(
      ended.output.includes(Buffer.from('m1:start\né\nm1:end 0\n', 'utf8')),
      true,
    );
  });

  it('F-2701 5.0 step 5: the ready line comes after a line end of its own, so that words a command in front of the session left without one stay on their line', async () => {
    const ended = await session('');
    deepStrictEqual(
      [ended.output.toString('utf8'), ended.status],
      ['\nLAYER1-READY\n', 0],
    );
  });

  it('F-2701 5.0 step 5: a header that does not parse ends the session with status 2', async () => {
    const ended = await session('not a header\n');
    deepStrictEqual([ended.lines, ended.status], [['LAYER1-READY'], 2]);
  });

  it('F-2701 5.0 step 5: a header whose length has more than nine digits ends the session with status 2', async () => {
    const ended = await session('m1 999999999999 0\n');
    deepStrictEqual([ended.lines, ended.status], [['LAYER1-READY'], 2]);
  });

  it('F-2701 5.0 step 5: a run that writes 128 KiB before it reads its 70 000-byte input ends with all its output and its status', async () => {
    const binary = randomBytes(70_000);
    const ended = await session(
      framed(
        'm1',
        '1..2048 | ForEach-Object { "x" * 63 }; $Stream = [Console]::OpenStandardInput(); $Copy = New-Object System.IO.MemoryStream; $Stream.CopyTo($Copy); "read:$($Copy.Length)"; exit 4',
        {},
        binary,
      ),
    );
    deepStrictEqual(
      [
        ended.lines.filter(line => line === 'x'.repeat(63)).length,
        ended.lines.slice(-2),
        ended.status,
      ],
      [2048, ['read:70000', 'm1:end 4'], 0],
    );
  });

  it('F-2701 5.0 step 5: the last words of a run that writes no line end come in front of its end marker', async () => {
    const ended = await session(framed('m1', '[Console]::Out.Write("tail")'));
    deepStrictEqual(ended.lines, ['LAYER1-READY', 'm1:start', 'tailm1:end 0']);
  });

  it('F-2701 5.0 step 5: under PowerShell 7 a run written 200 ms after the ready line is read through the console stream and answered', async () => {
    const ended = await session(framed('m1', 'Write-Output late'), 200);
    deepStrictEqual(
      [ended.lines, ended.status],
      [['LAYER1-READY', 'm1:start', 'late', 'm1:end 0'], 0],
    );
  });

  it("F-2701 5.0 step 5: the session's own remote program, one encoded command, runs a framed run", async () => {
    const ended = await hostSession(
      framed('m1', 'Write-Output "a=$env:GREETING"', {GREETING: 'host'}),
    );
    deepStrictEqual(
      [ended.lines, ended.status],
      [['LAYER1-READY', 'm1:start', 'a=host', 'm1:end 0'], 0],
    );
  });
});
