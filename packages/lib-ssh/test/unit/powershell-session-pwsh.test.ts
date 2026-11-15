import {createHash, randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deepStrictEqual} from 'node:assert';
import {
  POWERSHELL_SESSION_LOOP,
  powershellCommandsFor,
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

/** Runs the loop under `pwsh`, its children `pwsh` too, with `input` on its standard input. */
async function session(input: string): Promise<SessionEnd> {
  const loop = path.join(loopFolder.path, 'loop.ps1');
  const child = spawn(
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
  );
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stdin.on('error', () => undefined);
  child.stdin.end(input);
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

describe('the PowerShell session loop, run under pwsh (card #1899)', function () {
  this.timeout(120_000);

  before(() => {
    loopFolder.path = mkdtempSync(path.join(tmpdir(), 'powershell-session-'));
    writeFileSync(
      path.join(loopFolder.path, 'loop.ps1'),
      POWERSHELL_SESSION_LOOP,
    );
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

  it('F-2701 5.0 step 5: a header that does not parse ends the session with status 2', async () => {
    const ended = await session('not a header\n');
    deepStrictEqual([ended.lines, ended.status], [['LAYER1-READY'], 2]);
  });
});
