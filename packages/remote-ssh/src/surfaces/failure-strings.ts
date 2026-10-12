/**
 * @fileoverview The texts of the connection failure dialog and of the connection progress: the English template of
 * each string id, and the text a failure's reason gives. The extension translates a template with the editor's own
 * localisation before the values are put in.
 */

import type {FailureReason} from 'lib-authority';
import {filled, type Translate} from './strings.ts';

/** The string ids of the progress and of the failure dialog. */
export type FailureStringId =
  | 'S014'
  | 'S015'
  | 'S022'
  | 'S027'
  | 'S029'
  | 'S030'
  | 'S031'
  | 'S032'
  | 'S041'
  | 'S044'
  | 'S079'
  | 'S082'
  | 'S084'
  | 'S092'
  | 'S094'
  | 'S097'
  | 'S107'
  | 'S111'
  | 'S117'
  | 'S129'
  | 'S130'
  | 'S137'
  | 'S140'
  | 'S142'
  | 'S158';

/** The English template of each string id, with `{0}`, `{1}` for the values. */
export const FAILURE_TEMPLATES: Readonly<Record<FailureStringId, string>> = {
  S014: "Can't assign requested address",
  S015: 'Cancel',
  S022: 'Close Remote',
  S027: 'Connecting was canceled',
  S029: 'Copying VS Code Server to host with scp',
  S030: 'Could not establish connection to "{0}"',
  S031: 'Could not establish connection to "{0}": {1}',
  S032: 'Could not resolve hostname',
  S041: 'Downloading VS Code Server',
  S044: 'Downloading VS Code Server locally',
  S079: 'Hostname contains invalid characters',
  S082: 'Initializing VS Code Server',
  S084: 'Installing VS Code Server',
  S092: 'More Actions...',
  S094: 'Network is unreachable',
  S097: 'No route to host',
  S107: 'Port forwarding is disabled',
  S111: 'Remote host key has changed, port forwarding is disabled',
  S117: 'Retry',
  S129: 'Setting up SSH Host {0}',
  S130: 'Setting up SSH tunnel',
  S137: 'The connection timed out',
  S140: 'The operation timed out',
  S142: 'The process tried to write to a nonexistent pipe',
  S158: 'Waiting for port forwarding to be ready',
};

/** The two dialogs of a missing or unusable server download location, which have no string id yet. */
export const SERVER_SOURCE_TEMPLATES = {
  noServerSource:
    "{2} knows no download location for the server of {0}. Set {1} to a URL template for this editor's server builds.",
  invalidServerTemplate:
    'The value of {1} is not a usable server download URL template: {3}.',
  openSetting: 'Open Setting',
} as const;

/** The text of a string id with its values, in the display language. */
export function textOfId(
  stringId: FailureStringId,
  translate: Translate,
  values: readonly string[] = [],
): string {
  return filled(translate, FAILURE_TEMPLATES[stringId], values);
}

/** The text of a template that has no string id yet, with its values. */
export function textOfTemplate(
  template: string,
  translate: Translate,
  values: readonly string[],
): string {
  return filled(translate, template, values);
}

/** Whether the id has a template here. */
function isKnownId(stringId: string): stringId is FailureStringId {
  return Object.hasOwn(FAILURE_TEMPLATES, stringId);
}

/**
 * The text a reason gives: the translated template of a known id, the text as it is, or nothing for an id this table
 * does not hold.
 */
export function reasonText(
  reason: FailureReason,
  translate: Translate,
): string | undefined {
  if ('text' in reason) {
    return reason.text;
  }
  return isKnownId(reason.id) ? textOfId(reason.id, translate) : undefined;
}
