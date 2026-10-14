/**
 * @fileoverview The connect commands: Connect to Host in a new window, Connect Current Window to Host, Connect to
 * the active host, and Kill Local Connection Server. The first, the second and the last share one flow, the host
 * pick; each is a handler over the ports of the editor and of the window's connection, so none imports the editor.
 */

import {sshRemoteCodec} from 'lib-authority';
import type {HostListResult, SshTarget} from 'lib-ssh';
import {commands} from '../identifiers.generated.ts';
import type {ConnectTarget} from '../pipeline/steps.ts';
import {
  outcomeOfPick,
  type PickerItem,
  type PickerModel,
  pickerModel,
} from './picker-model.ts';
import {
  activeHostTarget,
  argumentChoice,
  type ConnectSource,
  isActiveHostAvailable,
  type WindowTarget,
  windowTargetOf,
} from './window-target.ts';

/** The authority family every connect command opens. */
const AUTHORITY_PREFIX = 'ssh-remote+';

/** What the connect commands take from the editor. */
export interface ConnectCommandEditor {
  /** The hosts of the files in effect, read at each call. */
  listHosts(): HostListResult;
  /**
   * Shows the host pick, open when the focus moves away, starting from `initial`; `modelOf` gives the rows for the
   * text typed so far. Gives the picked row, or nothing when the pick is closed without one.
   */
  pickHost(
    initial: PickerModel,
    modelOf: (typedText: string) => PickerModel,
  ): PromiseLike<PickerItem | undefined>;
  /** Opens an empty window on the authority in the window asked for; a refusal rejects. */
  openRemote(authority: string, window: WindowTarget): PromiseLike<unknown>;
  /** Runs an editor command by its id. */
  runCommand(commandId: string): PromiseLike<unknown>;
  /** Turns the window into an empty local window, the same window. */
  switchToLocalWindow(): PromiseLike<unknown>;
  /** The remote name of the window, such as `ssh-remote`; nothing in a local window. */
  remoteName(): string | undefined;
}

/** What the connect commands take from the window's connection. */
export interface ConnectCommandConnection {
  /** Ends the local connection server of the host string; silent, also when none runs. */
  killLocalServer(hostString: string): PromiseLike<void>;
  /** The window's connection: its target and its state; nothing before the first resolve. */
  current(): {target: SshTarget; state: string} | undefined;
}

/** The commands this module serves. */
export interface ConnectCommandHandlers {
  openEmptyWindow: {execute(...commandArguments: unknown[]): Promise<void>};
  openEmptyWindowInCurrentWindow: {
    execute(...commandArguments: unknown[]): Promise<void>;
  };
  openEmptyWindowOnCurrentHost: {execute(): Promise<void>};
  cleanLocalServer: {execute(): Promise<void>};
}

/** The target as an authority names it: the plain host text, or the host with its user and port. */
export function connectTargetOf(target: SshTarget): ConnectTarget {
  return target.user === undefined && target.port === undefined
    ? {kind: 'plain', text: target.host}
    : {
        kind: 'host',
        hostName: target.host,
        ...(target.user === undefined ? {} : {user: target.user}),
        ...(target.port === undefined ? {} : {port: target.port}),
      };
}

/** The authority that opens a window on the host as the user wrote it. */
export function plainAuthority(host: string): string {
  return AUTHORITY_PREFIX + sshRemoteCodec.encode({kind: 'plain', text: host});
}

/** The text of an authority's payload for a target: plain as written, or the hex form the codec chooses. */
export function payloadOf(target: SshTarget): string {
  return sshRemoteCodec.encode(connectTargetOf(target));
}

/** The rows for a typed text over a host list that parsed; a list that did not parse stops the command. */
function modelFor(listing: HostListResult, typedText: string): PickerModel {
  const model = pickerModel(listing, typedText);
  if ('parseError' in model) {
    throw new Error(`${model.parseError.file}: ${model.parseError.reason}`);
  }
  return model;
}

/**
 * The target the user picks or types in the host pick, or nothing on Escape. A fixed row hands over to its command
 * and gives nothing. A configuration file that cannot be parsed shows no pick: the command fails with the parser's
 * message, which the editor shows as its own error.
 */
export async function pickedTarget(
  editor: Pick<ConnectCommandEditor, 'listHosts' | 'pickHost' | 'runCommand'>,
): Promise<SshTarget | undefined> {
  const listing = editor.listHosts();
  const item = await editor.pickHost(modelFor(listing, ''), typedText =>
    modelFor(listing, typedText),
  );
  if (item === undefined) {
    return undefined;
  }
  const outcome = outcomeOfPick(item);
  if ('connect' in outcome) {
    return outcome.connect;
  }
  await editor.runCommand(
    outcome.handOver === 'configure'
      ? commands.openConfigFile.id
      : commands.addNewSshHost.id,
  );
  return undefined;
}

/** The handler of a picker command: the argument's host opens at once; otherwise the pick decides. */
function openHandler(editor: ConnectCommandEditor, source: ConnectSource) {
  return {
    execute: async (...commandArguments: unknown[]): Promise<void> => {
      const choice = argumentChoice(commandArguments[0]);
      if ('host' in choice) {
        await editor.openRemote(
          plainAuthority(choice.host),
          windowTargetOf(source),
        );
        return;
      }
      const target = await pickedTarget(editor);
      if (target !== undefined) {
        await editor.openRemote(
          AUTHORITY_PREFIX + payloadOf(target),
          windowTargetOf(source),
        );
      }
    },
  };
}

/** The four handlers over the editor and the window's connection. */
export function connectCommandHandlers(
  editor: ConnectCommandEditor,
  connection: ConnectCommandConnection,
): ConnectCommandHandlers {
  return {
    openEmptyWindow: openHandler(editor, commands.openEmptyWindow.id),
    openEmptyWindowInCurrentWindow: openHandler(
      editor,
      commands.openEmptyWindowInCurrentWindow.id,
    ),
    openEmptyWindowOnCurrentHost: {
      execute: async () => {
        const current = connection.current();
        if (
          current === undefined ||
          !isActiveHostAvailable(editor.remoteName(), current.state)
        ) {
          return;
        }
        await editor.openRemote(
          AUTHORITY_PREFIX + payloadOf(activeHostTarget(current.target)),
          windowTargetOf(commands.openEmptyWindowOnCurrentHost.id),
        );
      },
    },
    cleanLocalServer: {
      execute: async () => {
        const target = await pickedTarget(editor);
        if (target !== undefined) {
          await connection.killLocalServer(payloadOf(target));
        }
      },
    },
  };
}
