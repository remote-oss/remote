/**
 * @fileoverview The titles of the connection progress: the one it starts with, naming the host, and the message of
 * each stage of the connect, as references to the string table.
 */

import type {ConnectPhase, PhaseName} from 'lib-authority';
import {commands} from '../identifiers.generated.ts';
import type {StringRef} from '../connect/picker-model.ts';
import type {FailureStringId} from './failure-strings.ts';

/** The link the script's stage carries in place of the details link; neither word of it is translated. */
const SHOW_LOG_LINK = `[show log](command:${commands.showLog.id} "Show log")`;

/** The string id of each stage's message; the share downloaded has none, so it keeps the stage before it. */
const PHASE_IDS: Readonly<Record<PhaseName, FailureStringId | undefined>> = {
  initializing: 'S082',
  waitingForOtherWindow: 'S157',
  downloading: 'S041',
  downloadingLocally: 'S044',
  copyingWithScp: 'S029',
  installing: 'S084',
  settingUpTunnel: 'S130',
  waitingForForwarding: 'S158',
  startingServer: undefined,
  opened: undefined,
  runningPreconnectScript: 'S118',
  serverDownloadPercent: undefined,
};

/** The title the progress starts with, naming the host as the user wrote it. */
export function startTitleOf(alias: string): StringRef {
  return {id: 'S129', values: [alias]};
}

/** The message of the stage, or nothing when the stage has none and the last message stays. */
export function phaseTitleOf(phase: ConnectPhase): StringRef | undefined {
  const stringId = PHASE_IDS[phase.name];
  if (stringId === undefined) {
    return undefined;
  }
  return {
    id: stringId,
    values: phase.name === 'runningPreconnectScript' ? [SHOW_LOG_LINK] : [],
  };
}

/** The tooltip of the "(details)" link of a stage: "Show details in terminal" for the tunnel stage in the terminal mode, and none otherwise. */
export function detailsTitleOf(
  stage: string,
  terminalMode: boolean,
): StringRef | undefined {
  return stage === 'settingUpTunnel' && terminalMode
    ? {id: 'S132', values: []}
    : undefined;
}
