/**
 * @fileoverview The registration of the container connector: the resolver of the `dev-container` authority behind the
 * activation's own readiness, the window's label (the named one once a resolve settles with the connection up, the
 * unnamed one once the window is disconnected, never while a failure dialog is open) and the command the progress's
 * "(show log)" link runs. The first connection of a window also stores its Open Recent entry with its label.
 */

import {
  type ContainerTarget,
  type DecodedTarget,
  type LabelFormatterHost,
  type LastResolve,
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
import {attachedSuffixOf} from '../attach/label.ts';
import {attachPickKeyOf} from '../attach/pick-record.ts';
import {attachedTargetOf} from '../attach/payload.ts';
import {k8sLabelOf} from '../attach/k8s-label.ts';
import {k8sPickKeyOf} from '../attach/k8s-pick-record.ts';
import {k8sTargetOf, podShaped} from '../attach/k8s-payload.ts';
import {runtimeCommands} from '../identifiers.generated.ts';
import type {Forwarder} from '../ports/forwarder.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {attachRecoveryPresenterOf} from '../surfaces/attach-recovery.ts';
import {
  type RecoveryPorts,
  recoveryPresenterOf,
} from '../surfaces/recovery-presenter.ts';
import type {ContainerConnector} from './connector.ts';
import {attachWarningRefused, malformedAuthority} from './failures.ts';
import {phaseTitleOf, startTitleOf} from './progress-titles.ts';
import {volumeTargetOf} from '../volumes/volume-payload.ts';
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
): Promise<{
  registration: Registration['kind'];
  /** How this window's last settled resolve ended; none before the first. */
  lastResolve(): LastResolve;
  dispose(): void;
}> {
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
   * The label of a window that is disconnected and has none yet: the name the latest attempt read from the
   * configuration, kept once its container was ready, or the name this profile last connected the folder with, else
   * none; never while a dialog is open.
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
        connector.attemptIdentity() ??
          (folder === undefined
            ? undefined
            : knownName(
                host.knownNames,
                folder.hostPath,
                configFileOf(folder),
              )),
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
    () => {
      const decoded = handle?.currentConnection()?.decodedTarget;
      return (
        decoded !== undefined &&
        'payload' in decoded.target &&
        volumeTargetOf(decoded.target.payload) !== undefined
      );
    },
  );
  /** The connector for the `dev-container` authority, which decodes only its own payloads: one that reads as an attached container or a pod is malformed here. */
  const decoding: ContainerConnector = {
    ...connector,
    connect: input => {
      const {payload} = input.target as ContainerTarget;
      return 'malformed' in attachedTargetOf(payload) && !podShaped(payload)
        ? connector.connect(input)
        : Promise.resolve(malformedAuthority());
    },
  };
  const registration = await registerResolver(
    host.resolverEditor,
    {
      family: 'dev-container',
      connector: decoding,
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
      allowsTrust: true,
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
    lastResolve: () => handle?.lastResolve() ?? 'none',
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

/** What the attached families' registration needs beyond the container family's. */
export interface AttachedRegistrationPorts {
  /** Reopens the picker of running containers in this window. */
  chooseContainer(): PromiseLike<unknown>;
  /** Whether the user picked the target named `key`: the command or a row action recorded it before it opened the window. */
  picked(key: string): boolean;
  /** Records the target named `key` as picked. */
  record(key: string): Promise<void>;
  /** The attach warning, asked whatever was answered before; whether the user confirmed. */
  confirm(): Promise<boolean>;
}

/** What differs between the families that register through the attach family's registration. */
export interface AttachedFamily {
  /** The authority family the resolver is registered for. */
  family: 'attached-container' | 'k8s-container';
  /** The name of the target a payload names in the record of picks; none for a payload that names no target. */
  pickKeyOf(payload: string): string | undefined;
  /** The suffix of the label a failure that leaves the window disconnected sets; none when the payload names none. */
  disconnectedSuffixOf(decoded: DecodedTarget | undefined): string | undefined;
}

/** The attached container family: the label of the container the attempt found, with the engine the payload pins. */
export function attachedContainerFamilyOf(
  connector: ContainerConnector,
  translate: Translate,
): AttachedFamily {
  return {
    family: 'attached-container',
    pickKeyOf: payload => {
      const target = attachedTargetOf(payload);
      return 'malformed' in target ? undefined : attachPickKeyOf(target);
    },
    disconnectedSuffixOf: decoded => {
      const target =
        decoded !== undefined && 'payload' in decoded.target
          ? attachedTargetOf(decoded.target.payload)
          : undefined;
      if (target === undefined || 'malformed' in target) {
        return undefined;
      }
      const found = connector.attachedContainer();
      return attachedSuffixOf(
        found === undefined
          ? undefined
          : {image: found.image, name: found.name},
        target,
        translate,
      );
    },
  };
}

/** The Kubernetes pod family: the label of the container the payload names, which it carries itself. */
export function k8sContainerFamilyOf(translate: Translate): AttachedFamily {
  return {
    family: 'k8s-container',
    pickKeyOf: payload => {
      const target = k8sTargetOf(payload);
      return 'malformed' in target ? undefined : k8sPickKeyOf(target);
    },
    disconnectedSuffixOf: decoded => {
      const target =
        decoded !== undefined && 'payload' in decoded.target
          ? k8sTargetOf(decoded.target.payload)
          : undefined;
      return target === undefined || 'malformed' in target
        ? undefined
        : k8sLabelOf(target, translate);
    },
  };
}

/**
 * Registers the resolver of an attached family's authority: the same connector, the attach family's presenter, shared by
 * the families (S033 and its recovery picker), and the window's label, which a failure that leaves the window
 * disconnected sets from `family`.
 */
export async function registerAttachedResolver(
  host: ConnectorRegistrationHost,
  connector: ContainerConnector,
  served: ConnectorServed,
  attached: AttachedRegistrationPorts,
  family: AttachedFamily,
): Promise<{registration: Registration['kind']; dispose(): void}> {
  const {translate} = host;
  let handle:
    Extract<Registration, {kind: 'registered'}>['resolver'] | undefined;
  let label: {dispose(): void} | undefined;
  /** The label of the disconnected window, from what the family reads of its payload. */
  function registerDisconnectedLabel(): void {
    const decoded = handle?.currentConnection()?.decodedTarget;
    const suffix = family.disconnectedSuffixOf(decoded);
    if (decoded === undefined || suffix === undefined) {
      return;
    }
    label?.dispose();
    label = registerAuthorityLabel(host.labels, decoded, suffix);
  }
  const presenter = attachRecoveryPresenterOf(
    {
      showError: (message, detail, buttons) =>
        host.presenter.showError(message, detail, buttons),
      pick: (placeholder, labels) => host.presenter.pick(placeholder, labels),
      startContainer: () => connector.startAttachedContainer(),
      chooseContainer: () => attached.chooseContainer(),
      closeRemote: () => host.presenter.closeRemote(),
      reloadWindow: () => host.presenter.reloadWindow(),
      openRecent: () => host.presenter.openRecent(),
      openExternal: address => host.presenter.openExternal(address),
      later: task => {
        host.presenter.later(task);
      },
      disconnected: registerDisconnectedLabel,
      logger: served.logger,
    },
    translate,
  );
  /**
   * The connector behind the gate (`ruling-2186-attach-gate`): a target the user didn't pick, such as one a link or an
   * old recent entry names, is connected only after the attach warning is confirmed, and confirming records it. Nothing
   * runs in the target before the answer.
   */
  const gated: ContainerConnector = {
    ...connector,
    connect: async input => {
      const payload = (input.target as ContainerTarget).payload;
      const key = family.pickKeyOf(payload);
      if (key === undefined) {
        return malformedAuthority();
      }
      if (!attached.picked(key)) {
        if (!(await attached.confirm())) {
          served.logger.info('the attach warning was not confirmed');
          return attachWarningRefused();
        }
        await attached.record(key);
      }
      return connector.connect(input);
    },
  };
  const registration = await registerResolver(
    host.resolverEditor,
    {
      family: family.family,
      connector: gated,
      presenter,
      cancellable: false,
      determinateStages: true,
      allowsTrust: true,
      titleOf: phase => phaseTitleOf(phase, translate),
      startTitle: () => startTitleOf(translate),
      progressDelayMilliseconds: PROGRESS_DELAY_MILLISECONDS,
    },
    {
      guard: () => Promise.resolve('serving'),
      resolversGranted: () => Promise.resolve(served.resolversGranted),
    },
  );
  if (registration.kind === 'registered') {
    handle = registration.resolver;
  }
  return {
    registration: registration.kind,
    dispose: () => {
      label?.dispose();
      if (registration.kind === 'registered') {
        registration.resolver.dispose();
      }
    },
  };
}
