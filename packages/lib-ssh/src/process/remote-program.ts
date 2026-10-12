/**
 * @fileoverview What an `ssh` run sends to the host to run a script: the remote command and the text that goes to
 * its standard input. A script without input travels on standard input of `sh -s`. A script with input travels as a
 * prelude ahead of its input on standard input, read by a fixed command whose one quoted word every login shell
 * parses alike.
 */

import type {ScriptInput, ScriptRequest} from 'lib-host';

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

/** A value as one word for a POSIX shell, whatever it holds. */
export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The remote command that evaluates the first `byteCount` bytes of its standard input and leaves the rest of the
 * input to what they start. Only a number is on the command line; every login shell passes it to `sh` unchanged.
 */
export function preludeProgram(byteCount: number): string {
  return `sh -c 'eval "$(dd bs=1 count=${String(byteCount)} 2>/dev/null)"'`;
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
  request: Pick<ScriptRequest, 'script' | 'interpreter' | 'environment'>,
): {kind: 'text'; text: string} | {kind: 'refused'; reason: string} {
  if (request.interpreter !== 'posixShell') {
    return {
      kind: 'refused',
      reason: `the ${request.interpreter} interpreter is not available over SSH yet`,
    };
  }
  const badName = badNameIn(request.environment);
  if (badName !== undefined) {
    return {
      kind: 'refused',
      reason: `'${badName}' is not a name an environment variable can have`,
    };
  }
  return {kind: 'text', text: request.script};
}

/** Plans the run of a script: the remote command and the standard input it needs. */
export function planScript(
  request: Pick<
    ScriptRequest,
    'script' | 'interpreter' | 'environment' | 'input'
  >,
): ScriptPlan {
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
