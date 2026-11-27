/** The part of the extension's manifest that says in which windows each command is offered. */
export interface WindowManifest {
  contributes?: {
    menus?: {
      commandPalette?: Array<{command: string; when?: string}>;
    };
  };
}

/** The tokens of a `when` clause: its operators, a regular expression, a word, or any other character. */
const TOKEN =
  /\s*(&&|\|\||=~|==|!=|\(|\)|!|\/(?:\\.|[^/\\])*\/[a-z]*|[\w.:-]+|\S)/gy;

/** Reads a `when` clause, taking only its terms about the remote name for what they say. */
class WhenReader {
  private readonly tokens: string[];
  private position = 0;
  private readonly remoteName: string;

  /** A reader of `clause` for a window whose remote name is `remoteName`, none when it is `undefined`. */
  constructor(clause: string, remoteName: string | undefined) {
    this.tokens = [...clause.matchAll(TOKEN)].map(found => found[1] ?? '');
    this.remoteName = remoteName ?? '';
  }

  /** Whether the whole clause holds. */
  holds(): boolean {
    return this.either();
  }

  private either(): boolean {
    let holds = this.both();
    while (this.accept('||')) {
      holds = this.both() || holds;
    }
    return holds;
  }

  private both(): boolean {
    let holds = this.term();
    while (this.accept('&&')) {
      holds = this.term() && holds;
    }
    return holds;
  }

  private term(): boolean {
    const negated = this.accept('!');
    if (this.accept('(')) {
      const inside = this.either();
      this.accept(')');
      return negated ? !inside : inside;
    }
    const key = this.next();
    const operator = ['=~', '==', '!='].find(each => this.accept(each));
    const operand = operator === undefined ? '' : this.next();
    if (key !== 'remoteName') {
      return true;
    }
    const holds =
      operator === undefined
        ? this.remoteName !== ''
        : operator === '=~'
          ? new RegExp(operand.slice(1, operand.lastIndexOf('/'))).test(
              this.remoteName,
            )
          : (this.remoteName === operand) === (operator === '==');
    return negated ? !holds : holds;
  }

  private accept(token: string): boolean {
    if (this.tokens[this.position] !== token) {
      return false;
    }
    this.position += 1;
    return true;
  }

  private next(): string {
    const token = this.tokens[this.position] ?? '';
    this.position += 1;
    return token;
  }
}

/**
 * Whether command `commandId` is offered in a window whose remote name is `remoteName` (none for a local window),
 * by the `when` clause of its Command Palette entry in `manifest`. Only the terms about the remote name are read: the
 * editor has already checked every other term before it runs a command, so each of them counts as true. A command with
 * no entry, or an entry with no clause, is offered everywhere.
 */
export function admitsWindow(
  manifest: WindowManifest,
  commandId: string,
  remoteName: string | undefined,
): boolean {
  const entry = manifest.contributes?.menus?.commandPalette?.find(
    each => each.command === commandId,
  );
  return (
    entry?.when === undefined || new WhenReader(entry.when, remoteName).holds()
  );
}
