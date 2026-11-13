/**
 * @fileoverview What the rows of the `ssh-agents` launch share: the run's own home with the SSH files the rows write
 * under it, built from the run's block for the `harness` alias, and the reading of the editor's user settings file.
 */

import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {variable} from '../windows/harness.ts';
import {readStateDatabase} from '../windows/state-database.ts';

/** The alias the user's `.ssh/config` of the run's home defines. */
export const ALIAS = 'f2008-alias';

/** The host name only the custom file defines, and which never resolves. */
export const CUSTOM_ONLY = 'f2008-customonly';

/** What the run's `Host harness` block names. */
export interface HarnessBlock {
  hostName: string;
  port: number;
  user: string;
  identityFile: string;
}

/** The files the rows write, by name. */
export interface AgentFiles {
  config: string;
  knownHosts: string;
  customOnly: string;
  addressKey: string;
  addressFull: string;
}

/** The home the launch gives the editor. */
export function agentsHome(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'home-agents');
}

/** What the `Host harness` block of the run's ssh_config says; it fails when a line is missing. */
export function harnessBlock(): HarnessBlock {
  const text = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
  const block = /^Host harness\n((?:[ \t].*\n)+)/m.exec(text)?.[1] ?? '';
  function valueOf(keyword: string): string {
    const found = new RegExp(`^\\s+${keyword} (.+)$`, 'm').exec(block)?.[1];
    if (found === undefined) {
      throw new Error(`the Host harness block has no ${keyword}`);
    }
    return found.trim();
  }
  return {
    hostName: valueOf('HostName'),
    port: Number(valueOf('Port')),
    user: valueOf('User'),
    identityFile: valueOf('IdentityFile'),
  };
}

/** Writes `lines` to `file`, making its folder, and gives `file`. */
function written(file: string, lines: readonly string[]): string {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

/**
 * Writes the five files of the rows under the run's home, from the block of the `harness` alias: the user's config
 * with that block under `f2008-alias`, an empty known-hosts file, a file that defines only `f2008-customonly`, and two
 * files that define the host by its address, the first with neither port nor user and the second with both.
 */
export function writeAgentFiles(): AgentFiles {
  const block = harnessBlock();
  const folder = path.join(agentsHome(), '.ssh');
  const knownHosts = path.join(folder, 'known_hosts');
  mkdirSync(folder, {recursive: true});
  writeFileSync(knownHosts, '');
  const keyLines = [
    `  IdentityFile ${block.identityFile}`,
    '  IdentitiesOnly yes',
    `  UserKnownHostsFile ${knownHosts}`,
  ];
  return {
    config: written(path.join(folder, 'config'), [
      `Host ${ALIAS}`,
      `  HostName ${block.hostName}`,
      `  Port ${String(block.port)}`,
      `  User ${block.user}`,
      `  IdentityFile ${block.identityFile}`,
      '  IdentitiesOnly yes',
      `  UserKnownHostsFile ${knownHosts}`,
    ]),
    knownHosts,
    customOnly: written(path.join(agentsHome(), 'custom-only.conf'), [
      `Host ${CUSTOM_ONLY}`,
      `  HostName ${CUSTOM_ONLY}.invalid`,
    ]),
    addressKey: written(path.join(agentsHome(), 'address-key.conf'), [
      `Host ${block.hostName}`,
      ...keyLines,
    ]),
    addressFull: written(path.join(agentsHome(), 'address-full.conf'), [
      `Host ${block.hostName}`,
      `  Port ${String(block.port)}`,
      `  User ${block.user}`,
      ...keyLines,
    ]),
  };
}

/** The bytes and the modification time of `file`, to tell that nothing wrote it. */
export function fingerprint(file: string): string {
  return `${readFileSync(file).toString('base64')}@${String(statSync(file).mtimeMs)}`;
}

/** The names of the keys of the profile's application storage (never the values): the editor's `state.vscdb`. */
export function storageKeys(): string[] {
  return readStateDatabase(
    path.join(variable('HARNESS_USER_DATA'), 'User/globalStorage/state.vscdb'),
    database =>
      (
        database.prepare('SELECT key FROM ItemTable').all() as Array<{
          key: string;
        }>
      ).map(entry => entry.key),
  );
}
