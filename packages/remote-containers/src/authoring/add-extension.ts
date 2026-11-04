/**
 * @fileoverview The pure edit of "Add to devcontainer.json": an extension's extensionId appended to the list the configuration
 * keeps its extensions in, or none when the list holds it already. Every other byte of the text stays.
 */

import {type Node, parseTree} from 'jsonc-parser';
import {appendToArray, NotAnObjectError} from '../config/jsonc-edit.ts';

/** The longest id the command accepts: far beyond any publisher and name the Marketplace holds. */
const LONGEST_EXTENSION_ID = 256;

/** The shape of an extension id, as the Marketplace names them: a publisher and a name, joined by a dot. */
const EXTENSION_ID = /^[a-z0-9A-Z][a-z0-9A-Z-]*\.[a-z0-9A-Z][a-z0-9A-Z-]*$/;

/** Whether `candidate` is an extension id; anything else, such as a `${localEnv:NAME}` reference, is never written. */
export function isExtensionId(candidate: string): boolean {
  return (
    candidate.length <= LONGEST_EXTENSION_ID && EXTENSION_ID.test(candidate)
  );
}

/** A list the edit has to append to is something other than an array. */
export class NotAnArrayError extends Error {
  readonly list: string;

  /** An error that names the list that is no array. */
  constructor(list: string) {
    super(`${list} is not an array`);
    this.name = 'NotAnArrayError';
    this.list = list;
  }
}

/** The value node at `path` of the object `node`; none when a step is missing or is not an object. */
function valueAt(node: Node, path: readonly string[]): Node | undefined {
  let current: Node | undefined = node;
  for (const step of path) {
    if (current?.type !== 'object') {
      return undefined;
    }
    current = (current.children as readonly Node[])
      .map(property => property.children as [Node, Node | undefined])
      .find(([key]) => key.value === step)?.[1];
  }
  return current;
}

/** The strings of an array node. */
function stringsOf(node: Node): string[] {
  return (node.children as readonly Node[]).flatMap(each =>
    typeof each.value === 'string' ? [each.value] : [],
  );
}

/** The array node at `path`: none when it is missing, and an error when it is there as something else. */
function arrayAt(
  tree: Node,
  path: readonly string[],
  name: string,
): Node | undefined {
  const found = valueAt(tree, path);
  if (found !== undefined && found.type !== 'array') {
    throw new NotAnArrayError(name);
  }
  return found;
}

/**
 * The text with `id` appended to `customizations.vscode.extensions` when that array is there, else to the top-level
 * `extensions` array when that is there, else to a `customizations.vscode.extensions` array it creates. None when
 * either array already holds `id` literally; an opt-out `-id` is not the id. Throws `NotAnObjectError` for text that is
 * no object, and `NotAnArrayError` for a list that is no array.
 */
export function addExtensionEdit(
  text: string,
  extensionId: string,
): string | undefined {
  const tree = parseTree(text, []);
  if (tree?.type !== 'object') {
    throw new NotAnObjectError();
  }
  const nested = arrayAt(
    tree,
    ['customizations', 'vscode', 'extensions'],
    'customizations.vscode.extensions',
  );
  const legacy = arrayAt(tree, ['extensions'], 'extensions');
  if (
    [nested, legacy].some(
      list => list !== undefined && stringsOf(list).includes(extensionId),
    )
  ) {
    return undefined;
  }
  const path =
    nested === undefined && legacy !== undefined
      ? ['extensions']
      : ['customizations', 'vscode', 'extensions'];
  return appendToArray(text, path, extensionId);
}
