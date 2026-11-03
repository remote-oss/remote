import {createHash, randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deepStrictEqual} from 'node:assert';
import type {ScriptRequest} from 'lib-host';
import {powershellPlan} from '../../src/index.ts';
import type {PlannedInput} from '../../src/process/remote-program.ts';

const COMMAND_START = 'powershell ';

/** What a PowerShell run printed and how it ended. */
interface Run {
  output: Buffer;
  status: number | null;
}

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, {recursive: true, force: true});
  }
});

function request(
  script: string,
  overrides: Partial<ScriptRequest> = {},
): Pick<ScriptRequest, 'script' | 'environment' | 'input'> {
  return {
    script,
    environment: {},
    input: {kind: 'text', text: ''},
    ...overrides,
  };
}

/** The bytes a planned input puts on the standard input. */
function inputBytes(input: PlannedInput, fileBytes: Buffer): Buffer {
  if (input.kind === 'prefixedFile') {
    return Buffer.concat([Buffer.from(input.prefix, 'utf8'), fileBytes]);
  }
  return Buffer.from(input.kind === 'text' ? input.text : '', 'utf8');
}

/** Runs the plan of a request as the host would, with `pwsh` standing for `powershell`. */
async function runPlanned(
  plannedRequest: Pick<ScriptRequest, 'script' | 'environment' | 'input'>,
  fileBytes: Buffer = Buffer.alloc(0),
): Promise<Run> {
  const plan = powershellPlan(plannedRequest);
  if (plan.kind !== 'planned') {
    throw new Error(plan.reason);
  }
  const words = plan.remoteProgram.slice(COMMAND_START.length).split(' ');
  const child = spawn('pwsh', words, {stdio: ['pipe', 'pipe', 'inherit']});
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stdin.on('error', () => undefined);
  child.stdin.end(inputBytes(plan.input, fileBytes));
  const status = await new Promise<number | null>(resolve => {
    child.once('close', resolve);
  });
  return {output: Buffer.concat(chunks), status};
}

describe('the PowerShell plan, run under pwsh', function () {
  this.timeout(60_000);

  it('F-2701 AC-5: a script prints the value of an environment variable that holds a single quote', async () => {
    const ended = await runPlanned(
      request('Write-Output $env:GREETING', {environment: {GREETING: "it's"}}),
    );
    deepStrictEqual(
      [ended.output.toString('utf8').trim(), ended.status],
      ["it's", 0],
    );
  });

  it('F-2701 AC-5: a script reads every byte of a file that follows the prelude, byte for byte', async () => {
    const bytes = randomBytes(70_000);
    const folder = mkdtempSync(path.join(tmpdir(), 'remote-program-'));
    folders.push(folder);
    const localFile = path.join(folder, 'archive.bin');
    writeFileSync(localFile, bytes);
    const ended = await runPlanned(
      request(
        [
          '$Stream = [Console]::OpenStandardInput()',
          '$Memory = New-Object System.IO.MemoryStream',
          '$Stream.CopyTo($Memory)',
          '$Hash = [System.Security.Cryptography.SHA256]::Create()',
          "[BitConverter]::ToString($Hash.ComputeHash($Memory.ToArray())).Replace('-', '').ToLowerInvariant()",
        ].join('\n'),
        {environment: {NAME: 'x'}, input: {kind: 'file', localFile}},
      ),
      bytes,
    );
    deepStrictEqual(
      ended.output.toString('utf8').trim(),
      createHash('sha256').update(bytes).digest('hex'),
    );
  });

  it('F-2701 AC-5: a script reads the text that follows the prelude', async () => {
    const ended = await runPlanned(
      request('[Console]::In.ReadToEnd()', {
        input: {kind: 'text', text: 'after the prelude'},
      }),
    );
    deepStrictEqual(ended.output.toString('utf8').trim(), 'after the prelude');
  });

  it("F-2701 AC-5: a script's exit status is the process's", async () => {
    const ended = await runPlanned(request('exit 3'));
    deepStrictEqual(ended.status, 3);
  });

  it('F-2701 AC-5: a script that writes a non-ASCII letter gives its UTF-8 bytes, with no byte-order mark', async () => {
    const ended = await runPlanned(request('[Console]::Out.Write([char]0xE9)'));
    deepStrictEqual(ended.output.toString('hex'), 'c3a9');
  });

  it('F-2701 AC-5: a script that defines a function over several lines runs', async () => {
    const ended = await runPlanned(
      request(
        [
          'function Add-Two {',
          '  param($Value)',
          '  $Value + 2',
          '}',
          'Add-Two 40',
        ].join('\n'),
      ),
    );
    deepStrictEqual(ended.output.toString('utf8').trim(), '42');
  });
});
