/**
 * @fileoverview The server maintenance commands that act on a picked host: Kill VS Code Server on Host and Uninstall
 * VS Code Server from Host. Each is a handler over the ports of the editor and of the connection; none imports the
 * editor.
 */

import type {CommandHandler} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import type {SshTarget} from 'lib-ssh';
import {
  type ConnectCommandEditor,
  pickedTarget,
} from '../connect/connect-commands.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {NoticePort} from '../surfaces/notice.ts';
import type {Translate} from '../surfaces/strings.ts';
import type {MaintenanceRun} from './maintenance-run.ts';
import {killedNotice, killFailedNotice} from './target.ts';

/** What the maintenance commands take from the editor. */
export type MaintenanceEditor = Pick<
  ConnectCommandEditor,
  'listHosts' | 'pickHost' | 'runCommand'
>;

/** What the commands run a maintenance step through, and show its result with. */
export interface MaintenancePorts {
  editor: MaintenanceEditor;
  /** Runs the kill or the uninstall on the host in a connection of its own. */
  perform(
    action: 'kill' | 'uninstall',
    target: SshTarget,
  ): Promise<MaintenanceRun>;
  notice: NoticePort;
  translate: Translate;
  /** Reveals the connection's log: what "Open Logs" does. */
  revealLog(): void;
  logger: Logger;
}

/** The detail of the error an uninstall that could not run ends in; the editor shows it in its own frame. */
const UNINSTALL_FAILED = 'Failed to run command';

/** The two handlers over `ports`. */
export function maintenanceHandlers(ports: MaintenancePorts): {
  cleanRemoteServer: CommandHandler;
  cleanDevBox: CommandHandler;
} {
  const {translate} = ports;
  const openLogs = ownText({id: 'S101', values: []}, translate);

  async function notify(reference: {
    id: string;
    values: string[];
  }): Promise<void> {
    const taken = await ports.notice.showInformation(
      ownText(reference, translate),
      [openLogs],
    );
    if (taken === openLogs) {
      ports.revealLog();
    }
  }

  return {
    cleanRemoteServer: {
      execute: async () => {
        const target = await pickedTarget(ports.editor);
        if (target === undefined) {
          return;
        }
        const outcome = await ports.perform('kill', target);
        if (outcome.result === 'connectionFailed') {
          ports.logger.warn(`the kill failed: ${outcome.cause}`);
        }
        await notify(
          outcome.result === 'stepRan'
            ? killedNotice(target.host)
            : killFailedNotice(target.host),
        );
      },
    },
    cleanDevBox: {
      execute: async () => {
        const target = await pickedTarget(ports.editor);
        if (target === undefined) {
          return;
        }
        const outcome = await ports.perform('uninstall', target);
        if (outcome.result === 'connectionFailed') {
          ports.logger.warn(`the uninstall failed: ${outcome.cause}`);
          throw new Error(UNINSTALL_FAILED);
        }
      },
    },
  };
}
