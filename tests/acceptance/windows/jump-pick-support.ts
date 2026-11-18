/**
 * @fileoverview What the rows of F-2310's host-key questions share (cards #2610, #2686): the ports of the user-level
 * sshds behind the harness host, the pick question of a hop, the known-hosts lines, and the config files of a target
 * behind one jump host and behind two.
 */

import {readFileSync} from 'node:fs';
import {
  ASK_WITHOUT,
  askLines,
  hostBlock,
  MODES,
  writeConfig,
} from './config-keywords-support.ts';

/** The first user-level sshd's port, which a hop behind the harness host shows its own key on. */
export const FIRST_PORT = 22022;

/** The second user-level sshd's port. */
export const SECOND_PORT = 22023;

/** The pick question of a hop whose host key has `fingerprint`, for window `alias`. */
export function pickOf(alias: string, fingerprint: string | undefined): string {
  return `"${alias}" has fingerprint "${String(fingerprint)}".`;
}

/** The host columns of the lines of the known-hosts file `known`, in file order. */
export function knownHosts(known: string): string[] {
  return readFileSync(known, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split(' ')[0] ?? '');
}

/** The file of a row with one jump host, the harness host's sshd, and a target at the first user-level sshd behind it. */
export function oneJump(alias: string, known: string): string {
  return writeConfig(alias, [
    hostBlock(
      alias,
      [
        `ProxyJump ${alias}-hop`,
        'HostName 127.0.0.1',
        `Port ${String(FIRST_PORT)}`,
        ...askLines(known),
      ],
      ['Port', 'HostName', ...ASK_WITHOUT],
    ),
    hostBlock(`${alias}-hop`, askLines(known), ASK_WITHOUT),
  ]);
}

/** The file of a row with `ProxyJump a,b`: the harness host's sshd, the first user-level sshd, and the target at the second. */
export function twoJumps(alias: string, known: string): string {
  return writeConfig(alias, [
    hostBlock(
      alias,
      [
        `ProxyJump ${alias}-a,${alias}-b`,
        'HostName 127.0.0.1',
        `Port ${String(SECOND_PORT)}`,
        ...askLines(known),
      ],
      ['Port', 'HostName', ...ASK_WITHOUT],
    ),
    hostBlock(`${alias}-a`, askLines(known), ASK_WITHOUT),
    hostBlock(
      `${alias}-b`,
      ['HostName 127.0.0.1', `Port ${String(FIRST_PORT)}`, ...askLines(known)],
      ['Port', 'HostName', ...ASK_WITHOUT],
    ),
  ]);
}

/** The settings of the terminal mode with the login terminal `shown` or hidden, and the platform named so that no pick of it is asked. */
export function terminalSettings(alias: string, shown: boolean) {
  return {
    ...MODES[1].settings,
    'remote.SSH.showLoginTerminal': shown,
    'remote.SSH.remotePlatform': {[alias]: 'linux'},
  };
}
