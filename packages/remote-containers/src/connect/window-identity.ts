/**
 * @fileoverview The text a dev container window shows after its folder: the configuration's name, or none, and the
 * Docker context when the target carries one.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';

/** The English templates of the suffix. */
const WINDOW_TEMPLATES = {
  S114: 'Dev Container: {0}{1}',
  S118: 'Dev Container{0}',
} as const;

/** What the connection knows of its identity. */
export interface WindowIdentity {
  name: string | undefined;
  context: string | undefined;
}

/** The suffix of the window's label; the name is kept as it is, spaces included. */
export function workspaceSuffixOf(
  identity: WindowIdentity | undefined,
  translate: Translate,
): string {
  const context =
    identity?.context === undefined ? '' : ` @ ${identity.context}`;
  const name = identity?.name;
  return name === undefined || name === ''
    ? filled(translate, WINDOW_TEMPLATES.S118, [context])
    : filled(translate, WINDOW_TEMPLATES.S114, [name, context]);
}
