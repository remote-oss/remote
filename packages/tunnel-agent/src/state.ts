/**
 * @fileoverview What the agent keeps between runs: one folder per user, that only the user may read, holding the
 * tunnel's record, the host's key and the sign-in's credential. Each file is written whole under a temporary name
 * and renamed over the old one, so a reader never sees half of it.
 */

import {randomBytes} from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {TUNNEL_AGENT_NAME} from 'lib-identifiers';

/** The mode of the state folder: its user only. */
const FOLDER_MODE = 0o700;

/** The mode of each state file: its user only. */
const FILE_MODE = 0o600;

/** The files the state folder holds. */
export type StateFile = 'tunnel.json' | 'host-key' | 'credential';

/** The tunnel the agent registered, as its record keeps it. */
export interface TunnelRecord {
  tunnelId: string;
  clusterId: string;
  name: string;
}

/** The agent's state folder in the home folder `home`. */
export function stateFolderOf(home: string): string {
  return path.join(home, `.${TUNNEL_AGENT_NAME}`);
}

/** Makes the state folder when it is missing, and gives it its user-only mode either way. */
function ensureStateFolder(folder: string): void {
  mkdirSync(folder, {recursive: true, mode: FOLDER_MODE});
  chmodSync(folder, FOLDER_MODE);
}

/** Writes `text` as the state file `file` of `folder`, whole, at its user-only mode. */
export function writeStateFile(
  folder: string,
  file: StateFile,
  text: string,
): void {
  ensureStateFolder(folder);
  const target = path.join(folder, file);
  const temporary = `${target}.tmp-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, text, {mode: FILE_MODE});
  renameSync(temporary, target);
}

/** The text of the state file `file` of `folder`, or undefined when there is none. */
export function readStateFile(
  folder: string,
  file: StateFile,
): string | undefined {
  try {
    return readFileSync(path.join(folder, file), 'utf8');
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw caught;
  }
}

/** Whether `value` is a text that isn't empty. */
function isName(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** The tunnel record of `folder`, or undefined when there is none or it doesn't hold a record's three names. */
export function readTunnelRecord(folder: string): TunnelRecord | undefined {
  const text = readStateFile(folder, 'tunnel.json');
  let value: unknown;
  try {
    value = text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const {tunnelId, clusterId, name} = value as Record<string, unknown>;
  return isName(tunnelId) && isName(clusterId) && isName(name)
    ? {tunnelId, clusterId, name}
    : undefined;
}

/** Writes `record` as the tunnel record of `folder`. */
export function writeTunnelRecord(folder: string, record: TunnelRecord): void {
  writeStateFile(folder, 'tunnel.json', `${JSON.stringify(record)}\n`);
}
