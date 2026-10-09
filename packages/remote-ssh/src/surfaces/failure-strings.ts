/**
 * @fileoverview The texts of the failure dialog and the picker that follows it: the English template of each string
 * id, and the reasons a failure can name by id. The extension translates a template with the editor's own
 * localisation before the values are put in.
 */

/** The texts of the dialog, its buttons and the picker, by what they are. */
export const FAILURE_TEMPLATES = {
  noReason: 'Could not establish connection to "{0}"',
  withReason: 'Could not establish connection to "{0}": {1}',
  retry: 'Retry',
  moreActions: 'More Actions...',
  closeRemote: 'Close Remote',
  pickerPlaceholder: 'Pick an action to help resolve the problem.',
  reloadWindow: 'Reload Window',
  openRecent: 'Open Recent...',
  openDocumentation: 'Open Documentation',
  openConfigFile: 'Open SSH Configuration File',
  openSettings: 'Open Settings',
  openSetting: 'Open Setting',
  cancel: 'Cancel',
  noServerSource:
    "{2} has no built-in VS Code Server download location for {0}. Set {1} to a URL template for this editor's own server builds.",
  invalidTemplate:
    'The value of {1} is not a usable VS Code Server download URL template: {3}.',
} as const;

/** The reason a declined licence is told as. */
export const CANCELLED_REASON = 'Connecting was canceled';

/** The reasons a failure names by the id of a string of the table. */
export const REASON_TEMPLATES: Readonly<Record<string, string>> = {
  S027: CANCELLED_REASON,
  S032: 'Could not resolve hostname',
  S075: 'Failed to install the VS Code Server',
  S097: 'No route to host',
  S111: 'Remote host key has changed, port forwarding is disabled',
  S137: 'The connection timed out',
  S144: 'The remote host does not meet the prerequisites for running VS Code Server',
};

/** The setting that names where a server is downloaded from when the product has no place of its own. */
export const DOWNLOAD_TEMPLATE_SETTING = 'remote.SSH.serverDownloadUrlTemplate';
