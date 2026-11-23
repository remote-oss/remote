/**
 * @fileoverview The attach configuration files, as far as an attach reads them: where the file of an image and the file
 * of a container name lie, which of the two applies, and the working folder a file names. Writing them is not here.
 */

import path from 'node:path';
import {parseConfiguration} from '../config/configuration-text.ts';

/** The folders of the two kinds of file below the extension's global storage. */
const IMAGE_FOLDER = 'imageConfigs';
const NAME_FOLDER = 'nameConfigs';

/** The two files that may apply to a container. */
export interface AttachConfigFiles {
  /** The file for the container's name. */
  name: string;
  /** The file for the container's image. */
  image: string;
}

/** The file name of an image: its reference as written, with `:` as `%3a` and `/` as `%2f`. */
export function imageFileNameOf(image: string): string {
  return `${image.replaceAll(':', '%3a').replaceAll('/', '%2f')}.json`;
}

/** The file of an image or of a container name below `storage`. */
export function attachFileOf(
  storage: string,
  target: {image: string} | {name: string},
): string {
  return 'image' in target
    ? path.join(storage, IMAGE_FOLDER, imageFileNameOf(target.image))
    : path.join(storage, NAME_FOLDER, `${target.name}.json`);
}

/** The files that may apply to a container with the image `image` and the name `name`, which has no leading slash. */
export function attachConfigFilesOf(
  storage: string,
  image: string,
  name: string,
): AttachConfigFiles {
  return {
    name: attachFileOf(storage, {name}),
    image: attachFileOf(storage, {image}),
  };
}

/** The file that applies: the file of the name if it exists, else the file of the image if it does. */
export async function applicableConfigOf(
  files: AttachConfigFiles,
  exists: (file: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (await exists(files.name)) {
    return files.name;
  }
  return (await exists(files.image)) ? files.image : undefined;
}

/**
 * The working folder a file names, taken literally: the text is read tolerantly, so every property that can be read
 * applies; a value that is not an absolute path of the container is ignored.
 */
export function workspaceFolderOf(text: string): string | undefined {
  const folder = parseConfiguration(text)?.workspaceFolder;
  return typeof folder === 'string' && folder.startsWith('/')
    ? folder
    : undefined;
}
