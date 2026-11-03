/**
 * @fileoverview The payload of an attached-container authority: the lowercase hex of a JSON text that names the
 * container, the engine it is pinned to if not the default, and a WSL window's working folder; and its reading back. The
 * name is the only identity, so no container id is kept.
 */

import {
  engineOf,
  payloadJsonOf,
  payloadTextOf,
  pinnedSettingsOf,
} from '../authority/payload.ts';
import type {PinnedEngine} from '../engine/effective-engine.ts';
import {recordOf} from '../json-record.ts';

/** An attached container: its name with the slash Docker keeps, the engine, and a WSL window's working folder. */
export interface AttachedTarget extends PinnedEngine {
  containerName: string;
  /** The distro's UNC root, in a WSL window. */
  cwd?: string;
}

/** A payload that is not a target, and the step that refused it. */
export interface AttachedMalformed {
  malformed: 'hex' | 'json' | 'shape';
}

/** The payload of a target: its JSON text, members in a fixed order, as lowercase hex. */
export function attachedPayloadOf(target: AttachedTarget): string {
  const text = JSON.stringify({
    containerName: target.containerName,
    ...pinnedSettingsOf(target),
    ...(target.cwd === undefined ? {} : {cwd: target.cwd}),
  });
  return Buffer.from(text, 'utf8').toString('hex');
}

/** Reads a payload: the target it names, or why it is none. */
export function attachedTargetOf(
  payload: string,
): AttachedTarget | AttachedMalformed {
  const text = payloadTextOf(payload);
  if (typeof text !== 'string') {
    return text;
  }
  const parsed = payloadJsonOf(text);
  if ('malformed' in parsed) {
    return parsed;
  }
  const record = recordOf(parsed.json);
  const engine = engineOf(record?.settings);
  if (
    typeof record?.containerName !== 'string' ||
    !record.containerName.startsWith('/') ||
    record.containerName.length < 2 ||
    engine === false ||
    (record.cwd !== undefined &&
      (typeof record.cwd !== 'string' || record.cwd === ''))
  ) {
    return {malformed: 'shape'};
  }
  return {
    containerName: record.containerName,
    ...engine,
    ...(typeof record.cwd === 'string' ? {cwd: record.cwd} : {}),
  };
}

/** The UNC root of the distro a WSL window runs in, from its authority `wsl+<distro>`; none for any other window. */
export function wslRootOf(authority: string | undefined): string | undefined {
  const distro =
    authority?.startsWith('wsl+') === true ? authority.slice(4) : '';
  return distro === '' ? undefined : `\\\\wsl.localhost\\${distro}`;
}
