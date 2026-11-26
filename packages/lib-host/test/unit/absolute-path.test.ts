import {deepStrictEqual} from 'node:assert';
import {ABSOLUTE_HOST_PATH} from '../../src/index.ts';

describe('the absolute forms of a host path', () => {
  it('a POSIX root or a Windows drive with its separator is absolute, and a drive alone, a relative path and the empty text are not', () => {
    deepStrictEqual(
      ['/x', 'C:\\vs', 'C:/vs', 'c:\\', 'C:foo', 'C:', 'foo', '', '~/x'].map(
        value => ABSOLUTE_HOST_PATH.test(value),
      ),
      [true, true, true, true, false, false, false, false, false],
    );
  });
});
