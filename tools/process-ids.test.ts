import {deepStrictEqual} from 'node:assert';
import {processIdsOf} from './process-ids.ts';

describe('the process ids of a pgrep run', () => {
  it('coverage-14: are the numbers of its lines, in order', () => {
    deepStrictEqual(processIdsOf('4021\n17\n'), [4021, 17]);
  });

  it('coverage-14: leave out empty lines and lines that are not whole numbers', () => {
    deepStrictEqual(processIdsOf('\n 12 \nabc\n3x\n-4\n'), [12]);
  });

  it('coverage-14: are none for no output', () => {
    deepStrictEqual(processIdsOf(''), []);
  });
});
