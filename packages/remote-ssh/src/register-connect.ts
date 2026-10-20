/**
 * @fileoverview The connect's registration once activation serves: the resolver behind activation's own readiness,
 * and, once it is registered, the window's label. The connect commands, Open Web UI, the hint clearing and the progress's
 * details command are registered whatever the editor grants: without the resolvers proposal only the resolver and what
 * hangs on it are held back. Nothing here imports the editor.
 */

import {
  type LabelFormatterHost,
  type LastResolve,
  type SshTarget,
  type Registration,
  registerResolver,
  type ResolverEditor,
} from 'lib-authority';
import {
  type CommandHost,
  type Registration as CommandRegistration,
  registerCommands,
} from 'lib-identifiers';
import {
  addNewSshHostHandler,
  type AddHostSurroundings,
} from './config/add-host-command.ts';
import type {ConnectAssembly} from './connect-ports.ts';
import {
  type ConnectCommandEditor,
  connectCommandHandlers,
} from './connect/connect-commands.ts';
import {commands, runtimeCommands} from './identifiers.generated.ts';
import {hostAlias, sshTargetOf} from './pipeline/host-settings.ts';
import {maintenanceHandlers} from './maintenance/maintenance-commands.ts';
import type {NoticePort} from './surfaces/notice.ts';
import {
  enablePortsViewWhenConnected,
  type PortsViewHost,
  registerWindowLabel,
} from './surfaces/label-formatter.ts';
import type {Translate} from './surfaces/strings.ts';
import {openWebUiHandler} from './surfaces/web-ui-command.ts';
import type {Logger} from 'lib-log';
import {
  clearHintsHandler,
  type HintStoreState,
} from './diagnostics/clear-hints-command.ts';

/** What the connect's registration needs of the editor. */
export interface ConnectRegistrationHost {
  resolverEditor: ResolverEditor;
  labels: LabelFormatterHost;
  /** Core's Ports view, which the connected window enables. */
  portsView: PortsViewHost;
  commands: CommandHost;
  /** The editor behind the connect commands. */
  connectEditor: ConnectCommandEditor;
  /** Opens an address outside the editor. */
  openExternal(address: string): PromiseLike<boolean>;
  translate: Translate;
  /** The extension's global state, where the hint store's key lives. */
  globalState: HintStoreState;
  /** The window's log the clear command writes to. */
  logger: Logger;
  /** The non-modal notices the maintenance commands show. */
  notice: NoticePort;
  /** What the command that adds a host takes besides the notices and the window it opens. */
  addHost: AddHostSurroundings;
}

/** What the registration gives back: whether the resolver is registered, and the end of everything it registered. */
export interface ConnectRegistration {
  registration: Registration['kind'];
  /** The host alias of the window's connection, as the user wrote it; empty before the first resolve. */
  currentAlias(): string;
  /**
   * The window's connection: the authority's host part as written, and how its last settled resolve ended; nothing
   * before the first resolve starts or without a resolver.
   */
  activeConnection(): {hostKey: string; lastResolve: LastResolve} | undefined;
  /** Calls the listener when the session's first resolve settles; it never does without a resolver. */
  onFirstResolveSettled(listener: () => void): void;
  dispose(): void;
}

/**
 * Registers the connect. `resolversGranted` is what activation's probe found, so the editor is not probed again; the
 * guard has already decided to serve.
 */
export async function registerConnect(
  host: ConnectRegistrationHost,
  assembly: ConnectAssembly,
  resolversGranted: boolean,
): Promise<ConnectRegistration> {
  const registration = await registerResolver(
    host.resolverEditor,
    assembly.options,
    {
      guard: () => Promise.resolve('serving'),
      resolversGranted: () => Promise.resolve(resolversGranted),
    },
  );
  const resolver =
    registration.kind === 'registered' ? registration.resolver : undefined;
  const label =
    resolver === undefined
      ? undefined
      : registerWindowLabel(resolver, host.labels, host.translate);
  if (resolver !== undefined) {
    enablePortsViewWhenConnected(resolver, host.portsView, host.logger);
  }
  const connection = {
    killLocalServer: (hostString: string) =>
      assembly.killLocalServer(hostString),
    current: () => {
      const current = resolver?.currentConnection();
      // This resolver serves only ssh-remote authorities, so its target is always an ssh target.
      return current === undefined
        ? undefined
        : {
            target: sshTargetOf(current.decodedTarget.target as SshTarget),
            state: current.state,
          };
    },
  };
  const served: CommandRegistration = registerCommands(
    host.commands,
    'serving',
    {
      openWebUI: commands.openWebUI,
      clearAllSessionHints: commands.clearAllSessionHints,
      openEmptyWindow: commands.openEmptyWindow,
      openEmptyWindowInCurrentWindow: commands.openEmptyWindowInCurrentWindow,
      openEmptyWindowOnCurrentHost: commands.openEmptyWindowOnCurrentHost,
      cleanLocalServer: commands.cleanLocalServer,
      addNewSshHost: commands.addNewSshHost,
      cleanRemoteServer: commands.cleanRemoteServer,
      cleanDevBox: commands.cleanDevBox,
      cleanCurrentRemoteServer: commands.cleanCurrentRemoteServer,
    },
    {
      ...connectCommandHandlers(host.connectEditor, connection),
      addNewSshHost: addNewSshHostHandler({
        ...host.addHost,
        windows: host.connectEditor,
        notice: host.notice,
        translate: host.translate,
      }),
      ...maintenanceHandlers({
        editor: host.connectEditor,
        perform: (action, target) => assembly.maintain(action, target),
        heldHost: () => assembly.connector.heldHost(),
        killLocalServer: hostString => connection.killLocalServer(hostString),
        leaveWindow: () => {
          resolver?.leave();
        },
        stayInWindow: () => {
          resolver?.stay();
        },
        notice: host.notice,
        translate: host.translate,
        revealLog: () => {
          assembly.connector.revealDetails();
        },
        logger: host.logger,
      }),
      openWebUI: openWebUiHandler({
        // Without a resolver the window has no connection, so no server is known, as in a local window.
        serverPort: () =>
          resolver === undefined ? 'none' : assembly.connector.serverPort(),
        openExternal: address => host.openExternal(address),
      }),
      clearAllSessionHints: clearHintsHandler(host.globalState, host.logger),
    },
  );
  const details = host.commands.registerCommand(
    runtimeCommands.showDetails,
    () => {
      if (resolver !== undefined) {
        assembly.connector.revealDetails();
      }
    },
  );
  return {
    registration: registration.kind,
    currentAlias: () => {
      const target = resolver?.currentConnection()?.decodedTarget.target;
      return target !== undefined && 'kind' in target ? hostAlias(target) : '';
    },
    activeConnection: () => {
      const current = resolver?.currentConnection();
      return resolver === undefined || current === undefined
        ? undefined
        : {
            hostKey: current.decodedTarget.rawHostString,
            lastResolve: resolver.lastResolve(),
          };
    },
    onFirstResolveSettled: listener => {
      resolver?.onFirstResolveSettled(listener);
    },
    dispose: () => {
      details.dispose();
      served.dispose();
      label?.dispose();
      resolver?.dispose();
    },
  };
}
