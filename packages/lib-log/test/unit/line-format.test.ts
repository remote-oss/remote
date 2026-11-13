import {strictEqual} from 'node:assert';
import {colouredLineOf, type LogLine, plainLineOf} from '../../src/index.ts';

const GREEN_CODE = '\u001b[32m';
const RED_CODE = '\u001b[31m';
const RESET_CODE = '\u001b[0m';

/** A line of `message` at `time`. */
function lineAt(time: string, message: string): LogLine {
  return {level: 'info', scope: [], message, time: Date.parse(time)};
}

describe('the line formats of the file and terminal sinks (card wsl-10)', () => {
  it('wsl-10: the plain format is the UTC time to the millisecond and the message', () => {
    strictEqual(
      plainLineOf(lineAt('2026-11-13T09:05:07.042Z', 'hello')),
      '[2026-11-13 09:05:07.042] hello',
    );
  });

  it('wsl-10: the time is UTC across a date change', () => {
    strictEqual(
      plainLineOf(lineAt('2026-12-31T23:59:59.999+02:00', 'late')),
      '[2026-12-31 21:59:59.999] late',
    );
  });

  it('wsl-10: the timestamp digits of the terminal format are green and the message is the terminal’s own colour', () => {
    strictEqual(
      colouredLineOf(lineAt('2026-11-13T09:05:07.042Z', 'hello')),
      `[${GREEN_CODE}2026-11-13 09:05:07.042${RESET_CODE}] hello`,
    );
  });

  it('wsl-10: a line from the standard error stream is red, by its tag', () => {
    strictEqual(
      colouredLineOf({
        ...lineAt('2026-11-13T09:05:07.042Z', 'oops'),
        stream: 'stderr',
      }),
      `[${GREEN_CODE}2026-11-13 09:05:07.042${RESET_CODE}] ${RED_CODE}oops${RESET_CODE}`,
    );
  });

  it('wsl-10: a line from the standard output stream is not red', () => {
    strictEqual(
      colouredLineOf({
        ...lineAt('2026-11-13T09:05:07.042Z', 'fine'),
        stream: 'stdout',
      }),
      `[${GREEN_CODE}2026-11-13 09:05:07.042${RESET_CODE}] fine`,
    );
  });

  it('wsl-10: a message that looks like an error is not red, and a colour code in it is written as its code point', () => {
    strictEqual(
      colouredLineOf(lineAt('2026-11-13T09:05:07.042Z', 'error: \u001b[31mx')),
      `[${GREEN_CODE}2026-11-13 09:05:07.042${RESET_CODE}] error: \\u{1b}[31mx`,
    );
  });

  it('wsl-10: a named secret and a long run are redacted', () => {
    const line = lineAt(
      '2026-11-13T09:05:07.042Z',
      `token abc and ${'z'.repeat(40)}`,
    );
    strictEqual(
      plainLineOf(line, ['abc']),
      '[2026-11-13 09:05:07.042] token [redacted] and [redacted]',
    );
  });
});
