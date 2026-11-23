/**
 * @fileoverview The arguments of `devcontainer open`: the folder or workspace file, `--config`, the options that are
 * accepted and do nothing (nothing is sent), and the refusal for any other argument.
 */

/** What the arguments of `open` come to. */
export type OpenArguments =
  | {kind: 'open'; path: string; config: string | undefined}
  | {kind: 'help'}
  | {kind: 'unknown'; argument: string}
  | {kind: 'missing'; option: string};

/** The options that take no value and change nothing. */
const IGNORED_OPTIONS = ['--disable-telemetry'];

/** The arguments after the word `open`. */
export function openArgumentsOf(argv: readonly string[]): OpenArguments {
  let folder: string | undefined;
  let config: string | undefined;
  let rest = argv;
  while (rest.length > 0) {
    const [argument = '', ...following] = rest;
    rest = following;
    if (argument === '--help') {
      return {kind: 'help'};
    }
    if (IGNORED_OPTIONS.includes(argument)) {
      continue;
    }
    if (argument === '--config') {
      const [value, ...after] = rest;
      if (value === undefined) {
        return {kind: 'missing', option: 'config'};
      }
      config = value;
      rest = after;
    } else if (argument.startsWith('--config=')) {
      config = argument.slice('--config='.length);
    } else if (argument.startsWith('-') || folder !== undefined) {
      return {
        kind: 'unknown',
        argument: argument.replace(/^-+/, '').replace(/=.*$/, ''),
      };
    } else {
      folder = argument;
    }
  }
  return {kind: 'open', path: folder ?? '.', config};
}
