/**
 * @fileoverview The payload of a dev-container authority whose workspace is a Docker volume: the clone request
 * carried through the window's reload, as the lowercase hex of a JSON text, and its reading back. The member names are
 * those the volume flows have always written, so an Open Recent entry of an earlier session still reads.
 */

import {engineOf, pinnedSettingsOf} from '../authority/payload.ts';
import type {PinnedEngine} from '../engine/effective-engine.ts';
import {recordOf} from '../json-record.ts';

/** The marker that stands for a unique volume, named from its source when the clone runs. */
export const UNIQUE_VOLUME = '__UNIQUE__';

/** What a volume workspace's window was opened for. */
export interface DevContainerVolume extends PinnedEngine {
  kind: 'volume';
  /** The source as typed or resolved; empty for a volume opened only to be explored. */
  repositoryPath: string;
  /** The volume's name, or `UNIQUE_VOLUME`. */
  volumeName: string;
  /** The folder under `/workspaces` the window opens. */
  folder: string;
  /** What to clone; absent for a volume opened only to be explored. */
  cloneInfo?: {urlToClone: string; ref?: string};
  /** Whether the window explores the volume instead of opening a dev container in it. */
  inspectVolume: boolean;
  /** Whether the window is the recovery container of the volume, which edits the configuration and never clones or builds. */
  recovery?: true;
}

/** The payload of a volume target: its JSON text, members in a fixed order, as lowercase hex. */
export function volumePayloadOf(target: DevContainerVolume): string {
  const text = JSON.stringify({
    repositoryPath: target.repositoryPath,
    volumeName: target.volumeName,
    folder: target.folder,
    ...(target.cloneInfo === undefined ? {} : {cloneInfo: target.cloneInfo}),
    inspectVolume: target.inspectVolume,
    ...(target.recovery === true ? {recovery: true} : {}),
    ...pinnedSettingsOf(target),
  });
  return Buffer.from(text, 'utf8').toString('hex');
}

/** The clone request of a payload, or `false` when a member has the wrong type. */
function cloneInfoOf(value: unknown): DevContainerVolume['cloneInfo'] | false {
  if (value === undefined) {
    return undefined;
  }
  const record = recordOf(value);
  if (
    typeof record?.urlToClone !== 'string' ||
    record.urlToClone === '' ||
    !(record.ref === undefined || typeof record.ref === 'string')
  ) {
    return false;
  }
  return {
    urlToClone: record.urlToClone,
    ...(typeof record.ref === 'string' ? {ref: record.ref} : {}),
  };
}

/** The volume target a payload names, or none when it names something else or has the wrong shape. */
export function volumeTargetOf(
  payload: string,
): DevContainerVolume | undefined {
  if (!/^(?:[0-9a-f]{2})+$/.test(payload)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'hex').toString('utf8'));
  } catch {
    return undefined;
  }
  const record = recordOf(parsed);
  const cloneInfo = cloneInfoOf(record?.cloneInfo);
  const engine = engineOf(record?.settings);
  if (
    typeof record?.volumeName !== 'string' ||
    record.volumeName === '' ||
    typeof record.repositoryPath !== 'string' ||
    typeof record.folder !== 'string' ||
    typeof record.inspectVolume !== 'boolean' ||
    cloneInfo === false ||
    engine === false ||
    !(record.recovery === undefined || record.recovery === true)
  ) {
    return undefined;
  }
  return {
    kind: 'volume',
    repositoryPath: record.repositoryPath,
    volumeName: record.volumeName,
    folder: record.folder,
    ...(cloneInfo === undefined ? {} : {cloneInfo}),
    inspectVolume: record.inspectVolume,
    ...(record.recovery === true ? {recovery: true as const} : {}),
    ...engine,
  };
}
