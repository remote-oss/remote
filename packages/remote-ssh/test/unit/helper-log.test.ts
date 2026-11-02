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

  it('writes to the error stream only, when the harness switch or the file is missing', () => {
    const environments = [
      {REMOTE_OSS_ACCEPTANCE_LOG: '/run/log.txt'},
      {REMOTE_OSS_ACCEPTANCE: '1'},
      {REMOTE_OSS_ACCEPTANCE: '1', REMOTE_OSS_ACCEPTANCE_LOG: ''},
    ];
    const seen = environments.map(environment => {
      const host = ports();
      helperLogLineOf(environment, host)('line');
      return [host.written, host.appended];
    });
    deepStrictEqual(seen, [
      [['line\n'], []],
      [['line\n'], []],
      [['line\n'], []],
    ]);
  });

  it('copies each line to the named file with the helper tag in an acceptance run', () => {
    const seen = ports();
    const logLine = helperLogLineOf(
      {REMOTE_OSS_ACCEPTANCE: '1', REMOTE_OSS_ACCEPTANCE_LOG: '/run/log.txt'},
      seen,
    );
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
    helperLogLineOf(
      {REMOTE_OSS_ACCEPTANCE: '1', REMOTE_OSS_ACCEPTANCE_LOG: '/run/log.txt'},
      seen,
    )('line');
    deepStrictEqual(seen.written, ['line\n']);
  });
});
