/**
 * @fileoverview The pure edit of a container configuration's "features" object: the checked catalogue keys added
 * or replaced, the unchecked ones removed, keeping every other byte of the file, and the id matching that decides
 * which catalogue item an entry of the file preselects.
 */

import {applyEdits, modify, parseTree, type Node} from 'jsonc-parser';
import type {CatalogueFeature} from './catalogue.ts';
import {featureKeyOf} from './select-features.ts';

/** One catalogue feature the edit carries: its key and its value, `{}` or the wizard's options. */
export interface FeatureEntry {
  key: string;
  value: Record<string, unknown>;
}

/** The picker's result: the checked entries in the catalogue's order, and the keys of the unchecked ones. */
export interface FeaturePicks {
  checked: readonly FeatureEntry[];
  unchecked: readonly string[];
}

/** What the edit gives: the file's new text, no change, or a `features` value that is not an object. */
export type FeatureEdit =
  {kind: 'edited'; text: string} | {kind: 'unchanged'} | {kind: 'notAnObject'};

/** The line ends of the text: CRLF when present, else LF. */
function lineEndsOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** The file's own indentation: the first indented line's, two spaces when it has none. */
function indentStepOf(text: string): string {
  const match = /^([ \t]+)\S/m.exec(text);
  return match?.[1] ?? '  ';
}

/** The indentation of level `n` of the file: its step, repeated. */
function indentedOf(step: string, level: number): string {
  return step.repeat(level);
}

/** The text a value is written as: an object or array one line per member, a scalar as its JSON. */
function valueTextOf(
  value: unknown,
  step: string,
  lineEnds: string,
  level: number,
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const members = value.map(
      each =>
        `${indentedOf(step, level + 1)}${valueTextOf(each, step, lineEnds, level + 1)}`,
    );
    return `[${lineEnds}${members.join(`,${lineEnds}`)}${lineEnds}${indentedOf(step, level)}]`;
  }
  if (value === undefined) {
    return 'null';
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }
    const members = entries.map(
      ([key, each]) =>
        `${indentedOf(step, level + 1)}${JSON.stringify(key)}: ${valueTextOf(each, step, lineEnds, level + 1)}`,
    );
    return `{${lineEnds}${members.join(`,${lineEnds}`)}${lineEnds}${indentedOf(step, level)}}`;
  }
  return JSON.stringify(value);
}

/** One entry of the `features` object as it is in the file, with the ranges the edit keeps. */
interface EntryInFile {
  /** The entry's key, unquoted. */
  key: string;
  /** The entry's text, its quoted key through its value, verbatim. */
  text: string;
  /** The entry's quoted key, as it is in the file. */
  keyText: string;
  keyStart: number;
  valueEnd: number;
}

/** The entries of an object node, by their key and value ranges. */
function entriesOf(node: Node, text: string): EntryInFile[] {
  const entries: EntryInFile[] = [];
  for (const property of node.children as readonly Node[]) {
    const [keyNode, valueNode] = property.children as [Node, Node | undefined];
    if (valueNode === undefined) {
      continue;
    }
    entries.push({
      key: String(keyNode.value),
      text: text.slice(keyNode.offset, valueNode.offset + valueNode.length),
      keyText: text.slice(keyNode.offset, keyNode.offset + keyNode.length),
      keyStart: keyNode.offset,
      valueEnd: valueNode.offset + valueNode.length,
    });
  }
  return entries;
}

/** Whether an object node holds any property. */
function hasProperties(node: Node): boolean {
  return (node.children as readonly Node[]).length > 0;
}

/**
 * Edits the `"features"` object of the configuration's text: each checked entry is added, or replaced with its
 * value when its key is present, and each unchecked key is removed. No other byte of the file changes: comments,
 * indentation, line ends and every other key are kept, a trailing comment ending up after the last appended
 * entry. It gives `unchanged` when nothing is written and `notAnObject` when the `features` value is not an
 * object, the caller writing nothing and opening nothing in both cases.
 */
export function editFeatures(text: string, picks: FeaturePicks): FeatureEdit {
  const tree = parseTree(text, []);
  if (tree?.type !== 'object') {
    return {kind: 'notAnObject'};
  }
  const featuresProperty = (tree.children as readonly Node[]).find(
    property =>
      (property.children as [Node, Node | undefined])[0].value === 'features',
  );
  const featuresNode = featuresProperty?.children?.[1];
  if (featuresNode !== undefined && featuresNode.type !== 'object') {
    return {kind: 'notAnObject'};
  }
  const entries =
    featuresNode === undefined ? [] : entriesOf(featuresNode, text);
  const removedKeys = new Set(picks.unchecked);
  const checkedKeys = new Map(
    picks.checked.map(entry => [entry.key, entry.value]),
  );
  const appended = picks.checked.filter(
    entry => !entries.some(each => each.key === entry.key),
  );
  const touched =
    appended.length > 0 ||
    entries.some(
      entry => removedKeys.has(entry.key) || checkedKeys.has(entry.key),
    );
  if (!touched) {
    return {kind: 'unchanged'};
  }

  const lineEnds = lineEndsOf(text);
  const step = indentStepOf(text);
  const entryIndent = indentedOf(step, 2);
  const separator = `,${lineEnds}${entryIndent}`;
  /** The text of an appended entry: its quoted key and its value one line per member. */
  function appendText(entry: FeatureEntry): string {
    return `${JSON.stringify(entry.key)}: ${valueTextOf(entry.value, step, lineEnds, 2)}`;
  }
  const objectStart = featuresNode?.offset ?? -1;
  const objectEnd =
    featuresNode === undefined ? -1 : featuresNode.offset + featuresNode.length;
  const lastEntry = entries[entries.length - 1];
  const trailing =
    lastEntry !== undefined
      ? text.slice(lastEntry.valueEnd, objectEnd - 1)
      : '';

  const firstEntry = entries[0];
  let interior =
    firstEntry !== undefined
      ? text.slice(objectStart + 1, firstEntry.keyStart)
      : '';
  let lastKeptEntry: EntryInFile | undefined;
  let removedSinceLastKept = false;
  for (const entry of entries) {
    if (removedKeys.has(entry.key)) {
      removedSinceLastKept = true;
      continue;
    }
    if (lastKeptEntry !== undefined) {
      interior += removedSinceLastKept
        ? separator
        : text.slice(lastKeptEntry.valueEnd, entry.keyStart);
    }
    const value = checkedKeys.get(entry.key);
    interior +=
      value === undefined
        ? entry.text
        : `${entry.keyText}: ${valueTextOf(value, step, lineEnds, 2)}`;
    lastKeptEntry = entry;
    removedSinceLastKept = false;
  }
  if (lastKeptEntry === undefined && appended.length === 0) {
    interior = '';
  } else if (appended.length > 0) {
    if (entries.length === 0) {
      interior = `${lineEnds}${entryIndent}${appended.map(appendText).join(separator)}${lineEnds}${indentedOf(step, 1)}`;
    } else {
      if (lastKeptEntry !== undefined) {
        interior += separator;
      }
      interior += appended.map(appendText).join(separator) + trailing;
    }
  } else {
    interior += trailing;
  }
  const objectText = `{${interior}}`;

  const content =
    featuresNode === undefined
      ? `${hasProperties(tree) ? ',' : ''}${lineEnds}${indentedOf(step, 1)}"features": ${objectText}`
      : objectText;
  const edits = modify(text, ['features'], {}, {});
  const newText = applyEdits(
    text,
    edits.slice(0, 1).map(edit => ({...edit, content})),
  );
  return newText === text
    ? {kind: 'unchanged'}
    : {kind: 'edited', text: newText};
}

/**
 * The catalogue key an entry of the file preselects (BR-1): the key of the feature whose registry, namespace and
 * id the entry names under any version form; a digest-pinned reference, the same id under another registry, a
 * bare legacy id without registry and namespace, and a local path name nothing.
 */
export function catalogueKeyOf(
  entryKey: string,
  catalogue: readonly CatalogueFeature[],
): string | undefined {
  if (entryKey.includes('@')) {
    return undefined;
  }
  const slash = entryKey.lastIndexOf('/');
  if (slash === -1) {
    return undefined;
  }
  const colon = entryKey.indexOf(':', slash + 1);
  const reference = entryKey.slice(0, colon === -1 ? undefined : colon);
  const feature = catalogue.find(each => each.id === reference);
  return feature === undefined ? undefined : featureKeyOf(feature);
}
