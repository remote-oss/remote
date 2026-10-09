/**
 * @fileoverview The title of the connection progress: "Setting up SSH Host" with the host, and the message of the
 * phase the connect is in. The "(details)" link is the progress's own affordance, not part of the text here.
 */

import type {ConnectPhase, DecodedTarget, PhaseName} from 'lib-authority';
import {filled, type Translate} from './strings.ts';

const TITLE_TEMPLATE = 'Setting up SSH Host {0}: {1}';

/** The English message of each phase. The percent of a download does not change the message. */
const PHASE_TEMPLATES: Readonly<Record<PhaseName, string>> = {
  initializing: 'Initializing VS Code Server',
  downloading: 'Downloading VS Code Server',
  downloadingLocally: 'Downloading VS Code Server locally',
  copyingWithScp: 'Copying VS Code Server to host with scp',
  installing: 'Installing VS Code Server',
  settingUpTunnel: 'Setting up SSH tunnel',
  waitingForForwarding: 'Waiting for port forwarding to be ready',
  serverDownloadPercent: 'Downloading VS Code Server',
};

/** The part of a typed `[user@]host[:port]` text that names the host. */
function hostOfText(text: string): string {
  const afterUser = text.slice(text.lastIndexOf('@') + 1);
  const colons = afterUser.split(':').length - 1;
  return colons === 1 ? afterUser.replace(/:\d+$/, '') : afterUser;
}

/**
 * The host the progress names: the alias of a configured host exactly as the authority wrote it, or the bare host
 * name of a typed `user@host:port`, never the address an alias resolves to.
 */
export function displayHostOf(target: DecodedTarget): string {
  const {target: sshTarget} = target;
  if (!('kind' in sshTarget)) {
    return '';
  }
  return sshTarget.kind === 'host'
    ? sshTarget.hostName
    : hostOfText(sshTarget.text);
}

/** The title of the progress while the connect is in a phase. */
export function progressTitle(
  phase: ConnectPhase | undefined,
  target: DecodedTarget,
  translate: Translate,
): string {
  return filled(translate, TITLE_TEMPLATE, [
    displayHostOf(target),
    filled(translate, PHASE_TEMPLATES[phase?.name ?? 'initializing']),
  ]);
}
