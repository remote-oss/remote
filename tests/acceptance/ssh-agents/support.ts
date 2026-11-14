/**
 * @fileoverview What the rows of the `ssh-agents` launch share: the run's own home with the SSH files the rows write
 * under it, built from the run's block for the `harness` alias, and the reading of the editor's user settings file.
 */

import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeContained,
  settingIn,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {paletteItems} from '../windows/palette.ts';
import {pressEscape, quickPickOf} from '../windows/renderer.ts';
import {readStateDatabase} from '../windows/state-database.ts';

/** The alias the user's `.ssh/config` of the run's home defines. */
export const ALIAS = 'f2008-alias';

/** The host name only the custom file defines, and which never resolves. */
export const CUSTOM_ONLY = 'f2008-customonly';

/** What the run's `Host harness` block names. */
export interface HarnessBlock {
  /** The lines of the block under its Host line, as the run's ssh_config has them. */
  lines: string[];
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
function agentsHome(): string {
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
    lines: block.split('\n').filter(line => line.trim() !== ''),
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
      ...block.lines,
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

/** How many local windows the rows opened, which numbers their folders. */
let localWindows = 0;

/** Whether a window with AI features off was opened by a row of this launch; the launch's own first window does not count. */
let aiOffWindowOpened = false;

/** Whether a row of this launch has opened a window with AI features off (card #2520). */
export function aiOffWindowOpenedEarlier(): boolean {
  return aiOffWindowOpened;
}

/**
 * Opens a new local window on a folder of its own, with AI features on or off, and gives its name. The setting is
 * written first, so the new window starts with it. A window with a folder has a title of its own, which the renderer
 * helpers need to tell it from the first window, and an empty window that reloads takes a new name.
 */
export async function localWindowWithAi(enabled: boolean): Promise<string> {
  await userSettings({'chat.disableAIFeatures': !enabled});
  aiOffWindowOpened = aiOffWindowOpened || !enabled;
  localWindows += 1;
  const folder = path.join(
    variable('HARNESS_RUN_FOLDER'),
    `f2008-local-${String(localWindows)}`,
  );
  mkdirSync(folder, {recursive: true});
  const name = await openFolderWindow(folder);
  await waitFor(
    `window ${name} to read chat.disableAIFeatures as ${String(!enabled)}`,
    async () => (await settingIn(name, 'chat.disableAIFeatures')) === !enabled,
    30_000,
  );
  return name;
}

/** Closes window `name` so that one that will not close cannot fail the rows after it: a dialog is dismissed with Escape. */
export async function closeQuietly(name: string): Promise<void> {
  await closeContained(name, pressEscape);
}

/**
 * The items of the picker a palette command opened in window `name`, once it shows: the palette's own list holds
 * commands, whose labels start with the category, and the picker holds hosts and the footer items.
 */
export async function pickerItems(name: string): Promise<string[]> {
  await waitFor(
    `the picker of the command in ${name}`,
    async () => {
      const items = (await quickPickOf(name))?.items ?? [];
      return (
        items.length > 0 && !items.some(item => item.startsWith('Remote-SSH:'))
      );
    },
    30_000,
  );
  return (await quickPickOf(name))?.items ?? [];
}

/**
 * What the palette of window `name` lists for `text`, read again for up to 30 s until it holds every title of
 * `expected`: a window completes its commands a moment after the first list it shows. The last list is the answer, so a
 * title that never shows is missing from it.
 */
export async function paletteItemsWith(
  name: string,
  text: string,
  expected: readonly string[],
): Promise<string[]> {
  const deadline = Date.now() + 30_000;
  let items = await paletteItems(name, text);
  while (
    Date.now() < deadline &&
    !expected.every(title => items.some(item => item.trim() === title))
  ) {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    items = await paletteItems(name, text);
  }
  return items;
}

/** The titles of core's agent-host commands, which the palette never lists for "SSH". */
export const AGENT_HOST_TITLES = [
  'Connect to Remote Agent Host via SSH',
  'Add Remote Agent Host...',
  'Forget SSH Host Key',
  'Agents: Add New SSH Host...',
  'Agents: Configure SSH Hosts...',
];

/** What an item of the list is: its label, without the keybinding or the source core adds. */
export function titlesOf(items: readonly string[]): string[] {
  return items.map(item => item.trim());
}
