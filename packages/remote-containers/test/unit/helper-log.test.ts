import {deepStrictEqual} from 'node:assert';
import {helperLogOf} from '../../src/shutdown/helper-log.ts';

/** The writer over fakes that record what they were given, and whether the file append fails. */
function writerOver(failing = false) {
  const written: string[] = [];
  const write = helperLogOf({
    stderr: text => written.push(`stderr ${text}`),
    append: (file, text) => {
      if (failing) {
        throw new Error('disk full');
      }
      written.push(`${file} ${text}`);
    },
    clock: () => Date.UTC(2026, 10, 5, 1, 2, 3, 4),
  });
  return {write, written};
}

describe('the helper’s log lines (card containers-186, F-0104 BR-4)', () => {
  it('F-0104 BR-4: a line goes to the error stream, and with a file also there with its time', () => {
    const seen = writerOver();
    seen.write('docker stop failed');
    seen.write('container is in use', '/logs/shutdownMonitor-x.log');
    deepStrictEqual(seen.written, [
      'stderr docker stop failed\n',
      'stderr container is in use\n',
      '/logs/shutdownMonitor-x.log 2026-11-05T01:02:03.004Z [info] container is in use\n',
    ]);
  });

  it('F-0104 BR-4: a file that cannot be written does not stop the line reaching the error stream', () => {
    const seen = writerOver(true);
    seen.write('line', '/logs/shutdownMonitor-x.log');
    deepStrictEqual(seen.written, ['stderr line\n']);
  });
});
