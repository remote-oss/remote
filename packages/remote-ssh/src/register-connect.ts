/**
 * @fileoverview The connect's registration once activation serves: the resolver behind activation's own readiness,
 * and, once it is registered, the window's label, Open Web UI and the progress's details command. Nothing is
 * registered when the editor does not grant the resolvers proposal. Nothing here imports the editor.
 */

import {
  type LabelFormatterHost,
  type Registration,
  registerResolver,
  type ResolverEditor,
} from 'lib-authority';
import {
  type CommandHost,
  type Registration as CommandRegistration,
  registerCommands,
} from 'lib-identifiers';
import type {ConnectAssembly} from './connect-ports.ts';
import {commands, runtimeCommands} from './identifiers.generated.ts';
import {registerWindowLabel} from './surfaces/label-formatter.ts';
import type {Translate} from './surfaces/strings.ts';
import {openWebUiHandler} from './surfaces/web-ui-command.ts';

/** What the connect's registration needs of the editor. */
export interface ConnectRegistrationHost {
  resolverEditor: ResolverEditor;
  labels: LabelFormatterHost;
  commands: CommandHost;
  /** Opens an address outside the editor. */
  openExternal(address: string): PromiseLike<boolean>;
  translate: Translate;
}

/** What the registration gives back: whether the resolver is registered, and the end of everything it registered. */
export interface ConnectRegistration {
  registration: Registration['kind'];
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
  if (registration.kind !== 'registered') {
    return {registration: registration.kind, dispose: () => undefined};
  }
  const {resolver} = registration;
  const label = registerWindowLabel(resolver, host.labels, host.translate);
  const served: CommandRegistration = registerCommands(
    host.commands,
    'serving',
    {openWebUI: commands.openWebUI},
    {
      openWebUI: openWebUiHandler({
        serverPort: () => assembly.connector.serverPort(),
        openExternal: address => host.openExternal(address),
      }),
    },
  );
  const details = host.commands.registerCommand(
    runtimeCommands.showDetails,
    () => {
      assembly.connector.revealDetails();
    },
  );
  return {
    registration: 'registered',
    dispose: () => {
      details.dispose();
      served.dispose();
      label.dispose();
      resolver.dispose();
    },
  };
}
