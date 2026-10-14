import {deepStrictEqual} from 'node:assert';
import {
  copyArguments,
  dialArguments,
  isEnvironmentName,
  scriptArguments,
} from '../../src/exec/exec-arguments.ts';

describe('the docker exec arguments (card containers-02)', () => {
  it('contracts §1: a script runs through the prelude as the user, the variables passed by name alone, the byte count the only part of the script in the arguments', () => {
    deepStrictEqual(scriptArguments('c1', 'node', ['A', 'B_2'], 42), [
      'exec',
      '-i',
      '--user',
      'node',
      '-e',
      'A',
      '-e',
      'B_2',
      'c1',
      'sh',
      '-c',
      'eval "$(dd bs=1 count=42 2>/dev/null)"',
    ]);
  });

  it('contracts §1: a copy unpacks into the directory, which stays one element', () => {
    deepStrictEqual(copyArguments('c1', 'node', '/tmp/x y'), [
      'exec',
      '-i',
      '--user',
      'node',
      'c1',
      'tar',
      '-x',
      '-f',
      '-',
      '-C',
      '/tmp/x y',
    ]);
  });

  it('contracts §1: a dial runs the relay script with the installed node and the port', () => {
    deepStrictEqual(
      dialArguments('c1', 'node', '/srv/node', '/d/relay-abc.js', 41000),
      [
        'exec',
        '-i',
        '--user',
        'node',
        'c1',
        '/srv/node',
        '/d/relay-abc.js',
        '41000',
      ],
    );
  });

  it('contracts §1: a variable name is letters, digits and underscores, not starting with a digit', () => {
    deepStrictEqual(
      ['A', '_b1', 'A-B', '1A', '', 'a b'].map(isEnvironmentName),
      [true, true, false, false, false, false],
    );
  });
});
