/**
 * @fileoverview Turns the connection command a user types ("ssh -p 2222 user@host", "user@host:22", "host") into
 * the Host block that is written to a configuration file.
 */

/** One option line of a Host block. */
export interface BlockLine {
  keyword: string;
  value: string;
}

/** A Host block: its alias and its lines, the `HostName` line first. */
export interface HostBlock {
  alias: string;
  lines: BlockLine[];
}

/** Why a command could not be read. The message is shown as it is, in every display language. */
export type AddHostProblem =
  | {
      kind:
        | 'missingHost'
        | 'unknownFlag'
        | 'missingFlagArgument'
        | 'optionWithoutValue';
      message: string;
    }
  | {kind: 'shellCharacter'; character: string};

/** The block for a command, or the problem that stops it. */
export type AddHostResult = {block: HostBlock} | {problem: AddHostProblem};

/** Characters that stop a command when they stand outside quotes. */
const SHELL_CHARACTERS = new Set([
  ';',
  '|',
  '&',
  '>',
  '<',
  '(',
  ')',
  '*',
  '?',
  '#',
]);

/** A `$name` part, which is dropped from the command. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Flags that take no argument and write nothing. */
const SILENT_FLAGS = new Set('tTNfnsqGVya');

/** Flags whose argument is consumed and not written. */
const SILENT_ARGUMENT_FLAGS = new Set('FEeBOQPW');

/** Flags that take no argument and write a fixed line. */
const FIXED_FLAGS: ReadonlyMap<string, BlockLine> = new Map([
  ['A', {keyword: 'ForwardAgent', value: 'yes'}],
  ['v', {keyword: 'LogLevel', value: 'verbose'}],
  ['C', {keyword: 'Compression', value: 'yes'}],
  ['X', {keyword: 'ForwardX11', value: 'yes'}],
  ['x', {keyword: 'ForwardX11', value: 'no'}],
  ['Y', {keyword: 'ForwardX11Trusted', value: 'yes'}],
  ['4', {keyword: 'AddressFamily', value: 'inet'}],
  ['6', {keyword: 'AddressFamily', value: 'inet6'}],
  ['k', {keyword: 'GSSAPIDelegateCredentials', value: 'no'}],
  ['K', {keyword: 'GSSAPIAuthentication', value: 'yes'}],
  ['g', {keyword: 'GatewayPorts', value: 'yes'}],
  ['M', {keyword: 'ControlMaster', value: 'yes'}],
]);

/** Flags whose argument becomes the value of a keyword. */
const VALUE_FLAGS: ReadonlyMap<string, string> = new Map([
  ['p', 'Port'],
  ['l', 'User'],
  ['i', 'IdentityFile'],
  ['J', 'ProxyJump'],
  ['L', 'LocalForward'],
  ['R', 'RemoteForward'],
  ['D', 'DynamicForward'],
  ['S', 'ControlPath'],
  ['m', 'MACs'],
  ['b', 'BindAddress'],
  ['w', 'TunnelDevice'],
]);

/** Keywords whose value is written in double quotes when it holds a blank. */
const QUOTED_KEYWORDS = new Set(['IdentityFile', 'User']);

/** The `-o` keyword that never becomes a line, because the destination gives it. */
const DESTINATION_KEYWORD = 'HostName';

/** Reads a typed connection command. */
export function parseAddHostCommand(command: string): AddHostResult {
  const split = splitWords(command);
  if ('problem' in split) {
    return split;
  }
  const words = split.words[0] === 'ssh' ? split.words.slice(1) : split.words;
  const collector = new LineCollector();
  let destination: string | undefined;
  let index = 0;
  let optionsEnded = false;
  while (index < words.length) {
    const word = words[index++] ?? '';
    if (!optionsEnded && word === '--') {
      optionsEnded = true;
    } else if (!optionsEnded && word.startsWith('-') && word.length > 1) {
      const problem = readFlags(word, () => words[index++], collector);
      if (problem !== undefined) {
        return {problem};
      }
    } else if (destination === undefined) {
      destination = word;
      const problem = readDestination(word, collector);
      if (problem !== undefined) {
        return {problem};
      }
    } else {
      break;
    }
  }
  const alias = collector.alias;
  if (destination === undefined || alias === undefined) {
    return {problem: missingHost()};
  }
  return {
    block: {
      alias,
      lines: [
        {keyword: DESTINATION_KEYWORD, value: alias},
        ...collector.lines(),
      ],
    },
  };
}

/** The problem for a command without a host. */
function missingHost(): AddHostProblem {
  return {
    kind: 'missingHost',
    message: 'Missing host in SSH connection string',
  };
}

/** Keeps one line per keyword at its first position with its last value; `-l` outranks the destination's user. */
class LineCollector {
  alias: string | undefined;
  private readonly values = new Map<string, string>();
  private destinationUser: string | undefined;
  private flagUserSeen = false;

  /** Records a value for a keyword. */
  record(keyword: string, value: string): void {
    this.values.set(keyword, value);
  }

  /** Records the user of a `-l` flag. */
  addFlagUser(user: string): void {
    this.flagUserSeen = true;
    this.record('User', user);
  }

  /** Records the user part of the destination at the destination's position. */
  addDestinationUser(user: string): void {
    this.destinationUser = user;
    if (!this.values.has('User')) {
      this.values.set('User', user);
    }
  }

  /** The lines in order of first appearance, values quoted where needed. */
  lines(): BlockLine[] {
    if (!this.flagUserSeen && this.destinationUser !== undefined) {
      this.values.set('User', this.destinationUser);
    }
    return [...this.values].map(([keyword, value]) => ({
      keyword,
      value:
        QUOTED_KEYWORDS.has(keyword) && /\s/.test(value) ? `"${value}"` : value,
    }));
  }
}

/** Reads one word of flags, taking an argument from the word's rest or from the next word. */
function readFlags(
  word: string,
  nextWord: () => string | undefined,
  collector: LineCollector,
): AddHostProblem | undefined {
  for (let position = 1; position < word.length; position++) {
    const letter = word.charAt(position);
    const fixed = FIXED_FLAGS.get(letter);
    if (fixed !== undefined) {
      collector.record(fixed.keyword, fixed.value);
      continue;
    }
    if (SILENT_FLAGS.has(letter)) {
      continue;
    }
    const keyword = argumentKeyword(letter);
    if (keyword === undefined) {
      return {kind: 'unknownFlag', message: `Unknown flag ${letter}`};
    }
    const argument =
      position + 1 < word.length ? word.slice(position + 1) : nextWord();
    if (argument === undefined) {
      return {
        kind: 'missingFlagArgument',
        message: `Expected flag -${letter} to have an argument but it did not`,
      };
    }
    return applyArgument(letter, keyword, argument, collector);
  }
  return undefined;
}

/** The keyword an argument flag writes, the empty string for one that writes nothing, undefined for an unknown flag. */
function argumentKeyword(letter: string): string | undefined {
  if (SILENT_ARGUMENT_FLAGS.has(letter)) {
    return '';
  }
  if (letter === 'c') {
    return 'Ciphers';
  }
  if (letter === 'I') {
    return 'PKCS11Provider';
  }
  if (letter === 'o') {
    return 'o';
  }
  return VALUE_FLAGS.get(letter);
}

/** Records the line an argument flag writes. */
function applyArgument(
  letter: string,
  keyword: string,
  argument: string,
  collector: LineCollector,
): AddHostProblem | undefined {
  if (letter === 'o') {
    const equals = argument.indexOf('=');
    if (equals < 0) {
      return {
        kind: 'optionWithoutValue',
        message: `Argument missing for option ${argument}`,
      };
    }
    const optionKeyword = argument.slice(0, equals);
    if (optionKeyword !== DESTINATION_KEYWORD) {
      collector.record(optionKeyword, argument.slice(equals + 1));
    }
  } else if (letter === 'l') {
    collector.addFlagUser(argument);
  } else if (letter === 'L') {
    collector.record(keyword, localForwardValue(argument));
  } else if (keyword !== '') {
    collector.record(keyword, argument);
  }
  return undefined;
}

/** `[bind:]port:host:hostport` as the `LocalForward` value `[bind:]port host:hostport`. */
function localForwardValue(argument: string): string {
  const parts = argument.split(':');
  if (parts.length < 3) {
    return argument;
  }
  const target = parts.slice(-2).join(':');
  return `${parts.slice(0, -2).join(':')} ${target}`;
}

/** Reads `[ssh://][user@]host[:port]` and records the alias, the user and the port. */
function readDestination(
  word: string,
  collector: LineCollector,
): AddHostProblem | undefined {
  const withoutScheme = word.startsWith('ssh://')
    ? word.slice('ssh://'.length)
    : word;
  const userEnd = withoutScheme.lastIndexOf('@');
  const user = userEnd < 0 ? '' : withoutScheme.slice(0, userEnd);
  const hostAndPort = withoutScheme.slice(userEnd + 1);
  const {host, port} = splitHostAndPort(hostAndPort);
  if (host === '') {
    return missingHost();
  }
  collector.alias = host;
  if (user !== '') {
    collector.addDestinationUser(user);
  }
  if (port !== undefined) {
    collector.record('Port', port);
  }
  return undefined;
}

/** The host and the optional port of a destination; an IPv6 address, bracketed or bare, stays whole. */
function splitHostAndPort(text: string): {host: string; port?: string} {
  const bracketed = /^\[([^\]]*)\](?::(.*))?$/.exec(text);
  if (bracketed !== null) {
    const host = bracketed[1] ?? '';
    return bracketed[2] === undefined ? {host} : {host, port: bracketed[2]};
  }
  if (text.indexOf(':') !== text.lastIndexOf(':')) {
    return {host: text};
  }
  const colon = text.indexOf(':');
  return colon < 0
    ? {host: text}
    : {host: text.slice(0, colon), port: text.slice(colon + 1)};
}

/**
 * Splits a command into words as a POSIX shell does: blanks separate, quotes group and are removed, a backslash
 * escapes outside single quotes, and `$name` parts are dropped. A quote that is never closed is ignored.
 */
function splitWords(
  command: string,
): {words: string[]} | {problem: AddHostProblem} {
  const words: string[] = [];
  let word: string | undefined;
  let quote: string | undefined;
  for (let position = 0; position < command.length; position++) {
    const character = command.charAt(position);
    if (quote === undefined && (character === '"' || character === "'")) {
      if (command.includes(character, position + 1)) {
        quote = character;
        word ??= '';
      }
      continue;
    }
    if (character === quote) {
      quote = undefined;
      continue;
    }
    if (character === '\\' && quote !== "'" && position + 1 < command.length) {
      word = (word ?? '') + command.charAt(++position);
      continue;
    }
    if (character === '$' && quote !== "'") {
      const name = VARIABLE_NAME.exec(command.slice(position + 1));
      if (name !== null) {
        position += name[0].length;
        word ??= '';
        continue;
      }
    }
    if (quote === undefined && /\s/.test(character)) {
      if (word !== undefined) {
        words.push(word);
      }
      word = undefined;
      continue;
    }
    if (quote === undefined && SHELL_CHARACTERS.has(character)) {
      return {problem: {kind: 'shellCharacter', character}};
    }
    word = (word ?? '') + character;
  }
  if (word !== undefined) {
    words.push(word);
  }
  return {words};
}
