/**
 * @fileoverview The clone inside the bootstrap container: a folder that holds files already is opened as it is;
 * otherwise the repository is cloned shallow at its ref, a commit is checked out, the configuration is looked up, and
 * the whole history is fetched last. Each step is its own engine call, read by its exit status.
 */

import type {Logger} from 'lib-log';
import type {CloneOrigin} from './clone-source.ts';
import {type EngineStepPorts, stepOf} from './engine-step.ts';
import {
  type CloneRequest,
  cloneArguments,
  commitCheckoutArguments,
  commitFetchArguments,
  deepenArguments,
} from './git-arguments.ts';

/** Where the volume is mounted in the bootstrap container and in the dev container. */
export const VOLUME_ROOT = '/workspaces';

/** The configuration files looked for in a clone, in the order the first found is taken. */
const CLONE_CONFIGURATIONS = [
  '.devcontainer/devcontainer.json',
  '.devcontainer.json',
] as const;

/** What the clone needs of the engine. */
export interface CloneStepPorts extends EngineStepPorts {
  logger: Logger;
}

/**
 * How the clone ended: the folder ready, with the configuration found in it (relative to the folder) and whether the
 * whole history arrived; git's own text when the clone failed; or a commit that couldn't be checked out.
 */
export type CloneOutcome =
  | {
      kind: 'ready';
      cloned: boolean;
      configuration: string | undefined;
      deepened: boolean;
    }
  | {kind: 'cloneFailed'; detail: string}
  | {kind: 'checkoutFailed'};

/** The arguments of a check that the folder holds a file or folder of any kind. */
function folderHoldsArguments(container: string, folder: string): string[] {
  return [
    'exec',
    container,
    '/bin/sh',
    '-c',
    '[ -n "$(ls -A -- "$0" 2>/dev/null)" ]',
    folder,
  ];
}

/** The arguments that make the folder, owned by the container's root, if it isn't there. */
function folderMakeArguments(container: string, folder: string): string[] {
  return ['exec', container, 'mkdir', '-p', folder];
}

/** The arguments that remove everything in the folder and keep the folder itself. */
function folderEmptyArguments(container: string, folder: string): string[] {
  return [
    'exec',
    container,
    '/bin/sh',
    '-c',
    'find "$0" -mindepth 1 -delete',
    folder,
  ];
}

/** The first configuration file the folder holds, relative to it. */
export async function configurationIn(
  ports: CloneStepPorts,
  container: string,
  folder: string,
): Promise<string | undefined> {
  for (const configuration of CLONE_CONFIGURATIONS) {
    const found = await stepOf(ports, [
      'exec',
      container,
      'test',
      '-f',
      `${folder}/${configuration}`,
    ]);
    if (found.succeeded) {
      return configuration;
    }
  }
  return undefined;
}

/** Fetches and checks out the commit; a failure leaves the folder empty, so a retry clones again. */
async function checkedOutCommit(
  ports: CloneStepPorts,
  container: string,
  commitSha: string,
  origin: CloneOrigin,
  folder: string,
): Promise<boolean> {
  const fetched = await stepOf(
    ports,
    commitFetchArguments(container, commitSha, origin, folder),
  );
  const checkedOut = fetched.succeeded
    ? await stepOf(ports, commitCheckoutArguments(container, commitSha, folder))
    : fetched;
  if (checkedOut.succeeded) {
    return true;
  }
  ports.logger.info(
    `the commit could not be checked out: ${checkedOut.detail}`,
  );
  await stepOf(ports, folderEmptyArguments(container, folder));
  return false;
}

/** Clones `request` into `/workspaces/<name>` of the bootstrap container, unless that folder holds files already. */
export async function cloneIntoVolume(
  ports: CloneStepPorts,
  container: string,
  request: CloneRequest,
  origin: CloneOrigin,
  name: string,
): Promise<CloneOutcome> {
  const folder = `${VOLUME_ROOT}/${name}`;
  if (
    (await stepOf(ports, folderHoldsArguments(container, folder))).succeeded
  ) {
    ports.logger.info(
      `the folder ${folder} holds files already and is opened as it is`,
    );
    return {
      kind: 'ready',
      cloned: false,
      configuration: await configurationIn(ports, container, folder),
      deepened: false,
    };
  }
  const made = await stepOf(ports, folderMakeArguments(container, folder));
  const cloned = made.succeeded
    ? await stepOf(ports, cloneArguments(container, request, origin, folder))
    : made;
  if (!cloned.succeeded) {
    return {kind: 'cloneFailed', detail: cloned.detail};
  }
  if (
    request.commit === true &&
    !(await checkedOutCommit(
      ports,
      container,
      String(request.ref),
      origin,
      folder,
    ))
  ) {
    return {kind: 'checkoutFailed'};
  }
  const configuration = await configurationIn(ports, container, folder);
  const deepened = await stepOf(
    ports,
    deepenArguments(container, origin, folder),
  );
  if (!deepened.succeeded) {
    ports.logger.info(
      `the whole history could not be fetched: ${deepened.detail}`,
    );
  }
  return {
    kind: 'ready',
    cloned: true,
    configuration,
    deepened: deepened.succeeded,
  };
}
