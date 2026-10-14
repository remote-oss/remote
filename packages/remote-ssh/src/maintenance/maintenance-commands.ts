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
  payloadOf,
  pickedTarget,
} from '../connect/connect-commands.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {NoticePort} from '../surfaces/notice.ts';
import type {Translate} from '../surfaces/strings.ts';
import type {MaintenanceRun} from './maintenance-run.ts';
import {killCurrentPlan, uninstallOwnHostPlan} from './own-host.ts';
import {isOwnHost, killedNotice, killFailedNotice} from './target.ts';

/** What the maintenance commands take from the editor. */
export type MaintenanceEditor = Pick<
  ConnectCommandEditor,
  'listHosts' | 'pickHost' | 'runCommand' | 'switchToLocalWindow'
>;

/** What the commands run a maintenance step through, and show its result with. */
export interface MaintenancePorts {
  editor: MaintenanceEditor;
  /** Runs the kill or the uninstall on the host in a connection of its own. */
  perform(
    action: 'kill' | 'uninstall',
    target: SshTarget,
  ): Promise<MaintenanceRun>;
  /** The host and the connection mode of the window's held connection, or nothing when it holds none that is open. */
  heldHost(): {target: SshTarget; terminalMode: boolean} | undefined;
  /** Ends the local connection server of the host string and forgets its stored details; silent when none runs. */
  killLocalServer(hostString: string): PromiseLike<void>;
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
  cleanCurrentRemoteServer: CommandHandler;
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

  /** The window's own host when `target` is it, and the held connection's mode. */
  function ownHostOf(
    target: SshTarget,
  ): {target: SshTarget; terminalMode: boolean} | undefined {
    const held = ports.heldHost();
    return held !== undefined && isOwnHost(target, held.target)
      ? held
      : undefined;
  }

  /** The kill on the window's own host: the plan of the connection mode decides what happens to the window. */
  async function killOwnHost(held: {
    target: SshTarget;
    terminalMode: boolean;
  }): Promise<void> {
    const plan = killCurrentPlan(!held.terminalMode);
    if (plan.actsOnHost) {
      await killOnHost(held.target);
      return;
    }
    await ports.killLocalServer(payloadOf(held.target));
    void notify(killedNotice(held.target.host));
    if (plan.switchesToLocalWindow) {
      await ports.editor.switchToLocalWindow();
    }
  }

  /** The uninstall on the window's own host, by the same plan. */
  async function uninstallOwnHost(held: {
    target: SshTarget;
    terminalMode: boolean;
  }): Promise<void> {
    const plan = uninstallOwnHostPlan(!held.terminalMode);
    if (plan.actsOnHost) {
      await uninstallOnHost(held.target);
      return;
    }
    await ports.killLocalServer(payloadOf(held.target));
    if (plan.switchesToLocalWindow) {
      await ports.editor.switchToLocalWindow();
    }
  }

  async function killOnHost(target: SshTarget): Promise<void> {
    const outcome = await ports.perform('kill', target);
    if (outcome.result !== 'stepRan') {
      ports.logger.warn(`the kill failed: ${outcome.cause}`);
    } else {
      await ports.killLocalServer(payloadOf(target));
    }
    await notify(
      outcome.result === 'stepRan'
        ? killedNotice(target.host)
        : killFailedNotice(target.host),
    );
  }

  async function uninstallOnHost(target: SshTarget): Promise<void> {
    const outcome = await ports.perform('uninstall', target);
    if (outcome.result === 'cancelled') {
      return;
    }
    if (outcome.result === 'connectionFailed') {
      ports.logger.warn(`the uninstall failed: ${outcome.cause}`);
      throw new Error(UNINSTALL_FAILED);
    }
    await ports.killLocalServer(payloadOf(target));
  }

  return {
    cleanRemoteServer: {
      execute: async () => {
        const target = await pickedTarget(ports.editor);
        if (target === undefined) {
          return;
        }
        const own = ownHostOf(target);
        await (own === undefined ? killOnHost(target) : killOwnHost(own));
      },
    },
    cleanDevBox: {
      execute: async () => {
        const target = await pickedTarget(ports.editor);
        if (target === undefined) {
          return;
        }
        const own = ownHostOf(target);
        await (own === undefined
          ? uninstallOnHost(target)
          : uninstallOwnHost(own));
      },
    },
    cleanCurrentRemoteServer: {
      execute: async () => {
        const held = ports.heldHost();
        if (held !== undefined) {
          await killOwnHost(held);
        }
      },
    },
  };
}
