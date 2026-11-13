import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  isForwardingLine,
  logSshLines,
  sshLogEntries,
  withoutAnswer,
} from '../../src/pipeline/ssh-log.ts';

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

  it('F-2003 BR-8: ssh’s own channel, forward and warning lines are told from the rest, with or without a carriage return', () => {
    deepStrictEqual(
      [
        'channel 3: open failed: administratively prohibited: open failed',
        'channel 12: open failed: connect failed: Connection refused\r',
        'connect_to localhost port 8080: failed.',
        'Warning: remote port forwarding failed for listen port 9000',
        'ls -l',
        'total 4',
        "printf 'LAYER1-READY\\n'",
        'a channel 3: not at the start',
      ].map(isForwardingLine),
      [true, true, true, true, false, false, false, false],
    );
  });

  it('F-2604 BR-2: a logger that takes the bare lines gets each one after it is logged, without its carriage return', () => {
    const taken: string[] = [];
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'trace'});
    logSshLines(
      {
        info: message => {
          logger.info(message);
        },
        trace: message => {
          logger.trace(message);
        },
        sshLines: lines => {
          taken.push(`${String(sink.lines.length)}:${lines.join('|')}`);
        },
      },
      ['first\r', 'second'],
      undefined,
    );
    deepStrictEqual(taken, ['1:first', '2:second']);
  });

  it('#2457, reading-2457-echo-line: a recognised prompt with the answer the terminal echoed after it shows the prompt and that the answer is not logged', () => {
    deepStrictEqual(
      [
        'Are you sure you want to continue connecting (yes/no/[fingerprint])? yes',
        'Verification code: 123456',
        "Enter passphrase for key '/home/a/.ssh/id_ed25519': hunter2",
        "alex@dev's password: hunter2",
        'Password: hunter2',
      ].map(withoutAnswer),
      [
        'Are you sure you want to continue connecting (yes/no/[fingerprint])? [answer not logged]',
        'Verification code: [answer not logged]',
        "Enter passphrase for key '/home/a/.ssh/id_ed25519': [answer not logged]",
        "alex@dev's password: [answer not logged]",
        'Password: [answer not logged]',
      ],
    );
  });

  it('#2457: a password prompt with no echo shows the same, and a line that holds no recognised prompt is as it is', () => {
    deepStrictEqual(
      [
        "alex@dev's password: ",
        'Authenticated to h ([127.0.0.1]:22) using "publickey".',
        'Are you sure you want to continue connecting',
        '',
      ].map(withoutAnswer),
      [
        "alex@dev's password: [answer not logged]",
        'Authenticated to h ([127.0.0.1]:22) using "publickey".',
        'Are you sure you want to continue connecting',
        '',
      ],
    );
  });

  it('#2457: only the start of a line is searched for a prompt: one inside the limit is found in a long line, one that ends past it is left as it is', () => {
    const padding = 'x'.repeat(2000);
    const prompt = 'Verification code:';
    deepStrictEqual(
      [
        withoutAnswer(`${prompt} ${padding}`),
        withoutAnswer(`${padding}${prompt} 123456`),
        withoutAnswer(':'.repeat(5000)),
      ],
      [
        `${prompt} [answer not logged]`,
        `${padding}${prompt} 123456`,
        ':'.repeat(5000),
      ],
    );
  });
});
