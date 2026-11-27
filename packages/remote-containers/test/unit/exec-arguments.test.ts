import {TREE_KILL_SCRIPT} from 'lib-host';
import {deepStrictEqual} from 'node:assert';
import {
  copyArguments,
  dialArguments,
  isEnvironmentName,
  scriptArguments,
  treeKillArguments,
} from '../../src/exec/exec-arguments.ts';

describe('the docker exec arguments (card containers-02)', () => {
  it('contracts §1: a script runs through the prelude as the user, the variables passed by name alone, the byte count the only part of the script in the arguments', () => {
    deepStrictEqual(
      scriptArguments('c1', 'node', ['A', 'B_2'], 42, 'echo front; '),
      [
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
        'echo front; eval "$(dd bs=1 count=42 2>/dev/null)"',
      ],
    );
  });

  it('ruling-3269: the tree-kill exec runs lib-host’s script as the container’s user, with the shell’s id as its one argument', () => {
    deepStrictEqual(treeKillArguments('c1', 'node', 4242), [
      'exec',
      '--user',
      'node',
      'c1',
      'sh',
      '-c',
      TREE_KILL_SCRIPT,
      'tree-kill',
      '4242',
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
