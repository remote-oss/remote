import {deepStrictEqual} from 'node:assert';
import {helperLogLineOf} from '../../src/diagnostics/helper-log.ts';

describe('the log line of the connection helper (card connect-130b)', () => {
  function ports(failure?: Error): {
    written: string[];
    appended: Array<[string, string]>;
    write: (text: string) => void;
    append: (file: string, text: string) => void;
  } {
    const written: string[] = [];
    const appended: Array<[string, string]> = [];
    return {
      written,
      appended,
      write: text => {
        written.push(text);
      },
      append: (file, text) => {
        if (failure !== undefined) {
          throw failure;
        }
        appended.push([file, text]);
      },
    };
  }

  it('writes to the error stream only, when there is no file', () => {
    const host = ports();
    helperLogLineOf(undefined, host)('line');
    deepStrictEqual([host.written, host.appended], [['line\n'], []]);
  });

  it('copies each line to the named file with the helper tag in an acceptance run', () => {
    const seen = ports();
    const logLine = helperLogLineOf('/run/log.txt', seen);
    logLine('first');
    logLine('second');
    deepStrictEqual(
      [seen.written, seen.appended],
      [
        ['first\n', 'second\n'],
        [
          ['/run/log.txt', '[helper] first\n'],
          ['/run/log.txt', '[helper] second\n'],
        ],
      ],
    );
  });

  it('goes on when the file cannot be written', () => {
    const seen = ports(new Error('ENOSPC'));
    helperLogLineOf('/run/log.txt', seen)('line');
    deepStrictEqual(seen.written, ['line\n']);
  });

  it('masks a run of 32 characters before the stream and the file get the line', () => {
    const seen = ports();
    const token = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
    helperLogLineOf('/run/log.txt', seen)(`the secret ${token} is here`);
    deepStrictEqual(
      [seen.written, seen.appended],
      [
        ['the secret [redacted] is here\n'],
        [['/run/log.txt', '[helper] the secret [redacted] is here\n']],
      ],
    );
  });
});
