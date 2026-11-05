/**
 * @fileoverview The write of an attach configuration file: the file of an image or of a container name below the
 * extension's global storage, changed through the document-edit seam. The name comes from a payload that a link can
 * name, so a name that would leave the folder is refused.
 */

import path from 'node:path';
import {
  applyConfigurationEdit,
  type ConfigurationEditPorts,
  type EditResult,
  type TextChange,
} from '../config/configuration-edit.ts';
import {attachFileOf, imageFileNameOf} from './config-files.ts';

/** The file to write: the image's or the container name's. */
export type AttachWriteTarget = {image: string} | {name: string};

/** An attach file is refused when its name could reach outside its folder. */
export interface BadName {
  kind: 'refused';
  reason: 'badName';
}

/** The part of the file's name before `.json`. */
function stemOf(target: AttachWriteTarget): string {
  return 'image' in target
    ? imageFileNameOf(target.image).slice(0, -'.json'.length)
    : target.name;
}

/** Whether the file of `target` is a plain file directly in its own folder below `storage`. */
function nameIsSafe(
  storage: string,
  target: AttachWriteTarget,
  file: string,
): boolean {
  const stem = stemOf(target);
  const written = 'image' in target ? target.image : target.name;
  const folder = path.dirname(
    attachFileOf(storage, 'image' in target ? {image: 'x'} : {name: 'x'}),
  );
  const relative = path.relative(folder, file);
  return (
    !['', '.', '..'].includes(stem) &&
    !/[/\\]/.test(stem) &&
    !stem.includes('\0') &&
    !('name' in target && target.name.includes(':')) &&
    !/%2f/i.test(written) &&
    relative === path.basename(file)
  );
}

/**
 * Changes the attach file of `target` below `storage` by `change`, which is given `{}` for a file that doesn't exist
 * yet. The file is written on disk, or edited in the buffer when a tab holds it.
 */
export async function writeAttachConfiguration(
  storage: string,
  target: AttachWriteTarget,
  change: TextChange,
  ports: ConfigurationEditPorts,
): Promise<EditResult | BadName> {
  const file = attachFileOf(storage, target);
  if (!nameIsSafe(storage, target, file)) {
    return {kind: 'refused', reason: 'badName'};
  }
  return applyConfigurationEdit(
    ports.fileUri(file),
    current => change(current.trim() === '' ? '{}' : current),
    'diskUnlessOpen',
    ports,
  );
}
