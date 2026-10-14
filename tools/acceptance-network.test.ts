import {deepStrictEqual} from 'node:assert';
import {throws} from 'node:assert';
import {
  cutNetwork,
  cutRoute,
  restoreNetwork,
  restoreRoute,
} from './acceptance-network.ts';
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

/** The rules of the two route cuts for the address 10.1.2.3, as `iptables` prints them after the chain. */
const REJECT_RULE =
  'INPUT -d 10.1.2.3 -p tcp --dport 22 -j REJECT --reject-with icmp-host-unreachable';
const SYN_DROP_RULE = 'INPUT -d 10.1.2.3 -p tcp --dport 22 --syn -j DROP';

/** A container whose `iptables` holds the rules in `held` (chain and match, joined) and records each change. */
function containerHoldingRules(held: string[] = [], refused: string[] = []) {
  const rules = new Set(held);
  const changes: string[] = [];

  function command(tool: string, argv: readonly string[]): CommandResult {
    const [, , , flag, ...rule] = argv;
    const text = rule.join(' ');
    if (refused.includes(flag ?? '')) {
      return {
        status: 4,
        stdout: '',
        stderr: 'Permission denied (you must be root)',
      };
    }
    if (flag === '-C') {
      return {status: rules.has(text) ? 0 : 1, stdout: '', stderr: ''};
    }
    changes.push(`${flag ?? ''} ${text}`);
    if (flag === '-I') {
      rules.add(text);
    } else {
      rules.delete(text);
    }
    return {status: 0, stdout: '', stderr: ''};
  }

  return {command, changes, rules};
}

describe('cutRoute (card tooling-47)', () => {
  it('tooling-47: an unreachable cut inserts the REJECT rule for the address', () => {
    const container = containerHoldingRules();
    cutRoute(container.command, 'c0ffee', '10.1.2.3', 'unreachable');
    deepStrictEqual(container.changes, [`-I ${REJECT_RULE}`]);
  });

  it('tooling-47: a silent cut inserts the SYN DROP rule for the address', () => {
    const container = containerHoldingRules();
    cutRoute(container.command, 'c0ffee', '10.1.2.3', 'silent');
    deepStrictEqual(container.changes, [`-I ${SYN_DROP_RULE}`]);
  });

  it('tooling-47: a cut held already inserts nothing', () => {
    const container = containerHoldingRules([REJECT_RULE]);
    cutRoute(container.command, 'c0ffee', '10.1.2.3', 'unreachable');
    deepStrictEqual(container.changes, []);
  });

  it('tooling-47: switching from unreachable to silent deletes the REJECT rule first', () => {
    const container = containerHoldingRules([REJECT_RULE]);
    cutRoute(container.command, 'c0ffee', '10.1.2.3', 'silent');
    deepStrictEqual(container.changes, [
      `-D ${REJECT_RULE}`,
      `-I ${SYN_DROP_RULE}`,
    ]);
  });

  it('tooling-47: a cut leaves exactly one rule after a switch back and forth', () => {
    const container = containerHoldingRules();
    cutRoute(container.command, 'c0ffee', '10.1.2.3', 'silent');
    cutRoute(container.command, 'c0ffee', '10.1.2.3', 'unreachable');
    deepStrictEqual([...container.rules], [REJECT_RULE]);
  });

  it("tooling-47: a refused rule throws with iptables' error", () => {
    const container = containerHoldingRules([], ['-I']);
    throws(() => {
      cutRoute(container.command, 'c0ffee', '10.1.2.3', 'silent');
    }, /-I INPUT .* Permission denied/);
  });
});

describe('restoreRoute (card tooling-47)', () => {
  it('tooling-47: restoreRoute deletes the held rules and nothing else', () => {
    const container = containerHoldingRules([
      SYN_DROP_RULE,
      'OUTPUT -j ACCEPT',
    ]);
    restoreRoute(container.command, 'c0ffee', '10.1.2.3');
    deepStrictEqual(
      [container.changes, [...container.rules]],
      [[`-D ${SYN_DROP_RULE}`], ['OUTPUT -j ACCEPT']],
    );
  });

  it('tooling-47: restoreRoute deletes both rules when both are held, and nothing when neither is', () => {
    const both = containerHoldingRules([REJECT_RULE, SYN_DROP_RULE]);
    restoreRoute(both.command, 'c0ffee', '10.1.2.3');
    const none = containerHoldingRules();
    restoreRoute(none.command, 'c0ffee', '10.1.2.3');
    deepStrictEqual(
      [both.changes, none.changes],
      [[`-D ${REJECT_RULE}`, `-D ${SYN_DROP_RULE}`], []],
    );
  });

  it("tooling-47: a refused delete throws with iptables' error", () => {
    const container = containerHoldingRules([REJECT_RULE], ['-D']);
    throws(() => {
      restoreRoute(container.command, 'c0ffee', '10.1.2.3');
    }, /-D INPUT .* Permission denied/);
  });
});
