/**
 * @fileoverview The strings outside the failure dialog's table: our own named ids, and the numbered ids used elsewhere,
 * with their English templates, and the text one of them gives with its values.
 */

import {SSH_LABEL_PREFIX_ID} from '../window/label-suffix.ts';
import type {StringRef} from '../connect/picker-model.ts';
import {type Translate, filled} from './strings.ts';

/** The ids of the strings that are ours alone, and their English templates. */
export const OWN_TEMPLATES = {
  [SSH_LABEL_PREFIX_ID]: 'SSH: {0}',
  platformPickPlaceholder: 'Select the platform of the remote host "{0}"',
  platformPickAfterBrokenPipe:
    'Error connecting, please select the platform of the remote host: "{0}"',
  mitigationReloadWindow: 'Reload Window',
  S085: 'Killed VS Code Server on {0}.',
  S076: 'Failed to kill VS Code Server on {0}.',
  S101: 'Open Logs',
  S132: 'Show details in terminal',
  platformStoredNotice:
    'You selected "{0}" as the remote platform - this will be stored in the setting "remote.SSH.remotePlatform" and can be changed there if needed.',
  S039: "Don't Show Again",
  S025: 'Connect',
  S063: 'Enter SSH Connection Command',
  S078: 'Host added!',
  S099: 'Open Config',
  S168: '{1} is not a valid host to bind',
  S046: 'ERROR: TCP port forwarding appears to be disabled on the remote host. Ensure that the sshd_config has `AllowTcpForwarding yes`. Contact your system administrator if needed.',
  S150: "The remote server's SSH configuration may have TCP forwarding disabled",
  S005: "Add the setting '{0}' to the server's '{1}' (or similar) configuration file",
  S003: 'A VS Code Server matching your local installation could not be downloaded from the internet.',
  S042: 'Downloading VS Code Server failed - please install either curl or wget on the remote.',
  S043: 'Downloading VS Code Server failed. Please try again later.',
  S052: "Ensure curl/wget are on the remote system's '{0}'",
  S054: 'Ensure that the remote server has internet access and has access to the VS Code CDN',
  S055: 'Ensure that the remote server has internet access and that the network is not blocking the download',
  S080: 'If your remote server is behind a firewall, ask your IT department to allow access to the VS Code CDN',
  S081: "If your remote server is behind a proxy, provide the proxy URL with setting '{0}' or '{1}'",
  S083: "Install '{0}' on the remote server. Installation steps will vary per distribution.",
  S154: 'Update VS Code and try again later',
  S109: 'Proxy URL in settings is invalid',
  S113: 'Remove this value from settings or correct the URL',
  S151: 'URL must include the scheme ({0} or {1})',
  S152: 'URL should not contain non-URL characters',
  S159: 'When first establishing a connection to the remote server, various resources must be installed from the internet. A program (either "wget" or "curl") is used to download these resources, but they are not installed on the remote server.  When this step fails, the extension attempts to use the local machine to download the resources and then upload them to the remote server.',
  S049: 'Enable {0} to allow VS Code to download the required resources locally',
  S050: 'Enable {0} to allow VS Code to download the required resources via your local machine and then upload them to the remote server',
  S116: 'Restart the SSH server on the remote machine to apply any changes to the configuration',
  showLogLinkText: 'Show log',
  S138: 'The following issues were detected in your most recent Remote - SSH session',
  S125: 'See verbose information in the',
  S134: 'Status',
  S090: 'Message',
  S091: 'Mitigations',
  S115: 'Resources',
  socksForwardingFailedNotice:
    'Failed to set up dynamic port forwarding connection over SSH to the VS Code Server. ({0})',
  configFileNotAbsolute:
    'remote.SSH.configFile must be an absolute path or start with ~/: "{0}"',
} as const;

/** The text of a string of our own: its template translated and filled. Throws for an id this table lacks. */
export function ownText(reference: StringRef, translate: Translate): string {
  if (!Object.hasOwn(OWN_TEMPLATES, reference.id)) {
    throw new Error(`no template for the string id ${reference.id}`);
  }
  return filled(
    translate,
    OWN_TEMPLATES[reference.id as keyof typeof OWN_TEMPLATES],
    reference.values,
  );
}
