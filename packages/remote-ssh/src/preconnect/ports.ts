/**
 * @fileoverview What the pre-connection step needs of the machine and of the editor.
 */

import type {ProcessSpawner} from 'lib-ssh';
import type {Logger} from 'lib-log';
import type {PreconnectDialog} from '../surfaces/preconnect-dialog.ts';
import type {PreconnectApprovals} from './approvals.ts';

/** The ports of the step. */
export interface PreconnectPorts {
  /** The file's bytes; rejects with the system's error, whose `message` is shown as it is. */
  readFile(file: string): Promise<Uint8Array>;
  /** Whether anything exists at the path: a file, a folder, anything `lstat` sees. */
  exists(file: string): Promise<boolean>;
  spawner: ProcessSpawner;
  /** The editor's environment, given to the script as it is. */
  environment: Readonly<Record<string, string>>;
  /** The editor process's working directory, which a relative path resolves against. */
  workingDirectory: string;
  /** The home folder `~/` expands to: the `HOME` the editor runs with. */
  home: string;
  approvals: PreconnectApprovals;
  dialog: PreconnectDialog;
  logger: Logger;
}
