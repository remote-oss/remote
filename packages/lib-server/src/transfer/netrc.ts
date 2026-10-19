/**
 * @fileoverview The client's netrc file as the download reads it: the `machine` entries that hold a login and a
 * password, and the `Authorization` value one address gets from them. Nothing here logs a login, a password or a
 * line of the file.
 */

import type {Logger} from 'lib-log';

/** One `machine` entry with both a login and a password. */
export interface NetrcEntry {
  readonly machine: string;
  readonly login: string;
  readonly password: string;
}

/** The escapes of a quoted token, in curl's form. */
const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);

/** What a netrc text is read through: its tokens, one after the other. */
interface TokenReader {
  /** The next token, or undefined at the end of the text (an unterminated quote ends it). */
  next(): string | undefined;
  /** Drops everything up to the next blank line, which a `macdef` body runs to. */
  skipMacroBody(): void;
}

/** Whether the character separates tokens. */
function isSpace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

/** The reader of `text`. */
function readerOf(text: string): TokenReader {
  let position = 0;

  function skipSpaceAndComments(): void {
    while (position < text.length) {
      if (isSpace(text[position])) {
        position += 1;
      } else if (text[position] === '#') {
        const lineEnd = text.indexOf('\n', position);
        position = lineEnd === -1 ? text.length : lineEnd + 1;
      } else {
        return;
      }
    }
  }

  function quoted(): string | undefined {
    position += 1;
    let value = '';
    while (position < text.length) {
      const character = text.charAt(position);
      position += 1;
      if (character === '"') {
        return value;
      }
      const escaped =
        character === '\\' ? ESCAPES.get(text.charAt(position)) : undefined;
      if (escaped === undefined) {
        value += character;
      } else {
        value += escaped;
        position += 1;
      }
    }
    return undefined;
  }

  return {
    next: () => {
      skipSpaceAndComments();
      if (position >= text.length) {
        return undefined;
      }
      if (text[position] === '"') {
        return quoted();
      }
      const start = position;
      while (position < text.length && !isSpace(text[position])) {
        position += 1;
      }
      return text.slice(start, position);
    },
    skipMacroBody: () => {
      const lineEnd = text.indexOf('\n', position);
      position = lineEnd === -1 ? text.length : lineEnd + 1;
      while (position < text.length) {
        const nextEnd = text.indexOf('\n', position);
        const line = text.slice(
          position,
          nextEnd === -1 ? text.length : nextEnd,
        );
        position = nextEnd === -1 ? text.length : nextEnd + 1;
        if (line.trim() === '') {
          return;
        }
      }
    },
  };
}

/** An entry being read: `undefined` fields are not seen yet. */
interface PendingEntry {
  machine: string;
  login?: string;
  password?: string;
}

/** The usable entries of a netrc text, in file order. */
export function parseNetrc(text: string): readonly NetrcEntry[] {
  const reader = readerOf(text);
  const entries: NetrcEntry[] = [];
  let current: PendingEntry | undefined;

  function finish(): void {
    if (
      current?.login !== undefined &&
      current.login !== '' &&
      current.password !== undefined &&
      current.password !== ''
    ) {
      entries.push({
        machine: current.machine,
        login: current.login,
        password: current.password,
      });
    }
    current = undefined;
  }

  for (;;) {
    const keyword = reader.next();
    if (keyword === undefined) {
      break;
    }
    if (keyword === 'default') {
      finish();
      continue;
    }
    const value = reader.next();
    if (value === undefined) {
      break;
    }
    if (keyword === 'machine') {
      finish();
      current = {machine: value};
    } else if (keyword === 'login' && current !== undefined) {
      current.login = value;
    } else if (keyword === 'password' && current !== undefined) {
      current.password = value;
    } else if (keyword === 'macdef') {
      reader.skipMacroBody();
    }
  }
  finish();
  return entries;
}

/** The `Authorization` value for `address`, or undefined; see the download rule. Logs the http case once through `logger`. */
export function authorizationOf(
  entries: readonly NetrcEntry[],
  logger: Logger,
): (address: string) => string | undefined {
  let told = false;
  return address => {
    if (!URL.canParse(address)) {
      return undefined;
    }
    const {hostname, protocol} = new URL(address);
    const entry = entries.find(each => each.machine.toLowerCase() === hostname);
    if (entry === undefined) {
      return undefined;
    }
    if (protocol !== 'https:') {
      if (!told) {
        told = true;
        logger.info(`a netrc entry for ${hostname} was not sent over http`);
      }
      return undefined;
    }
    return `Basic ${Buffer.from(`${entry.login}:${entry.password}`, 'utf8').toString('base64')}`;
  };
}
