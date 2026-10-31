/**
 * @fileoverview The name a view was registered with. Giving a tree view no title leaves its header blank, so the view
 * reads its name again from the strings the manifest names: the file of the editor's language, else the plain one.
 */

import {recordOf} from './listed-containers.ts';

/** The text of the strings file `file` of the extension, or none when it can't be read. */
export type ReadStrings = (file: string) => string | undefined;

/** The name of the string `key` in `text`, or none when `text` is no JSON object or holds no such string. */
function stringIn(text: string, key: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const value = recordOf(parsed)?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** The name the manifest gives the view `viewId`, in the editor's `language` when its file has one. */
export function registeredNameOf(
  read: ReadStrings,
  language: string,
  viewId: string,
): string | undefined {
  for (const file of [
    `package.nls.${language.toLowerCase()}.json`,
    'package.nls.json',
  ]) {
    const text = read(file);
    const name =
      text === undefined ? undefined : stringIn(text, `views.${viewId}.name`);
    if (name !== undefined) {
      return name;
    }
  }
  return undefined;
}
