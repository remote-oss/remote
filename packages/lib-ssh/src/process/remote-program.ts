/**
 * @fileoverview What an `ssh` run sends to the host to run a script: the remote command and the text that goes to
 * its standard input. A script without input travels on standard input of `sh -s`, which every login shell parses
 * the same way. A script with input needs standard input for that input, so it travels as the one quoted argument
 * of `sh -c`, for login shells that read single quotes as POSIX does.
 */

import type {ScriptInput, ScriptRequest} from 'lib-host';

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A script to run and how it reaches the host. */
export type ScriptPlan =
  | {
      kind: 'planned';
      /** The command `ssh` runs on the host. */
      remoteProgram: string;
      /** What goes to the command's standard input. */
      input: ScriptInput;
    }
  | {kind: 'refused'; reason: string};

/** A value as one word for a POSIX shell, whatever it holds. */
export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The lines that set the added environment variables for the script, or the first name that cannot be one. */
function environmentLines(
  environment: Readonly<Record<string, string>>,
): string[] | {badName: string} {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(environment)) {
    if (!ENVIRONMENT_NAME.test(name)) {
      return {badName: name};
    }
    lines.push(`${name}=${posixQuote(value)}`, `export ${name}`);
  }
  return lines;
}

/** Plans the run of a script: the remote command and the standard input it needs. */
export function planScript(
  request: Pick<
    ScriptRequest,
    'script' | 'interpreter' | 'environment' | 'input'
  >,
): ScriptPlan {
  if (request.interpreter !== 'posixShell') {
    return {
      kind: 'refused',
      reason: `the ${request.interpreter} interpreter is not available over SSH yet`,
    };
  }
  const lines = environmentLines(request.environment);
  if ('badName' in lines) {
    return {
      kind: 'refused',
      reason: `'${lines.badName}' is not a name an environment variable can have`,
    };
  }
  const scriptText = [...lines, request.script].join('\n');
  const hasInput = request.input.kind === 'file' || request.input.text !== '';
  return hasInput
    ? {
        kind: 'planned',
        remoteProgram: `sh -c ${posixQuote(scriptText)}`,
        input: request.input,
      }
    : {
        kind: 'planned',
        remoteProgram: 'sh -s',
        input: {kind: 'text', text: scriptText},
      };
}
