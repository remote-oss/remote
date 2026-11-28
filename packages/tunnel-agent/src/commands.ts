/**
 * @fileoverview The agent's command line: which command a run asks for, and what each one prints. Only the version
 * and the usage are answered here; each other command is the work of its own module.
 */

import manifest from '../package.json' with {type: 'json'};

/** Where a run writes, and the exit status it ends with. */
export interface Output {
  /** Writes `text` to the standard output. */
  stdout(text: string): void;
  /** Writes `text` to the standard error. */
  stderr(text: string): void;
}

/** The usage text, as `--help` prints it and an unknown command shows it. */
export const USAGE = [
  'usage: tunnel-agent [--name <name>]',
  '       tunnel-agent login [--token-stdin]',
  '       tunnel-agent service install | service uninstall',
  '       tunnel-agent rename <name>',
  '       tunnel-agent unregister',
  '       tunnel-agent --version',
].join('\n');

/** The commands of the agent that a later part of it answers, as their words on the command line. */
const LATER_COMMANDS: ReadonlyArray<readonly string[]> = [
  [],
  ['login'],
  ['login', '--token-stdin'],
  ['service', 'install'],
  ['service', 'uninstall'],
  ['unregister'],
];

/** Whether `words` are those of a command a later part answers: `rename <name>` and `--name <name>` included. */
function isLaterCommand(words: readonly string[]): boolean {
  const [first, second, ...rest] = words;
  if ((first === 'rename' || first === '--name') && rest.length === 0) {
    return second !== undefined && second !== '';
  }
  return LATER_COMMANDS.some(
    command =>
      command.length === words.length &&
      command.every((word, index) => word === words[index]),
  );
}

/** What a command that is built does, by command: the exit status it ends with. */
export interface Handlers {
  /** Registers the tunnel and serves it until stopped; `name` is the one `--name` gave. */
  start?(name: string | undefined): Promise<number>;
  /** Renames the registered tunnel. */
  rename?(name: string): Promise<number>;
  /** Deletes the registered tunnel and forgets it. */
  unregister?(): Promise<number>;
}

/** The exit status of the built command `words` ask for, or none when no handler answers them. */
function handled(
  words: readonly string[],
  handlers: Handlers,
): Promise<number> | undefined {
  const [first, name] = words;
  const named = words.length === 2 && name !== undefined && name !== '';
  if (words.length === 0) {
    return handlers.start?.(undefined);
  }
  if (first === '--name' && named) {
    return handlers.start?.(name);
  }
  if (first === 'rename' && named) {
    return handlers.rename?.(name);
  }
  return words.length === 1 && first === 'unregister'
    ? handlers.unregister?.()
    : undefined;
}

/** Runs the command `words` ask for, writing through `output`, and gives the exit status. */
export async function runCommand(
  words: readonly string[],
  output: Output,
  handlers: Handlers = {},
): Promise<number> {
  if (words.length === 1 && words[0] === '--version') {
    output.stdout(`${manifest.version}\n`);
    return 0;
  }
  if (words.length === 1 && words[0] === '--help') {
    output.stdout(`${USAGE}\n`);
    return 0;
  }
  const status = await handled(words, handlers);
  if (status !== undefined) {
    return status;
  }
  if (isLaterCommand(words)) {
    output.stderr(`${['tunnel-agent', ...words].join(' ')}: not built yet\n`);
    return 2;
  }
  output.stderr(
    `tunnel-agent: unknown command: ${words.join(' ')}\n${USAGE}\n`,
  );
  return 2;
}
