/**
 * @fileoverview The window opener: opens a folder, a workspace or an empty window on a remote authority or on this
 * machine, in the current window or a new one, and reloads or leaves the remote. It hands the editor's own commands
 * what the pure argument builders decided, and shows nothing: a refusal comes back as a value for the caller to
 * word.
 */

import {
  type OpenCommand,
  openLocalCommand,
  openRemoteCommand,
  type OpenTarget,
  type PathKind,
} from './arguments.ts';

/** The commands of the editor that reload the window and leave the remote side. */
const RELOAD_COMMAND = 'workbench.action.reloadWindow';
const CLOSE_REMOTE_COMMAND = 'workbench.action.remote.close';

/** What the opener needs of the editor: running a command, and making the editor's own address type. */
export interface OpenerHost {
  executeCommand(
    command: string,
    ...parameters: unknown[]
  ): PromiseLike<unknown>;
  /** The editor's address for a resource; `authority` is absent for a resource on this machine. */
  addressOf(parts: {scheme: string; authority?: string; path: string}): unknown;
}

/** The editor accepted the request, or refused it with this reason. */
export type OpenOutcome = {kind: 'opened'} | {kind: 'rejected'; reason: string};

/** A target to open: the folder or workspace file, or nothing for an empty window. */
export interface OpenRequest {
  path?: string;
  /** What `path` is, as told by the caller; never guessed here. */
  pathKind: PathKind;
  target: OpenTarget;
}

async function attempt(
  host: OpenerHost,
  command: string,
  ...parameters: unknown[]
): Promise<OpenOutcome> {
  try {
    await host.executeCommand(command, ...parameters);
    return {kind: 'opened'};
  } catch (caught) {
    return {
      kind: 'rejected',
      reason: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

/** Runs what the argument builder decided, turning its plain address into the editor's. */
function execute(host: OpenerHost, command: OpenCommand): Promise<OpenOutcome> {
  if (command.command === 'vscode.newWindow') {
    return attempt(host, command.command, command.options);
  }
  return attempt(
    host,
    command.command,
    host.addressOf(command.uri),
    command.options,
  );
}

/**
 * Opens `request` on `authority`: "current" reloads the calling window, even on the same target, and "new" opens
 * exactly one new window and never reuses one. A request without a path opens no folder.
 */
export function openRemote(
  host: OpenerHost,
  authority: string,
  request: OpenRequest,
): Promise<OpenOutcome> {
  return execute(
    host,
    openRemoteCommand(
      authority,
      request.path,
      request.pathKind,
      request.target,
    ),
  );
}

/** Opens `request` on this machine, as when a folder is reopened locally. */
export function openLocal(
  host: OpenerHost,
  request: OpenRequest,
): Promise<OpenOutcome> {
  return execute(
    host,
    openLocalCommand(request.path, request.pathKind, request.target),
  );
}

/** Reloads the window. */
export function reload(host: OpenerHost): Promise<OpenOutcome> {
  return attempt(host, RELOAD_COMMAND);
}

/** Leaves the remote side and returns the window to this machine. */
export function closeRemote(host: OpenerHost): Promise<OpenOutcome> {
  return attempt(host, CLOSE_REMOTE_COMMAND);
}
