import {deepStrictEqual} from 'node:assert';
import {throws} from 'node:assert';
import {cutNetwork, restoreNetwork} from './acceptance-network.ts';
import {type CommandResult} from './command-runner.ts';

/** A container whose `iptables` holds the chains in `held` and records each change of the rules. */
function containerHolding(held: string[] = [], refused: string[] = []) {
  const chains = new Set(held);
  const changes: string[] = [];

  function command(program: string, argv: readonly string[]): CommandResult {
    const [, container, tool, flag, chain] = argv;
    const holds = chains.has(chain ?? '');
    if (refused.includes(flag ?? '')) {
      return {
        status: 4,
        stdout: '',
        stderr: 'Permission denied (you must be root)',
      };
    }
    if (flag === '-I' || flag === '-D') {
      changes.push(`${flag} ${chain ?? ''}`);
      if (flag === '-I') {
        chains.add(chain ?? '');
      } else {
        chains.delete(chain ?? '');
      }
    }
    const asked = `${program} ${argv[0] ?? ''} ${container ?? ''} ${tool ?? ''}`;
    const status =
      asked === 'docker exec c0ffee iptables' && (flag !== '-C' || holds)
        ? 0
        : 1;
    return {status, stdout: '', stderr: ''};
  }

  return {command, changes, chains};
}

describe('cutNetwork', () => {
  it('D-85: inserts a drop rule for the packets that arrive and one for those that leave', () => {
    const container = containerHolding();
    cutNetwork(container.command, 'c0ffee');
    deepStrictEqual(container.changes, ['-I INPUT', '-I OUTPUT']);
  });

  it('D-85: inserts nothing when both rules are in place', () => {
    const container = containerHolding(['INPUT', 'OUTPUT']);
    cutNetwork(container.command, 'c0ffee');
    deepStrictEqual(container.changes, []);
  });

  it('D-85: inserts only the rule that is missing', () => {
    const container = containerHolding(['INPUT']);
    cutNetwork(container.command, 'c0ffee');
    deepStrictEqual(container.changes, ['-I OUTPUT']);
  });
});

describe('cutNetwork, when iptables refuses', () => {
  it('D-85: a refused insert throws, naming the chain and the error', () => {
    const container = containerHolding([], ['-I']);
    throws(() => {
      cutNetwork(container.command, 'c0ffee');
    }, /-I INPUT .* Permission denied/);
  });
});

describe('restoreNetwork', () => {
  it('D-85: deletes both drop rules', () => {
    const container = containerHolding(['INPUT', 'OUTPUT']);
    restoreNetwork(container.command, 'c0ffee');
    deepStrictEqual(container.changes, ['-D INPUT', '-D OUTPUT']);
  });

  it('D-85: deletes nothing when nothing was cut', () => {
    const container = containerHolding();
    restoreNetwork(container.command, 'c0ffee');
    deepStrictEqual(container.changes, []);
  });

  it('D-85: leaves no rule after a cut and a restore', () => {
    const container = containerHolding();
    cutNetwork(container.command, 'c0ffee');
    restoreNetwork(container.command, 'c0ffee');
    deepStrictEqual([...container.chains], []);
  });
});

describe('restoreNetwork, when iptables refuses', () => {
  it('D-85: a refused delete throws, naming the chain and the error', () => {
    const container = containerHolding(['INPUT', 'OUTPUT'], ['-D']);
    throws(() => {
      restoreNetwork(container.command, 'c0ffee');
    }, /-D INPUT .* Permission denied/);
  });
});
