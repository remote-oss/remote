/**
 * @fileoverview The legacy `devcontainer build` surface: the positional folder, `--verbose` and `--disable-telemetry`
 * (accepted, and nothing is sent) and a fixed list of the open CLI's options. It gives the arguments the CLI's own
 * `build` takes, or says which argument is unknown.
 */

/** The options that take a value. */
const VALUED = new Set([
  '--user-data-folder',
  '--docker-path',
  '--docker-compose-path',
  '--workspace-folder',
  '--config',
  '--log-level',
  '--log-format',
  '--image-name',
  '--cache-from',
  '--buildkit',
  '--platform',
]);

/** The options that take none. */
const FLAGS = new Set(['--no-cache', '--push']);

/** What the arguments of `build` come to. */
export type BuildArguments =
  | {kind: 'build'; forwarded: string[]}
  | {kind: 'help'}
  | {kind: 'unknown'; argument: string}
  | {kind: 'missing'; option: string};

/** The name of an option without its dashes and its value. */
function nameOf(argument: string): string {
  return argument.replace(/^-+/, '').replace(/=.*$/, '');
}

/** The arguments after the word `build`, as the CLI's `build` takes them. */
export function buildArgumentsOf(argv: readonly string[]): BuildArguments {
  const options: string[] = [];
  let positional: string | undefined;
  let workspace: string | undefined;
  let verbose = false;
  let levelGiven = false;
  let rest = argv;
  while (rest.length > 0) {
    const [argument = '', ...following] = rest;
    rest = following;
    const [option = ''] = argument.split('=', 1);
    if (argument === '--help' || argument === '-h') {
      return {kind: 'help'};
    }
    if (argument === '--disable-telemetry') {
      continue;
    }
    if (argument === '--verbose') {
      verbose = true;
    } else if (FLAGS.has(argument)) {
      options.push(argument);
    } else if (VALUED.has(option)) {
      const inline = argument.includes('=');
      const [next, ...after] = rest;
      const value = inline ? argument.slice(option.length + 1) : next;
      if (value === undefined) {
        return {kind: 'missing', option: nameOf(argument)};
      }
      rest = inline ? rest : after;
      levelGiven ||= option === '--log-level';
      if (option === '--workspace-folder') {
        workspace = value;
      } else {
        options.push(...(inline ? [argument] : [argument, value]));
      }
    } else if (argument.startsWith('-') || positional !== undefined) {
      return {kind: 'unknown', argument: nameOf(argument)};
    } else {
      positional = argument;
    }
  }
  const folder = workspace ?? positional;
  return {
    kind: 'build',
    forwarded: [
      ...(folder === undefined ? [] : ['--workspace-folder', folder]),
      ...(verbose && !levelGiven ? ['--log-level', 'debug'] : []),
      ...options,
    ],
  };
}
