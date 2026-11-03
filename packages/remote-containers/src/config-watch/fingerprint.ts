/**
 * @fileoverview The fingerprints of the files a dev container is built from: the configuration's, which ignores
 * comments, spacing and a missing final brace, and a Dockerfile's, which counts every byte.
 */

import {createHash} from 'node:crypto';
import {type Node, parseTree} from 'jsonc-parser';
import {decodeConfiguration} from '../config/configuration-text.ts';

/** The compact JSON of a parsed node, its properties in file order. */
function compactNode(node: Node): string {
  if (node.type === 'object') {
    const properties = new Map<string, string>();
    for (const property of node.children as readonly Node[]) {
      const [key, value] = property.children as [Node, Node | undefined];
      if (value !== undefined) {
        properties.set(JSON.stringify(key.value), compactNode(value));
      }
    }
    return `{${[...properties].map(([key, value]) => `${key}:${value}`).join(',')}}`;
  }
  if (node.type === 'array') {
    return `[${(node.children as readonly Node[]).map(compactNode).join(',')}]`;
  }
  return JSON.stringify(node.value);
}

/**
 * The text as compact JSON, written from the parsed tree in file order, never through an object, which would put keys
 * like `"8080"` first. A key that appears twice keeps its first place and its last value. A text with no tree gives the
 * empty string.
 */
export function compactJsonOf(text: string): string {
  const tree = parseTree(text, [], {allowTrailingComma: true});
  return tree === undefined ? '' : compactNode(tree);
}

function sha256Of(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The fingerprint of a configuration file's bytes. */
export function configurationFingerprint(bytes: Uint8Array): string {
  return sha256Of(compactJsonOf(decodeConfiguration(bytes)));
}

/** The fingerprint of a file's bytes as they are. */
export function bytesFingerprint(bytes: Uint8Array): string {
  return sha256Of(bytes);
}
