import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {ScriptRequest} from 'lib-host';
import {POWERSHELL_COMMAND_LIMIT, powershellPlan} from '../../src/index.ts';
import {
  planScript,
  powershellReader,
} from '../../src/process/remote-program.ts';

const GOLDEN_READER = path.join(
  import.meta.dirname,
  'golden',
  'powershell',
  'reader.ps1',
);

const COMMAND_START =
  'powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand ';

function request(
  overrides: Partial<ScriptRequest> = {},
): Pick<ScriptRequest, 'script' | 'environment' | 'input'> {
  return {
    script: 'Write-Output hi',
    environment: {},
    input: {kind: 'text', text: ''},
    ...overrides,
  };
}

/** The program and input of a plan that was made, or its refusal. */
function plannedOf(plan: ReturnType<typeof powershellPlan>) {
  if (plan.kind !== 'planned') {
    throw new Error(plan.reason);
  }
  return plan;
}

/** The text a command's `-EncodedCommand` word decodes to. */
function decodedOf(remoteProgram: string): string {
  return Buffer.from(
    remoteProgram.slice(COMMAND_START.length),
    'base64',
  ).toString('utf16le');
}

describe('the PowerShell plan', () => {
  describe('the reader', () => {
    it('F-2701 AC-5: reads the byte count of the prelude from the raw standard input and runs it', () => {
      strictEqual(
        powershellReader(12),
        [
          '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
          '$Stream = [Console]::OpenStandardInput()',
          '$Bytes = New-Object byte[] 12',
          '$Read = 0',
          'while ($Read -lt 12) { $Count = $Stream.Read($Bytes, $Read, 12 - $Read); if ($Count -le 0) { break }; $Read += $Count }',
          '& ([ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString($Bytes, 0, $Read)))',
        ].join('\n'),
      );
    });

    it('F-2701 AC-5: is the golden file for a count of one', () => {
      strictEqual(powershellReader(1), readFileSync(GOLDEN_READER, 'utf8'));
    });
  });

  describe('the remote program', () => {
    it('F-2701 AC-5: is Windows PowerShell with the reader as its encoded command, the reader of the prelude in bytes', () => {
      const program = plannedOf(powershellPlan(request())).remoteProgram;
      strictEqual(decodedOf(program), powershellReader(16));
    });

    it('F-2701 AC-5: counts the prelude in UTF-8 bytes, not characters', () => {
      const program = plannedOf(
        powershellPlan(request({script: 'é', environment: {NAME: 'é'}})),
      ).remoteProgram;
      strictEqual(
        decodedOf(program),
        powershellReader(Buffer.byteLength("$env:NAME = 'é'\né\n", 'utf8')),
      );
    });

    it('F-2701 AC-3: holds only letters, digits, plus, slash and equals after the encoded command word', () => {
      const program = plannedOf(
        powershellPlan(request({environment: {NAME: 'it\'s | "x" & $y'}})),
      ).remoteProgram;
      deepStrictEqual(
        [
          program.startsWith(COMMAND_START),
          /^[A-Za-z0-9+/=]+$/.test(program.slice(COMMAND_START.length)),
        ],
        [true, true],
      );
    });

    it('F-2701 AC-5: has the same command for the same prelude size, whatever the values', () => {
      deepStrictEqual(
        [
          plannedOf(powershellPlan(request({environment: {NAME: 'x'}})))
            .remoteProgram,
        ],
        [
          plannedOf(powershellPlan(request({environment: {NAME: 'y'}})))
            .remoteProgram,
        ],
      );
    });
  });

  describe('the input', () => {
    it('S10: sets each variable in order, a quote in a value doubled, then the script', () => {
      deepStrictEqual(
        plannedOf(
          powershellPlan(
            request({
              environment: {FIRST: "it's", SECOND: 'two'},
              script: 'Write-Output $env:FIRST',
            }),
          ),
        ).input,
        {
          kind: 'text',
          text: "$env:FIRST = 'it''s'\n$env:SECOND = 'two'\nWrite-Output $env:FIRST\n",
        },
      );
    });

    it('S10: is the script and a line end for an empty environment', () => {
      deepStrictEqual(plannedOf(powershellPlan(request())).input, {
        kind: 'text',
        text: 'Write-Output hi\n',
      });
    });

    it('S10: puts no value in the remote program', () => {
      strictEqual(
        plannedOf(
          powershellPlan(request({environment: {NAME: 'secret-value'}})),
        ).remoteProgram.includes('secret-value'),
        false,
      );
    });

    it('F-2701 AC-5: puts a text input after the prelude', () => {
      deepStrictEqual(
        plannedOf(
          powershellPlan(request({input: {kind: 'text', text: 'data'}})),
        ).input,
        {kind: 'text', text: 'Write-Output hi\ndata'},
      );
    });

    it('F-2701 AC-5: gives a file input as a file with the prelude as its prefix', () => {
      deepStrictEqual(
        plannedOf(
          powershellPlan(
            request({
              environment: {NAME: 'x'},
              input: {kind: 'file', localFile: '/a/file'},
            }),
          ),
        ).input,
        {
          kind: 'prefixedFile',
          prefix: "$env:NAME = 'x'\nWrite-Output hi\n",
          localFile: '/a/file',
        },
      );
    });
  });

  describe('a refusal', () => {
    it('S10: names an environment variable no name can be, for both interpreters', () => {
      deepStrictEqual(
        [
          planScript({
            ...request({environment: {'A B': 'x'}}),
            interpreter: 'powershell',
          }),
          planScript({
            ...request({environment: {'A B': 'x'}}),
            interpreter: 'posixShell',
          }),
        ],
        [
          {
            kind: 'refused',
            reason: "'A B' is not a name an environment variable can have",
          },
          {
            kind: 'refused',
            reason: "'A B' is not a name an environment variable can have",
          },
        ],
      );
    });

    it('F-2701 AC-5: comes for a command longer than the limit, with its length and the limit', () => {
      const length = plannedOf(powershellPlan(request())).remoteProgram.length;
      deepStrictEqual(powershellPlan(request(), length - 1), {
        kind: 'refused',
        reason: `the PowerShell command is ${String(length)} characters, and Windows runs one of at most ${String(length - 1)}`,
      });
    });

    it('F-2701 AC-5: does not come for a command of exactly the limit', () => {
      const length = plannedOf(powershellPlan(request())).remoteProgram.length;
      strictEqual(powershellPlan(request(), length).kind, 'planned');
    });

    it('F-2701 AC-5: the limit is 8192 characters, and the fixed reader is far below it', () => {
      deepStrictEqual(
        [
          POWERSHELL_COMMAND_LIMIT,
          plannedOf(powershellPlan(request())).remoteProgram.length <
            POWERSHELL_COMMAND_LIMIT,
        ],
        [8192, true],
      );
    });
  });

  describe('planScript', () => {
    it('F-2701 AC-5: plans a powershell request as the PowerShell plan', () => {
      deepStrictEqual(
        planScript({...request(), interpreter: 'powershell'}),
        powershellPlan(request()),
      );
    });
  });
});
