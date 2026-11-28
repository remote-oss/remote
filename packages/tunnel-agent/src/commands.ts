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

/** Runs the command `words` ask for, writing through `output`, and gives the exit status. */
export function runCommand(words: readonly string[], output: Output): number {
  if (words.length === 1 && words[0] === '--version') {
    output.stdout(`${manifest.version}\n`);
    return 0;
  }
  if (words.length === 1 && words[0] === '--help') {
    output.stdout(`${USAGE}\n`);
    return 0;
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
