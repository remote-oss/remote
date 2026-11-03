/**
 * @fileoverview What an `ssh` run sends to the host to run a script: the remote command and the text that goes to
 * its standard input. A script without input travels on standard input of `sh -s`. A script with input travels as a
 * prelude ahead of its input on standard input, read by a fixed command whose one quoted word every login shell
 * parses alike. A script for PowerShell travels the same way: its prelude and the script on standard input, read by
 * a fixed reader that is the one encoded command on the command line.
 */

import {
  posixQuote,
  powershellQuote,
  preludeCommand,
  type ScriptInput,
  type ScriptRequest,
} from 'lib-host';

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What goes to the standard input of a planned command: a script's input, possibly with text in front of a file. */
export type PlannedInput =
  ScriptInput | {kind: 'prefixedFile'; prefix: string; localFile: string};

/** A script to run and how it reaches the host. */
export type ScriptPlan =
  | {
      kind: 'planned';
      /** The command `ssh` runs on the host. */
      remoteProgram: string;
      /** What goes to the command's standard input. */
      input: PlannedInput;
    }
  | {kind: 'refused'; reason: string};

/**
 * The remote command that evaluates the first `byteCount` bytes of its standard input and leaves the rest of the
 * input to what they start. Only a number is on the command line; every login shell passes it to `sh` unchanged.
 */
export function preludeProgram(byteCount: number): string {
  return `sh -c ${posixQuote(preludeCommand(byteCount))}`;
}

/** The first name in the environment that cannot be a variable's, if any. */
function badNameIn(
  environment: Readonly<Record<string, string>>,
): string | undefined {
  return Object.keys(environment).find(name => !ENVIRONMENT_NAME.test(name));
}

/** The lines that set and export the added environment variables; their names are already checked. */
function environmentLines(
  environment: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(environment).flatMap(([name, value]) => [
    `${name}=${posixQuote(value)}`,
    `export ${name}`,
  ]);
}

/**
 * The environment as the words in front of a command (`A='x y' B='it'\''s' `), empty for none, so that the command
 * receives it without the values appearing in any process's command line.
 */
export function environmentPrefix(
  environment: Readonly<Record<string, string>>,
): string {
  return Object.entries(environment)
    .map(([name, value]) => `${name}=${posixQuote(value)} `)
    .join('');
}

/** The text of a script, or why it cannot be run. The environment is not part of it. */
export function scriptText(
  request: Pick<ScriptRequest, 'script' | 'environment'>,
): {kind: 'text'; text: string} | {kind: 'refused'; reason: string} {
  const badName = badNameIn(request.environment);
  if (badName !== undefined) {
    return {
      kind: 'refused',
      reason: `'${badName}' is not a name an environment variable can have`,
    };
  }
  return {kind: 'text', text: request.script};
}

/** The longest command Windows runs, in characters. */
export const POWERSHELL_COMMAND_LIMIT = 8192;

/** The PowerShell lines that set the added environment variables; their names are already checked. */
function powershellEnvironmentLines(
  environment: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(environment).map(
    ([name, value]) => `$env:${name} = ${powershellQuote(value)}`,
  );
}

/**
 * The fixed text PowerShell runs: it reads exactly `byteCount` bytes of the raw standard input, which hold the
 * prelude and the script, and runs them as a script block. It never reads through the console's buffered reader, so
 * what follows those bytes is left for the script.
 */
export function powershellReader(byteCount: number): string {
  const count = String(byteCount);
  return [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    '$Stream = [Console]::OpenStandardInput()',
    `$Bytes = New-Object byte[] ${count}`,
    '$Read = 0',
    `while ($Read -lt ${count}) { $Count = $Stream.Read($Bytes, $Read, ${count} - $Read); if ($Count -le 0) { break }; $Read += $Count }`,
    '& ([ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString($Bytes, 0, $Read)))',
  ].join('\n');
}

/**
 * Plans the run of a PowerShell script: the environment as assignments ahead of the script on standard input, and a
 * command of letters, digits and `+/=` that every DefaultShell parses alike. A command longer than `limit`
 * characters is refused, as Windows would refuse it.
 */
export function powershellPlan(
  request: Pick<ScriptRequest, 'script' | 'environment' | 'input'>,
  limit: number = POWERSHELL_COMMAND_LIMIT,
): ScriptPlan {
  const script = scriptText(request);
  if (script.kind === 'refused') {
    return script;
  }
  const prelude = `${[...powershellEnvironmentLines(request.environment), script.text].join('\n')}\n`;
  const reader = powershellReader(Buffer.byteLength(prelude, 'utf8'));
  const remoteProgram = `powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(reader, 'utf16le').toString('base64')}`;
  if (remoteProgram.length > limit) {
    return {
      kind: 'refused',
      reason: `the PowerShell command is ${String(remoteProgram.length)} characters, and Windows runs one of at most ${String(limit)}`,
    };
  }
  return {
    kind: 'planned',
    remoteProgram,
    input:
      request.input.kind === 'text'
        ? {kind: 'text', text: prelude + request.input.text}
        : {
            kind: 'prefixedFile',
            prefix: prelude,
            localFile: request.input.localFile,
          },
  };
}

/** Plans the run of a script: the remote command and the standard input it needs. */
export function planScript(
  request: Pick<
    ScriptRequest,
    'script' | 'interpreter' | 'environment' | 'input'
  >,
): ScriptPlan {
  if (request.interpreter === 'powershell') {
    return powershellPlan(request);
  }
  const script = scriptText(request);
  if (script.kind === 'refused') {
    return script;
  }
  const lines = environmentLines(request.environment);
  const hasInput = request.input.kind === 'file' || request.input.text !== '';
  if (!hasInput) {
    return {
      kind: 'planned',
      remoteProgram: 'sh -s',
      input: {kind: 'text', text: [...lines, script.text].join('\n')},
    };
  }
  const prelude = `${[...lines, script.text].join('\n')}\n`;
  return {
    kind: 'planned',
    remoteProgram: preludeProgram(Buffer.byteLength(prelude, 'utf8')),
    input:
      request.input.kind === 'text'
        ? {kind: 'text', text: prelude + request.input.text}
        : {
            kind: 'prefixedFile',
            prefix: prelude,
            localFile: request.input.localFile,
          },
  };
}
