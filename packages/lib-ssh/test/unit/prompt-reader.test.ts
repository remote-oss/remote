import {deepStrictEqual, strictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {
  isTerminalPrompt,
  PARTIAL_LINE_PAUSE_MILLISECONDS,
  PromptReader,
} from '../../src/index.ts';

/** The question line that closes the first-contact block. */
const FIRST_CONTACT_QUESTION =
  'Are you sure you want to continue connecting (yes/no/[fingerprint])? ';

/** The first-contact host-key question: three lines before the question, which closes it. */
const FIRST_CONTACT = [
  "Warning: Permanently added 'dev' (ED25519) to the list of known hosts.",
  'ED25519 key fingerprint is: SHA256:abcd',
  '',
  FIRST_CONTACT_QUESTION,
].join('\n');

/** The line that says the key exchange ended. */
const HANDSHAKE = 'debug1: SSH2_MSG_NEWKEYS received';

/** The connect timeout the reader is given in these rows. */
const TIMEOUT_MILLISECONDS = 15000;

/** `count` lines of output, numbered. */
function numberedLines(count: number): string[] {
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(`line ${String(index)}`);
  }
  return lines;
}

describe('the text of a terminal question', () => {
  it("F-2306 BR-2: a user's password question is a prompt", () => {
    strictEqual(isTerminalPrompt("alex@dev's password: "), true);
  });

  it('F-2306 BR-2: a plain password question is a prompt', () => {
    strictEqual(isTerminalPrompt('Password: '), true);
  });

  it('F-2306 BR-2: a verification code question is a prompt', () => {
    strictEqual(isTerminalPrompt('(alex@dev) Verification code: '), true);
  });

  it('F-2305 BR-2: the first-contact host-key block is a prompt', () => {
    strictEqual(isTerminalPrompt(FIRST_CONTACT), true);
  });

  it("F-2307 AC-23: a key's passphrase question is a prompt", () => {
    strictEqual(
      isTerminalPrompt("Enter passphrase for key '/home/a/.ssh/id_ed25519': "),
      true,
    );
  });

  it('F-2308 6.3: any other question is not a prompt', () => {
    strictEqual(isTerminalPrompt('Enter your OTP token: '), false);
  });

  it('F-2308 6.3: a line of login chatter is not a prompt', () => {
    strictEqual(
      isTerminalPrompt('Last login: Mon Oct 12 07:00:00 2026'),
      false,
    );
  });

  it('F-2308 6.3: only the last line of a question text counts', () => {
    strictEqual(isTerminalPrompt("alex@dev's password: \n$ "), false);
  });
});

describe('the prompt reader of the login terminal (F-2308)', () => {
  let clock: FakeClock;
  let questions: string[];
  let unreachable: number;
  let reader: PromptReader;

  /** A reader on a fake clock that counts its questions and its unreachable bound. */
  function makeReader(): PromptReader {
    clock = new FakeClock();
    questions = [];
    unreachable = 0;
    return new PromptReader(clock.scheduler(), TIMEOUT_MILLISECONDS, {
      onQuestion: text => questions.push(text),
      onUnreachable: () => {
        unreachable += 1;
      },
    });
  }

  beforeEach(() => {
    reader = makeReader();
  });

  it('F-2308 BR-4: a question waiting at the end is reported once the output pauses', () => {
    reader.push("alex@dev's password: ");
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, ["alex@dev's password: "]);
  });

  it('#299: the question is not reported before the pause is over', () => {
    reader.push("alex@dev's password: ");
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS - 1);
    deepStrictEqual(questions, []);
  });

  it('#299: a question in two pieces is reported whole', () => {
    reader.push("alex@dev's pa");
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    reader.push('ssword: ');
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, ["alex@dev's password: "]);
  });

  it('F-2305 BR-2: the host-key question is reported with its lines before it', () => {
    const lines = FIRST_CONTACT.split('\n').slice(0, 3);
    reader.push(`${lines.join('\n')}\n`);
    reader.push(FIRST_CONTACT_QUESTION);
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, [FIRST_CONTACT]);
  });

  it('#299: the candidate holds the last twenty lines and the partial line', () => {
    const lines = numberedLines(25);
    reader.push(`${lines.join('\n')}\n`);
    reader.push('Password: ');
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, [
      [...lines.slice(-20), 'Password: '].join('\n'),
    ]);
  });

  it('#299: after a question, the lines before it do not stand behind the next one', () => {
    reader.push('first line\n');
    reader.push("alex@dev's password: ");
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    reader.inputOpened();
    reader.inputClosed();
    reader.push('second line\n');
    reader.push('Password: ');
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, [
      "first line\nalex@dev's password: ",
      'second line\nPassword: ',
    ]);
  });

  it('F-2308 6.3: an unrecognised question at the end reports nothing', () => {
    reader.push('Enter your OTP token: ');
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, []);
  });

  it('#299: a reported question is not reported twice', () => {
    reader.push("alex@dev's password: ");
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, ["alex@dev's password: "]);
  });

  it('#299: the same partial line is not tried again after a further pause', () => {
    reader.push("alex@dev's password: ");
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    reader.push('');
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, ["alex@dev's password: "]);
  });

  it('F-2308 BR-6: output pushed while an input is open is held', () => {
    reader.inputOpened();
    reader.push('Password: ');
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, []);
  });

  it('F-2308 BR-6: held output is read when the input closes', () => {
    reader.inputOpened();
    reader.push('Password: ');
    reader.inputClosed();
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, ['Password: ']);
  });

  it('F-2306 BR-7: an open input has no bound', () => {
    reader.push(`${HANDSHAKE}\n`);
    reader.inputOpened();
    clock.advance(10 * TIMEOUT_MILLISECONDS);
    deepStrictEqual(unreachable, 0);
  });

  it('#299 ruling 1(b): after the handshake, an unreachable question is bounded', () => {
    reader.push(`${HANDSHAKE}\n`);
    reader.push('Enter your OTP token: ');
    clock.advance(TIMEOUT_MILLISECONDS);
    deepStrictEqual(unreachable, 1);
  });

  it('#299 ruling 1(b): before the handshake, ssh owns the bound', () => {
    reader.push('Enter your OTP token: ');
    clock.advance(TIMEOUT_MILLISECONDS);
    deepStrictEqual(unreachable, 0);
  });

  it('#299 ruling 1(b): output re-arms the bound', () => {
    reader.push(`${HANDSHAKE}\n`);
    reader.push('Enter your OTP token: ');
    clock.advance(TIMEOUT_MILLISECONDS - 1);
    reader.push('more');
    clock.advance(TIMEOUT_MILLISECONDS - 1);
    deepStrictEqual(unreachable, 0);
  });

  it('#299 ruling 1(b): a silent terminal with no question waits nothing', () => {
    reader.push(`${HANDSHAKE}\n`);
    clock.advance(2 * TIMEOUT_MILLISECONDS);
    deepStrictEqual(unreachable, 0);
  });

  it('#299 ruling 1(b): nothing is counted while an input is open', () => {
    reader.push(`${HANDSHAKE}\n`);
    reader.inputOpened();
    clock.advance(2 * TIMEOUT_MILLISECONDS);
    reader.inputClosed();
    reader.push('Enter your OTP token: ');
    clock.advance(TIMEOUT_MILLISECONDS);
    deepStrictEqual(unreachable, 1);
  });

  it('#299 ruling 1(b): the unreachable bound fires once', () => {
    reader.push(`${HANDSHAKE}\n`);
    reader.push('Enter your OTP token: ');
    clock.advance(TIMEOUT_MILLISECONDS);
    reader.push('more');
    clock.advance(TIMEOUT_MILLISECONDS);
    deepStrictEqual(unreachable, 1);
  });

  it('#299 ruling 1(b): a reachable question does not trip the bound', () => {
    reader.push(`${HANDSHAKE}\n`);
    reader.push("alex@dev's password: ");
    clock.advance(TIMEOUT_MILLISECONDS);
    deepStrictEqual(
      [questions, unreachable],
      [[`${HANDSHAKE}\nalex@dev's password: `], 0],
    );
  });

  it('contracts: nothing is reported after stop', () => {
    reader.stop();
    reader.push('Password: ');
    clock.advance(PARTIAL_LINE_PAUSE_MILLISECONDS);
    deepStrictEqual(questions, []);
  });

  it('contracts: stop takes effect before any later call', () => {
    reader.stop();
    reader.inputOpened();
    reader.inputClosed();
    reader.push('Password: ');
    clock.advance(100000);
    deepStrictEqual([questions, unreachable], [[], 0]);
  });

  it('contracts: stop cancels the timers, and nothing fires afterwards', () => {
    reader.push("alex@dev's password: ");
    reader.stop();
    clock.advance(100000);
    deepStrictEqual([questions, unreachable], [[], 0]);
  });
});
