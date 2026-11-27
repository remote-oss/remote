/** A key login of the user harness that the host's sshd logged: when it was accepted and, once it ended, when. */
export interface HostLogin {
  /** The client's address and port, which name the login in sshd's lines. */
  peer: string;
  /** The time sshd accepted it, in milliseconds. */
  accepted: number;
  /** The time sshd logged its disconnect, in milliseconds; none while it is up. */
  ended?: number;
}

const ACCEPTED = /Accepted publickey for harness from (\S+) port (\d+)/;
const DISCONNECTED = /Disconnected from user harness (\S+) port (\d+)/;

/** The time a `docker logs --timestamps` line starts with, in milliseconds. */
function timeOf(line: string): number {
  return Date.parse(line.slice(0, line.indexOf(' ')));
}

/**
 * The key logins of the user harness in the lines of the host's sshd (from `docker logs --timestamps`), in the order
 * they were accepted, each with the time its disconnect was logged when it was. A disconnect belongs to the latest login
 * of its address and port that is still up, so a port that is used again names its own login.
 */
export function hostLoginsOf(lines: readonly string[]): HostLogin[] {
  const logins: HostLogin[] = [];
  for (const line of lines) {
    const accepted = ACCEPTED.exec(line);
    if (accepted !== null) {
      logins.push({
        peer: `${accepted[1] ?? ''}:${accepted[2] ?? ''}`,
        accepted: timeOf(line),
      });
      continue;
    }
    const disconnected = DISCONNECTED.exec(line);
    if (disconnected !== null) {
      const peer = `${disconnected[1] ?? ''}:${disconnected[2] ?? ''}`;
      const login = logins.findLast(
        each => each.peer === peer && each.ended === undefined,
      );
      if (login !== undefined) {
        login.ended = timeOf(line);
      }
    }
  }
  return logins;
}

/**
 * The logins a kill took of its own: accepted from a second before the host pick to the kill's notice, and ended by
 * now. A kill's login is ended right after, and a login that is still up is the window that was killed reconnecting by
 * itself: it may be accepted before the notice is recorded, which a count of every login in that span takes for a
 * second login of the kill.
 */
export function killLoginsOf(
  logins: readonly HostLogin[],
  pick: number,
  notice: number,
): HostLogin[] {
  return logins.filter(
    login =>
      login.accepted >= pick - 1000 &&
      login.accepted <= notice &&
      login.ended !== undefined,
  );
}

/** The logins as a red says them: each one's acceptance and end, in milliseconds from the host pick. */
export function loginsText(logins: readonly HostLogin[], pick: number): string {
  return logins.length === 0
    ? 'no login'
    : logins
        .map(
          login =>
            `${login.peer} accepted ${String(login.accepted - pick)} ms, ${login.ended === undefined ? 'still up' : `ended ${String(login.ended - pick)} ms`}`,
        )
        .join('; ');
}
