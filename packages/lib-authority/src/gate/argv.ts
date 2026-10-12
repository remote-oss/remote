/**
 * @fileoverview The runtime-arguments file of the editor install: where it is and which extension ids it enables for
 * proposed APIs.
 */

import path from 'node:path';

/** What decides where the editor keeps its runtime arguments. */
export interface ArgvLocation {
  /** The folder of the portable install, when the editor runs portable. */
  portableFolder: string | undefined;
  homeFolder: string;
  /** The `dataFolderName` of the editor's product. */
  dataFolderName: string;
}

const ARGV_FILE = 'argv.json';

/** The file the editor reads its runtime arguments from. */
export function argvPath(location: ArgvLocation): string {
  return location.portableFolder === undefined || location.portableFolder === ''
    ? path.join(location.homeFolder, location.dataFolderName, ARGV_FILE)
    : path.join(location.portableFolder, ARGV_FILE);
}

/** Whether a document is the runtime-arguments file, whichever install it belongs to. */
export function isArgvFile(documentPath: string): boolean {
  return path.basename(documentPath) === ARGV_FILE;
}

/** Removes `//` and block comments and trailing commas that lie outside strings. */
function withoutJsoncExtras(text: string): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const pair = text.slice(index, index + 2);
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === '\\' ? 2 : 1;
      }
      result += text.slice(index, end + 1);
      index = end + 1;
    } else if (pair === '//') {
      const lineEnd = text.indexOf('\n', index);
      index = lineEnd === -1 ? text.length : lineEnd;
    } else if (pair === '/*') {
      const blockEnd = text.indexOf('*/', index + 2);
      index = blockEnd === -1 ? text.length : blockEnd + 2;
    } else {
      result += char;
      index += 1;
    }
  }
  return result.replace(/,(\s*[\]}])/g, '$1');
}

/**
 * The extension ids the file lists under `enable-proposed-api`. The file is JSON with comments and trailing commas.
 * A missing file lists none silently. A file that cannot be read, or whose entry is not an array, lists none, and an
 * array keeps its strings; each of these two is told once to `report`.
 */
export function enabledProposedApiIds(
  text: string | undefined,
  report: (message: string) => void,
): readonly string[] {
  if (text === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutJsoncExtras(text.replace(/^\uFEFF/, '')));
  } catch (caught) {
    report(`argv.json cannot be read: ${String(caught)}`);
    return [];
  }
  const listed =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['enable-proposed-api']
      : undefined;
  if (listed === undefined) {
    return [];
  }
  if (!Array.isArray(listed)) {
    report("argv.json: 'enable-proposed-api' is not a list");
    return [];
  }
  const identifiers = listed.filter(
    (entry): entry is string => typeof entry === 'string',
  );
  if (identifiers.length !== listed.length) {
    report("argv.json: 'enable-proposed-api' has entries that are not text");
  }
  return identifiers;
}
