/**
 * @fileoverview acceptance-network: cuts the harness host's network the way a lost network is cut, and brings it back.
 * Two kinds of cut, both inside the container, as root through `docker exec`. The network cut drops the packets of
 * port 22 with no reset: an open session stalls, and a new connection gets no answer. The route cut is scoped to the
 * host's own address on the run network, so Docker's published port keeps working: it refuses the connect as
 * unreachable (ssh says "No route to host") or drops the SYN (ssh says "Connection timed out"). The container runs
 * with NET_ADMIN and its image has `iptables`.
 */

import {checked, type CommandRunner} from './command-runner.ts';

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

/** Inserts the rule at the head of its chain; it throws, naming the chain and the error of `iptables`, when it is refused. */
function insertRule(
  command: CommandRunner,
  container: string,
  rule: {chain: string; match: readonly string[]},
): void {
  checked(
    command,
    'docker',
    iptablesCommand(container, ['-I', rule.chain, ...rule.match]),
  );
}

/** Deletes the rule when the container holds it; it throws as `insertRule` does. */
function deleteHeldRule(
  command: CommandRunner,
  container: string,
  rule: {chain: string; match: readonly string[]},
): void {
  if (holdsRule(command, container, rule)) {
    checked(
      command,
      'docker',
      iptablesCommand(container, ['-D', rule.chain, ...rule.match]),
    );
  }
}

/** Cuts the network of the container; it throws, naming the chain and the error of `iptables`, when a rule is refused. Cutting twice is harmless. */
export function cutNetwork(command: CommandRunner, container: string): void {
  for (const rule of DROP_RULES) {
    if (!holdsRule(command, container, rule)) {
      insertRule(command, container, rule);
    }
  }
}

/** Brings the network of the container back on the same port; it throws as `cutNetwork` does. Restoring twice, or when nothing was cut, is harmless. */
export function restoreNetwork(
  command: CommandRunner,
  container: string,
): void {
  for (const rule of DROP_RULES) {
    deleteHeldRule(command, container, rule);
  }
}

/** How the route to the host's own address fails: refused as unreachable, or silent, so the connect times out. */
export type RouteCut = 'unreachable' | 'silent';

const ROUTE_CUTS: readonly RouteCut[] = ['unreachable', 'silent'];

/** The rule of a route cut, scoped to the host's address on the run network, so the published port keeps working. */
function routeRule(
  address: string,
  cut: RouteCut,
): {chain: string; match: readonly string[]} {
  const port = ['-d', address, '-p', 'tcp', '--dport', '22'];
  return cut === 'unreachable'
    ? {
        chain: 'INPUT',
        match: [
          ...port,
          '-j',
          'REJECT',
          '--reject-with',
          'icmp-host-unreachable',
        ],
      }
    : {chain: 'INPUT', match: [...port, '--syn', '-j', 'DROP']};
}

/**
 * Cuts the route to the host's own address: a connect to it is refused as unreachable, or gets no answer. The other
 * cut's rule is deleted first, so a switch leaves exactly one rule. It throws as `cutNetwork` does; cutting twice is
 * harmless.
 */
export function cutRoute(
  command: CommandRunner,
  container: string,
  address: string,
  cut: RouteCut,
): void {
  for (const other of ROUTE_CUTS.filter(each => each !== cut)) {
    deleteHeldRule(command, container, routeRule(address, other));
  }
  const rule = routeRule(address, cut);
  if (!holdsRule(command, container, rule)) {
    insertRule(command, container, rule);
  }
}

/** Brings the route to the host's address back; it throws as `cutNetwork` does. Harmless when nothing was cut. */
export function restoreRoute(
  command: CommandRunner,
  container: string,
  address: string,
): void {
  for (const cut of ROUTE_CUTS) {
    deleteHeldRule(command, container, routeRule(address, cut));
  }
}
