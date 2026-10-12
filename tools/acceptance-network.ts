/**
 * @fileoverview acceptance-network: cuts the harness host's network the way a lost network is cut, and brings it back.
 * The packets of port 22 are dropped inside the container, as root through `docker exec`, with no reset: an open
 * session stalls, and a new connection gets no answer. The container runs with NET_ADMIN and its image has `iptables`.
 */

import {type CommandRunner} from './acceptance-run.ts';

/** The two rules that drop the packets of the host's port 22: those arriving and those leaving. */
const DROP_RULES: ReadonlyArray<{chain: string; match: readonly string[]}> = [
  {chain: 'INPUT', match: ['-p', 'tcp', '--dport', '22', '-j', 'DROP']},
  {chain: 'OUTPUT', match: ['-p', 'tcp', '--sport', '22', '-j', 'DROP']},
];

/** Runs `iptables` in the container, as root; the result says whether it succeeded. */
function iptables(
  command: CommandRunner,
  container: string,
  programArguments: readonly string[],
): boolean {
  return (
    command('docker', ['exec', container, 'iptables', ...programArguments])
      .status === 0
  );
}

/** Cuts the network of the container. Cutting twice is harmless. */
export function cutNetwork(command: CommandRunner, container: string): void {
  for (const {chain, match} of DROP_RULES) {
    if (!iptables(command, container, ['-C', chain, ...match])) {
      iptables(command, container, ['-I', chain, ...match]);
    }
  }
}

/** Brings the network of the container back on the same port. Restoring twice, or when nothing was cut, is harmless. */
export function restoreNetwork(
  command: CommandRunner,
  container: string,
): void {
  for (const {chain, match} of DROP_RULES) {
    if (iptables(command, container, ['-C', chain, ...match])) {
      iptables(command, container, ['-D', chain, ...match]);
    }
  }
}
