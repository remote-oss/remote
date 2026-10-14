/**
 * @fileoverview The texts of the connection failure dialog and of the connection progress: the English template of
 * each string id, and the text a failure's reason gives. The extension translates a template with the editor's own
 * localisation before the values are put in.
 */

import type {FailureReason} from 'lib-authority';
import {filled, type Translate} from './strings.ts';

/** The string ids of the progress and of the failure dialog. */
export type FailureStringId =
  | 'S009'
  | 'S014'
  | 'S015'
  | 'S022'
  | 'S024'
  | 'S027'
  | 'S029'
  | 'S030'
  | 'S031'
  | 'S032'
  | 'S041'
  | 'S043'
  | 'S044'
  | 'S045'
  | 'S047'
  | 'S067'
  | 'S071'
  | 'S073'
  | 'S075'
  | 'S077'
  | 'S079'
  | 'S082'
  | 'S084'
  | 'S089'
  | 'S092'
  | 'S094'
  | 'S095'
  | 'S097'
  | 'S100'
  | 'S102'
  | 'S103'
  | 'S104'
  | 'S105'
  | 'S107'
  | 'S111'
  | 'S117'
  | 'S119'
  | 'S120'
  | 'S121'
  | 'S122'
  | 'S126'
  | 'S127'
  | 'S129'
  | 'S130'
  | 'S135'
  | 'S136'
  | 'S131'
  | 'S137'
  | 'S140'
  | 'S142'
  | 'S146'
  | 'S157'
  | 'S158'
  | 'S162'
  | 'S166'
  | 'S167'
  | 'installPathProvided'
  | 'reversedPortRange'
  | 'sshTimedOut'
  | 'templateNotHttp'
  | 'templateUnknownPlaceholder'
  | 'trustRefused';

/** The English template of each string id, with `{0}`, `{1}` for the values. */
export const FAILURE_TEMPLATES: Readonly<Record<FailureStringId, string>> = {
  S009: "An SSH installation couldn't be found",
  S014: "Can't assign requested address",
  S015: 'Cancel',
  S022: 'Close Remote',
  S024: 'Configure SSH Hosts...',
  S027: 'Connecting was canceled',
  S029: 'Copying VS Code Server to host with scp',
  S030: 'Could not establish connection to "{0}"',
  S031: 'Could not establish connection to "{0}": {1}',
  S032: 'Could not resolve hostname',
  S041: 'Downloading VS Code Server',
  S043: 'Downloading VS Code Server failed. Please try again later.',
  S044: 'Downloading VS Code Server locally',
  S045: 'Downloading VS Code Server...',
  S047: 'Edit custom SSH configuration file',
  S067: 'Error establishing tunnel ({0}).',
  S071: 'Failed to download VS Code Server ({0})',
  S073: 'Failed to find a free local port: {0}',
  S075: 'Failed to install the VS Code Server',
  S077: 'Help',
  S079: 'Hostname contains invalid characters',
  S082: 'Initializing VS Code Server',
  S084: 'Installing VS Code Server',
  S089: 'Max wait time exhausted',
  S092: 'More Actions...',
  S094: 'Network is unreachable',
  S095: "No free ports in specified range '{0}-{1}'.  Remove or update the 'Preferred Local Port Range' setting and try again.",
  S097: 'No route to host',
  S100: 'Open Documentation',
  S102: 'Open Recent...',
  S103: 'Open SSH Configuration File',
  S104: 'Open Settings',
  S105: 'Pick an action to help resolve the problem.',
  S107: 'Port forwarding is disabled',
  S111: 'Remote host key has changed, port forwarding is disabled',
  S117: 'Retry',
  S119: 'SSH host name cannot begin with {0}',
  S120: 'SSH host name cannot include the character {0}',
  S121: 'SSH user name cannot begin with {0}',
  S122: 'SSH user name cannot include the character {0}',
  S126: 'Select SSH configuration file to update',
  S127: 'Select configured SSH host or enter user@host',
  S129: 'Setting up SSH Host {0}',
  S130: 'Setting up SSH tunnel',
  S131: 'Settings',
  S135: 'The VS Code Server failed to start',
  S136: 'The VS Code Server terminated due to presence of CVE-2020-1416. Check the Remote-SSH output channel for more details.',
  S137: 'The connection timed out',
  S140: 'The operation timed out',
  S142: 'The process tried to write to a nonexistent pipe',
  S146: "The remote host's architecture is not supported",
  S157: 'Waiting for other windows to connect',
  S158: 'Waiting for port forwarding to be ready',
  S162: 'about SSH configuration files',
  S166: 'specify a custom configuration file',
  S167: '{0} Add New SSH Host...',
  installPathProvided: 'Provided: "{0}"',
  // The fixed text of this dialog reason; its misspelling is kept on purpose.
  reversedPortRange: 'Invaid port range set',
  sshTimedOut: 'Connecting with SSH timed out',
  templateNotHttp: 'it does not give an http or https address',
  templateUnknownPlaceholder: 'the placeholder {0} is not known',
  trustRefused: 'Got bad result from install script',
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
 * The text a reason gives: the translated template of a known id with its values put in, a value that is a string of
 * the table resolving in turn (a literal value as it is), the text as it is, or nothing for an id this table does not
 * hold, an empty text, or a value whose own id it does not hold.
 */
export function reasonText(
  reason: FailureReason,
  translate: Translate,
): string | undefined {
  if ('text' in reason) {
    return reason.text === '' ? undefined : reason.text;
  }
  if ('values' in reason) {
    if (!isKnownId(reason.id)) {
      return undefined;
    }
    const values: string[] = [];
    for (const value of reason.values) {
      const valueText =
        typeof value === 'string' ? value : reasonText(value, translate);
      if (valueText === undefined) {
        return undefined;
      }
      values.push(valueText);
    }
    return textOfId(reason.id, translate, values);
  }
  return isKnownId(reason.id) ? textOfId(reason.id, translate) : undefined;
}
