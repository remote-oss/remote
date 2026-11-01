/**
 * @fileoverview The registration of the container connector: the resolver of the `dev-container` authority behind the
 * activation's own readiness, the window's label (the named one once a resolve settles with the connection up, the
 * unnamed one once the window is disconnected, never while a failure dialog is open) and the command the progress's
 * "(show log)" link runs. The first connection of a window also stores its Open Recent entry with its label.
 */

import {
  type LabelFormatterHost,
  enablePortsViewWhenConnected,
  type PortsViewHost,
  type Registration,
  registerAuthorityLabel,
  registerResolver,
  type ResolverEditor,
  type ResolverEditorOptions,
} from 'lib-authority';
import type {CommandHost} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {
  type DevContainerFolder,
  decodedFolderOf,
} from '../authority/payload.ts';
import {runtimeCommands} from '../identifiers.generated.ts';
import type {Forwarder} from '../ports/forwarder.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  type RecoveryPorts,
  recoveryPresenterOf,
} from '../surfaces/recovery-presenter.ts';
import type {ContainerConnector} from './connector.ts';
import {phaseTitleOf, startTitleOf} from './progress-titles.ts';
import type {IntentMemento} from '../state/timed-store.ts';
import {knownName, recordKnownName} from './known-names.ts';
import {type RecentLabelPorts, storeRecentLabel} from './recent-label.ts';
import {workspaceSuffixOf} from './window-identity.ts';

/** How long a connect runs before its progress shows, so that a connect to a running container shows none. */
const PROGRESS_DELAY_MILLISECONDS = 500;

/**
 * What the extension decides about its editor adapter: the details link and nothing about ports. The resolver then
 * gives core no tunnel factory, no tunnel features and no candidate port source, so core's own detection and forwards
 * serve the window.
 */
export const RESOLVER_EDITOR_OPTIONS: ResolverEditorOptions = {
  detailsCommand: runtimeCommands.revealLogTerminal,
};

/** What the registration needs of the editor. */
export interface ConnectorRegistrationHost {
  resolverEditor: ResolverEditor;
  labels: LabelFormatterHost;
  /** Core's Ports view, which the connected window enables. */
  portsView: PortsViewHost;
  commands: CommandHost;
  presenter: Omit<RecoveryPorts, 'disconnected'>;
  /** The Open Recent entry of the window, which gets its label once the window first connects. */
  recentLabel: RecentLabelPorts;
  /** The profile's global state, which keeps the names of the folders it connected. */
  knownNames: IntentMemento;
  translate: Translate;
  /** Opens the forwards the connection declares, once core has the connection. */
  forwarder: Forwarder;
}

/** The path of the configuration file a folder's target names. */
function configFileOf(folder: DevContainerFolder): string {
  return folder.configFile.fsPath ?? folder.configFile.path;
}

/** What the activation hands over: whether the proposed resolvers API is there, and the log to reveal. */
export interface ConnectorServed {
  /** Whether the editor grants the resolvers proposal. */
  resolversGranted: boolean;
  revealLog(): void;
  /** The extension's log, for a canonical mapping that failed. */
  logger: Logger;
}

/** Registers the resolver, the label and the log command. */
export async function registerContainerResolver(
  host: ConnectorRegistrationHost,
  connector: ContainerConnector,
  served: ConnectorServed,
): Promise<{registration: Registration['kind']; dispose(): void}> {
  const {translate} = host;
  let handle:
    Extract<Registration, {kind: 'registered'}>['resolver'] | undefined;
  function currentTarget(): DevContainerFolder | undefined {
    return decodedFolderOf(handle?.currentConnection()?.decodedTarget);
  }
  let label: {dispose(): void} | undefined;
  let disposed = false;
  let recentLabelStored = false;
  let dialogs = 0;
  /**
   * The label of a window that is disconnected and has none yet: the name this profile last connected the folder with,
   * else none; never while a dialog is open.
   */
  function registerDisconnectedLabel(): void {
    const target = handle?.currentConnection()?.decodedTarget;
    if (target === undefined || label !== undefined || disposed) {
      return;
    }
    const folder = decodedFolderOf(target);
    label = registerAuthorityLabel(
      host.labels,
      target,
      workspaceSuffixOf(
        folder === undefined
          ? undefined
          : knownName(host.knownNames, folder.hostPath, configFileOf(folder)),
        translate,
      ),
    );
  }
  // First, before anything that can fail: the command only shows the log, so it works without the proposals.
  const logCommand = host.commands.registerCommand(
    runtimeCommands.revealLogTerminal,
    () => {
      served.revealLog();
    },
  );
  const dialogPresenter = recoveryPresenterOf(
    {...host.presenter, disconnected: registerDisconnectedLabel},
    () => currentTarget(),
    () => connector.failedContainer(),
    translate,
  );
  const registration = await registerResolver(
    host.resolverEditor,
    {
      family: 'dev-container',
      connector,
      presenter: {
        present: async failed => {
          dialogs += 1;
          try {
            return await dialogPresenter.present(failed);
          } finally {
            dialogs -= 1;
          }
        },
      },
      cancellable: false,
      determinateStages: true,
      allowsTrust: false,
      titleOf: phase => phaseTitleOf(phase, translate),
      startTitle: () => startTitleOf(translate),
      progressDelayMilliseconds: PROGRESS_DELAY_MILLISECONDS,
      canonical: {
        pathOf: uri => connector.canonicalPathOf(uri.authority, uri.path),
        warn: message => {
          served.logger.warn(message);
        },
      },
    },
    {
      guard: () => Promise.resolve('serving'),
      resolversGranted: () => Promise.resolve(served.resolversGranted),
    },
  );
  if (registration.kind === 'registered') {
    const {resolver} = registration;
    handle = resolver;
    enablePortsViewWhenConnected(resolver, host.portsView, served.logger);
    resolver.onResolveSettled(() => {
      const connection = resolver.currentConnection();
      if (connection === undefined || disposed) {
        return;
      }
      if (connection.state === 'connected') {
        void host.forwarder.forward(connector.heldPorts());
        label?.dispose();
        label = registerAuthorityLabel(
          host.labels,
          connection.decodedTarget,
          workspaceSuffixOf(connector.heldIdentity(), translate),
        );
        const folder = decodedFolderOf(connection.decodedTarget);
        if (folder !== undefined) {
          void recordKnownName(
            host.knownNames,
            folder.hostPath,
            configFileOf(folder),
            connector.heldIdentity() ?? {name: undefined, context: undefined},
          ).catch((caught: unknown) => {
            served.logger.warn(
              `the name of the connection could not be kept: ${caught instanceof Error ? caught.message : String(caught)}`,
            );
          });
        }
        if (folder !== undefined && !recentLabelStored) {
          recentLabelStored = true;
          void storeRecentLabel(
            host.recentLabel,
            translate,
            served.logger,
            folder,
            connector.heldIdentity()?.context,
          );
        }
      } else {
        queueMicrotask(() => {
          if (dialogs === 0) {
            registerDisconnectedLabel();
          }
        });
      }
    });
  }
  return {
    registration: registration.kind,
    dispose: () => {
      disposed = true;
      label?.dispose();
      logCommand.dispose();
      if (registration.kind === 'registered') {
        registration.resolver.dispose();
      }
    },
  };
}
