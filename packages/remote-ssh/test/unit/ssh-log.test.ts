import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {logSshLines, sshLogEntries} from '../../src/pipeline/ssh-log.ts';

const LINES = [
  'debug1: Reading configuration data /x',
  'debug1: Server host key: ssh-ed25519 SHA256:abc',
  'debug1: Next authentication method: publickey',
  'Authenticated to h ([127.0.0.1]:22) using "publickey".',
  "Warning: Permanently added 'h' (ED25519) to the list of known hosts.",
];

/** What the log holds at `level` after `lines` are logged. */
function loggedAt(
  level: Level,
  lines: readonly string[],
  token?: string,
): string[] {
  const sink = new MemorySink();
  logSshLines(createLogger(sink, {minimumLevel: () => level}), lines, token);
  return sink.lines.map(line => line.message);
}

describe('ssh’s lines in the log (card connect-66)', () => {
  it('F-2003 BR-8: at debug only the host-key debug1 line is kept', () => {
    deepStrictEqual(loggedAt('debug', LINES), [
      '[ssh] debug1: Server host key: ssh-ed25519 SHA256:abc',
      '[ssh] Authenticated to h ([127.0.0.1]:22) using "publickey".',
      "[ssh] Warning: Permanently added 'h' (ED25519) to the list of known hosts.",
    ]);
  });

  it('F-2003 BR-9 point 1: at trace every line is kept, in order', () => {
    deepStrictEqual(
      loggedAt('trace', LINES),
      LINES.map(line => `[ssh] ${line}`),
    );
  });

  it('F-2003 BR-14: the token is masked in every occurrence', () => {
    deepStrictEqual(
      loggedAt('debug', ['Warning: ab12-cd34 and ab12-cd34'], 'ab12-cd34'),
      ['[ssh] Warning: aa11-aa11 and aa11-aa11'],
    );
  });

  it('F-2003 BR-6 item 6: a carriage return at the end of a line is not logged, and the level of each entry is its own', () => {
    deepStrictEqual(
      sshLogEntries(
        ['debug1: x\r', 'ssh: connect to host h port 22: Connection refused\r'],
        undefined,
      ),
      [
        {level: 'trace', text: '[ssh] debug1: x'},
        {
          level: 'info',
          text: '[ssh] ssh: connect to host h port 22: Connection refused',
        },
      ],
    );
  });
});
