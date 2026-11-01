/**
 * @fileoverview The label of an SSH window: the text that prefixes the host label.
 */

import type {SshTarget} from 'lib-authority';
import type {StringRef} from '../connect/picker-model.ts';
import {hostLabel} from './host-label.ts';

/** The id of the `SSH: {0}` text, the prefix of the window's label. */
export const SSH_LABEL_PREFIX_ID = 'sshLabelPrefix';

/** The workspace suffix of an SSH window: the prefix text with the host label as its value. */
export function workspaceSuffixOf(target: SshTarget): StringRef {
  return {id: SSH_LABEL_PREFIX_ID, values: [hostLabel(target)]};
}
