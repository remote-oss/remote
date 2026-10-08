/**
 * @fileoverview The connection target and the name checks that run before any `ssh` process exists.
 */

/** A decoded connection target: an alias or a host name, with the user and port the authority carries. */
export interface SshTarget {
  host: string;
  user?: string;
  port?: number;
}

/** Why a target was refused, with the string that explains it and the character it names. */
export interface TargetProblem {
  kind: 'invalidHost' | 'invalidUser';
  reason: 'S119' | 'S120' | 'S121' | 'S122';
  character: string;
}

/** The characters a host or user name must not contain, in the order that decides which one is reported. */
const FORBIDDEN_CHARACTERS = ['\\', "'", '"', '`', '!', '%'] as const;

/** The leading character a host or user name must not start with. */
const FORBIDDEN_START = '-';

/** Whether a code point is a control character a host name must not contain. */
function isControlCharacter(codePoint: number): boolean {
  return codePoint < 0x20 || codePoint === 0x7f;
}

/**
 * The first control character of a host name, named by its code point (`U+` and four upper-case hex digits), or
 * undefined when the name holds none.
 */
function controlCharacter(name: string): string | undefined {
  for (const character of name) {
    const codePoint = character.charCodeAt(0);
    if (isControlCharacter(codePoint)) {
      return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return undefined;
}

/**
 * Checks the host, then the user: a leading `-`, then a forbidden character, and returns the first problem found,
 * or undefined when the target may be handed to `ssh`. An empty user is not checked.
 */
export function validateTarget(target: SshTarget): TargetProblem | undefined {
  const hostProblem =
    nameProblem(target.host) ?? hostControlProblem(target.host);
  if (hostProblem !== undefined) {
    return {
      kind: 'invalidHost',
      reason: hostProblem.leading ? 'S119' : 'S120',
      character: hostProblem.character,
    };
  }
  const userProblem =
    target.user === undefined ? undefined : nameProblem(target.user);
  if (userProblem !== undefined) {
    return {
      kind: 'invalidUser',
      reason: userProblem.leading ? 'S121' : 'S122',
      character: userProblem.character,
    };
  }
  return undefined;
}

/** The first rule a name breaks: its leading character, or the first forbidden character in the fixed order. */
function nameProblem(
  name: string,
): {leading: boolean; character: string} | undefined {
  if (name.startsWith(FORBIDDEN_START)) {
    return {leading: true, character: FORBIDDEN_START};
  }
  const character = FORBIDDEN_CHARACTERS.find(forbidden =>
    name.includes(forbidden),
  );
  return character === undefined ? undefined : {leading: false, character};
}

/** The host's first control character, when no leading or forbidden character already refused the name. */
function hostControlProblem(name: string):
  | {
      leading: boolean;
      character: string;
    }
  | undefined {
  const control = controlCharacter(name);
  return control === undefined
    ? undefined
    : {leading: false, character: control};
}
