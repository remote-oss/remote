/**
 * @fileoverview The label of an SSH window: the text that prefixes the host label, and when the label is registered
 * with the editor, which is only for a connection that is up.
 */

import type {ConnectionState, SshTarget} from 'lib-authority';
import type {StringRef} from '../connect/picker-model.ts';
import {hostLabel} from './host-label.ts';

/** The id of the `SSH: {0}` text, the prefix of the window's label. */
export const SSH_LABEL_PREFIX_ID = 'sshLabelPrefix';

/** The workspace suffix of an SSH window: the prefix text with the host label as its value. */
export function workspaceSuffixOf(target: SshTarget): StringRef {
  return {id: SSH_LABEL_PREFIX_ID, values: [hostLabel(target)]};
}

/** Whether the label is registered for a resolve in this state: only for a connection that is up. */
export function shouldRegisterLabel(state: ConnectionState): boolean {
  return state === 'connected';
}
