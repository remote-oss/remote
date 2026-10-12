/**
 * @fileoverview acceptance-network: cuts the harness host's network the way a lost network is cut, and brings it back.
 * The packets of port 22 are dropped inside the container, as root through `docker exec`, with no reset: an open
 * session stalls, and a new connection gets no answer. The container runs with NET_ADMIN and its image has `iptables`.
 */

import {checked, type CommandRunner} from './acceptance-run.ts';

/** The two rules that drop the packets of the host's port 22: those arriving and those leaving. */
const DROP_RULES: ReadonlyArray<{chain: string; match: readonly string[]}> = [
  {chain: 'INPUT', match: ['-p', 'tcp', '--dport', '22', '-j', 'DROP']},
  {chain: 'OUTPUT', match: ['-p', 'tcp', '--sport', '22', '-j', 'DROP']},
];

/** The arguments of `docker exec` that run `iptables` in the container, as root. */
function iptablesCommand(
  container: string,
  programArguments: readonly string[],
): string[] {
  return ['exec', container, 'iptables', ...programArguments];
}

/** Whether the container holds the rule; `iptables -C` fails when it does not. */
function holdsRule(
  command: CommandRunner,
  container: string,
  {chain, match}: {chain: string; match: readonly string[]},
): boolean {
  return (
    command('docker', iptablesCommand(container, ['-C', chain, ...match]))
      .status === 0
  );
}

/** Cuts the network of the container; it throws, naming the chain and the error of `iptables`, when a rule is refused. Cutting twice is harmless. */
export function cutNetwork(command: CommandRunner, container: string): void {
  for (const rule of DROP_RULES) {
    if (!holdsRule(command, container, rule)) {
      checked(
        command,
        'docker',
        iptablesCommand(container, ['-I', rule.chain, ...rule.match]),
      );
    }
  }
}

/** Brings the network of the container back on the same port; it throws as `cutNetwork` does. Restoring twice, or when nothing was cut, is harmless. */
export function restoreNetwork(
  command: CommandRunner,
  container: string,
): void {
  for (const rule of DROP_RULES) {
    if (holdsRule(command, container, rule)) {
      checked(
        command,
        'docker',
        iptablesCommand(container, ['-D', rule.chain, ...rule.match]),
      );
    }
  }
}
