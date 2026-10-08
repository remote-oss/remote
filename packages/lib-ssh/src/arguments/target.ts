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

/**
 * Checks the host, then the user: a leading `-`, then a forbidden character, and returns the first problem found,
 * or undefined when the target may be handed to `ssh`. An empty user is not checked.
 */
export function validateTarget(target: SshTarget): TargetProblem | undefined {
  const hostProblem = nameProblem(target.host);
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
