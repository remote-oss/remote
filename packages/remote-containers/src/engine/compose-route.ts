/**
 * @fileoverview The Docker Compose a configuration runs with: the `compose` plugin of the Docker CLI first, and only
 * when it does not answer the program `dev.containers.dockerComposePath` names. Resolved again at every call, so that
 * a fix of the setting or an install needs no restart.
 */

import type {Logger} from 'lib-log';
import type {EngineHost} from './engine-host.ts';
import {executableOf} from './executable.ts';

/** The program the setting names when it names none. */
const DEFAULT_COMPOSE_PROGRAM = 'docker-compose';

/** The oldest Compose that accepts `-` and `_` in a project name, as major and minor. */
const FIRST_DASHED_VERSION: readonly [number, number] = [1, 21];

/** How Compose is reached, or why it is not. */
export type ComposeRoute =
  /** The Docker CLI's plugin answers `compose version`. */
  | {kind: 'plugin'}
  /** The program of the setting answers; `dashAndUnderscore` is false for a version below 1.21. */
  | {kind: 'standalone'; file: string; dashAndUnderscore: boolean}
  /** Neither route found a program; `written` is the setting's value, `byDefault` whether it names the default. */
  | {kind: 'missing'; written: string; byDefault: boolean}
  /** The setting's program exists but cannot run, or fails every call. */
  | {kind: 'broken'; written: string};

/** What resolving needs. */
export interface ComposeRoutePorts {
  /** The engine at the Docker program, when the Docker path names one. */
  docker: EngineHost | undefined;
  /** The program for a file. */
  engineFor(file: string): EngineHost;
  /** `dev.containers.dockerComposePath` as the editor reports it now. */
  composePath(): unknown;
  /** The folder a relative path is resolved against. */
  base: string | undefined;
  logger: Logger;
}

/** Whether the version text names a version below 1.21; text with no version names none. */
function belowDashedVersion(text: string): boolean {
  const match = /(\d+)\.(\d+)\.\d+/u.exec(text);
  if (match === null) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    major < FIRST_DASHED_VERSION[0] ||
    (major === FIRST_DASHED_VERSION[0] && minor < FIRST_DASHED_VERSION[1])
  );
}

/** Resolves the Compose to use. */
export async function composeRouteOf(
  ports: ComposeRoutePorts,
  cancellation: AbortSignal,
): Promise<ComposeRoute> {
  const {logger} = ports;
  const plugin = await ports.docker?.run(
    ['compose', 'version'],
    {kind: 'none'},
    {cancellation},
  );
  if (plugin?.kind === 'ran' && plugin.status === 0) {
    return {kind: 'plugin'};
  }
  const executable = executableOf(
    ports.composePath(),
    ports.base,
    DEFAULT_COMPOSE_PROGRAM,
  );
  const byDefault = executable.written === DEFAULT_COMPOSE_PROGRAM;
  if (executable.kind === 'notFound') {
    logger.warn(`${executable.written} was not found`);
    return {kind: 'missing', written: executable.written, byDefault};
  }
  const outcome = await ports
    .engineFor(executable.file)
    .run(['version', '--short'], {kind: 'none'}, {cancellation});
  if (outcome.kind === 'failed') {
    logger.warn(`${executable.written} could not run: ${outcome.detail}`);
    return /\bENOENT\b/u.test(outcome.detail)
      ? {kind: 'missing', written: executable.written, byDefault}
      : {kind: 'broken', written: executable.written};
  }
  if (outcome.status !== 0) {
    logger.warn(
      `${executable.written} ended with status ${String(outcome.status)}`,
    );
    return {kind: 'broken', written: executable.written};
  }
  return {
    kind: 'standalone',
    file: executable.file,
    dashAndUnderscore: !belowDashedVersion(outcome.stdout),
  };
}
