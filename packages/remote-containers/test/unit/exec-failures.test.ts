import {deepStrictEqual} from 'node:assert';
import {exitOutcome} from '../../src/exec/exec-failures.ts';

const STOPPED = 'Error response from daemon: container c1 is not running';
const MISSING = 'Error: No such container: c1';

function failure(kind: string, detail: string) {
  return {kind: 'failed', failure: {kind, detail}};
}

describe('what a finished docker exec means (card containers-02)', () => {
  it('contracts §5: a daemon error line is a closed channel, with the daemon lines as the detail', () => {
    deepStrictEqual(
      exitOutcome(1, `${STOPPED}\nother`, 'script'),
      failure('channelClosed', STOPPED),
    );
  });

  it('contracts §5: no such container is a closed channel', () => {
    deepStrictEqual(
      exitOutcome(1, MISSING, 'copy'),
      failure('channelClosed', MISSING),
    );
  });

  it('contracts §5: a line saying the container is not running is a closed channel', () => {
    deepStrictEqual(
      exitOutcome(137, 'cannot exec: container is not running', 'script'),
      failure('channelClosed', 'cannot exec: container is not running'),
    );
  });

  it('contracts §5: status 125 is a closed channel with the last stderr line', () => {
    deepStrictEqual(
      exitOutcome(125, 'first\nlast one\n', 'script'),
      failure('channelClosed', 'last one'),
    );
  });

  it('contracts §5: status 125 with no stderr says docker exit 125', () => {
    deepStrictEqual(
      exitOutcome(125, '', 'script'),
      failure('channelClosed', 'docker exit 125'),
    );
  });

  it('contracts §5: a signal is a closed channel', () => {
    deepStrictEqual(
      exitOutcome(undefined, '', 'copy'),
      failure('channelClosed', 'docker ended by a signal'),
    );
  });

  it('contracts §5: a copy that ends with 127 or 126 found no runnable tar', () => {
    deepStrictEqual(
      [127, 126].map(status =>
        exitOutcome(status, 'sh: tar: not found', 'copy'),
      ),
      [
        failure('copyToolMissing', 'sh: tar: not found'),
        failure('copyToolMissing', 'sh: tar: not found'),
      ],
    );
  });

  it('contracts §5: a copy tool missing with no stderr names the status', () => {
    deepStrictEqual(
      exitOutcome(127, '', 'copy'),
      failure('copyToolMissing', 'tar exit 127'),
    );
  });

  it('contracts §5: a copy with any other failing status failed', () => {
    deepStrictEqual(
      exitOutcome(2, 'tar: write error', 'copy'),
      failure('copyFailed', 'tar: write error'),
    );
  });

  it('contracts §5: a copy that ends with a failing status and no stderr names the status', () => {
    deepStrictEqual(
      exitOutcome(2, '', 'copy'),
      failure('copyFailed', 'tar exit 2'),
    );
  });

  it('contracts §5: a copy that ends with 0 is copied', () => {
    deepStrictEqual(exitOutcome(0, '', 'copy'), {kind: 'copied'});
  });

  it('contracts §5: a script that ends with any other status, 0 included, exited with it', () => {
    deepStrictEqual(
      [0, 1, 127].map(status => exitOutcome(status, 'oops', 'script')),
      [
        {kind: 'exited', status: 0},
        {kind: 'exited', status: 1},
        {kind: 'exited', status: 127},
      ],
    );
  });
});
