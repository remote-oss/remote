/**
 * @fileoverview The registration of the container connector: the resolver of the `dev-container` authority behind the
 * activation's own readiness, the window's label once the first resolve settles with the connection up, and the
 * command the progress's "(show log)" link runs.
 */

import {
  type LabelFormatterHost,
  type Registration,
  registerAuthorityLabel,
  registerResolver,
  type ResolverEditor,
} from 'lib-authority';
import type {CommandHost} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {
  type DevContainerFolder,
  decodedFolderOf,
} from '../authority/payload.ts';
import {runtimeCommands} from '../identifiers.generated.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  type RecoveryPorts,
  recoveryPresenterOf,
} from '../surfaces/recovery-presenter.ts';
import type {ContainerConnector} from './connector.ts';
import {phaseTitleOf, startTitleOf} from './progress-titles.ts';
import {workspaceSuffixOf} from './window-identity.ts';

/** What the registration needs of the editor. */
export interface ConnectorRegistrationHost {
  resolverEditor: ResolverEditor;
  labels: LabelFormatterHost;
  commands: CommandHost;
  presenter: RecoveryPorts;
  translate: Translate;
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
  const registration = await registerResolver(
    host.resolverEditor,
    {
      family: 'dev-container',
      connector,
      presenter: recoveryPresenterOf(
        host.presenter,
        () => currentTarget(),
        translate,
      ),
      cancellable: false,
      allowsTrust: false,
      titleOf: phase => phaseTitleOf(phase, translate),
      startTitle: () => startTitleOf(translate),
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
  const logCommand = host.commands.registerCommand(
    runtimeCommands.revealLogTerminal,
    () => {
      served.revealLog();
    },
  );
  let label: {dispose(): void} | undefined;
  let disposed = false;
  if (registration.kind === 'registered') {
    const {resolver} = registration;
    handle = resolver;
    resolver.onResolveSettled(() => {
      const connection = resolver.currentConnection();
      if (connection === undefined || disposed) {
        return;
      }
      if (connection.state === 'connected') {
        label?.dispose();
        label = registerAuthorityLabel(
          host.labels,
          connection.decodedTarget,
          workspaceSuffixOf(connector.heldIdentity(), translate),
        );
      } else if (label === undefined) {
        label = registerAuthorityLabel(
          host.labels,
          connection.decodedTarget,
          workspaceSuffixOf(undefined, translate),
        );
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
