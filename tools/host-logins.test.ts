import {deepStrictEqual} from 'node:assert';
import {
  hostLoginsOf,
  killLoginsOf,
  loginsText,
} from '../tests/acceptance/windows/host-logins.ts';

/** A `docker logs --timestamps` line of the host's sshd at `ms` milliseconds after a fixed second. */
function line(millis: number, text: string): string {
  return `${new Date(BASE + millis).toISOString().replace('Z', '000000Z')} ${text}`;
}
const BASE = Date.UTC(2026, 10, 27, 1, 38, 28, 0);
/** The line sshd logs when it accepts the key login from port `port`. */
function accepted(port: number): string {
  return `Accepted publickey for harness from 172.17.0.1 port ${String(port)} ssh2: ED25519 SHA256:x`;
}

/** The line sshd logs when the login from port `port` disconnects. */
function ended(port: number): string {
  return `Disconnected from user harness 172.17.0.1 port ${String(port)}`;
}

describe('the key logins of the host’s sshd and the kill’s own (card #3275, F-2411 AC-33)', () => {
  it('#3275: each accepted login is paired with its own disconnect by address and port, in the order accepted, and a login still up has no end', () => {
    deepStrictEqual(
      hostLoginsOf([
        line(0, 'Server listening on 0.0.0.0 port 22.'),
        line(10, accepted(60444)),
        line(
          20,
          'Received disconnect from 172.17.0.1 port 56474:11: disconnected by user',
        ),
        line(30, ended(56474)),
        line(40, ended(60444)),
        line(50, accepted(60450)),
      ]),
      [
        {peer: '172.17.0.1:60444', accepted: BASE + 10, ended: BASE + 40},
        {peer: '172.17.0.1:60450', accepted: BASE + 50},
      ],
    );
  });

  it('#3275: a port used again names its own login, and a disconnect of a login before the lines is no login', () => {
    deepStrictEqual(
      hostLoginsOf([
        line(0, ended(1)),
        line(10, accepted(7)),
        line(20, ended(7)),
        line(30, accepted(7)),
        line(40, ended(7)),
      ]),
      [
        {peer: '172.17.0.1:7', accepted: BASE + 10, ended: BASE + 20},
        {peer: '172.17.0.1:7', accepted: BASE + 30, ended: BASE + 40},
      ],
    );
  });

  it('#3275: the kill’s own login is the one accepted from a second before the pick to the notice that has ended; the window’s reconnect, still up, is not, even when it is accepted before the notice is recorded', () => {
    const pick = BASE + 100;
    const notice = BASE + 400;
    const logins = hostLoginsOf([
      line(270, accepted(1)),
      line(380, accepted(2)),
      line(390, ended(1)),
    ]);
    deepStrictEqual(killLoginsOf(logins, pick, notice), [
      {peer: '172.17.0.1:1', accepted: BASE + 270, ended: BASE + 390},
    ]);
  });

  it('#3275: two logins of the kill that both ended are two, a login before the pick’s second or after the notice is not the kill’s', () => {
    const pick = BASE + 5000;
    const notice = BASE + 6000;
    const logins = hostLoginsOf([
      line(3900, accepted(1)),
      line(3950, ended(1)),
      line(4100, accepted(2)),
      line(4200, ended(2)),
      line(5300, accepted(3)),
      line(5400, ended(3)),
      line(6100, accepted(4)),
      line(6150, ended(4)),
    ]);
    deepStrictEqual(
      killLoginsOf(logins, pick, notice).map(login => login.peer),
      ['172.17.0.1:2', '172.17.0.1:3'],
    );
  });

  it('#3275: the logins read as a red says them, from the pick, and none says so', () => {
    deepStrictEqual(
      [
        loginsText(
          [
            {peer: 'a:1', accepted: 70, ended: 300},
            {peer: 'a:2', accepted: 420},
          ],
          0,
        ),
        loginsText([], 0),
      ],
      [
        'a:1 accepted 70 ms, ended 300 ms; a:2 accepted 420 ms, still up',
        'no login',
      ],
    );
  });
});
