/**
 * @fileoverview The host lock of a session: a `flock` lock lasts as long as the connection's long-lived shell. The
 * place of the lock is asked of the host with the script's own lock functions, so the shell opens the file the install
 * will lock, and a start that does not end in a running server gives the shell's hold up.
 */

import {type HostChannel, linesOfScript} from 'lib-host';
import {
  LOCK_METHOD_LINE,
  LOCK_PATH_LINE,
  lockPathScript,
} from '../scripts/posix-script.ts';
import type {ScriptParameters} from '../scripts/steps.ts';

/** How long the release of a lock may take, whatever happened to the run before it. */
const RELEASE_MILLISECONDS = 10_000;

/**
 * The path of the lock file the session shell holds for the install of `parameters`, or undefined when the host takes
 * no `flock` lock for the session: a Windows host, a host with no `flock`, or a host that did not answer.
 */
export async function sessionLockPath(
  channel: HostChannel,
  parameters: ScriptParameters,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  if (channel.platformHint() === 'windows') {
    return undefined;
  }
  const lines = await linesOfScript(channel, {
    script: lockPathScript(parameters),
    interpreter: 'posixShell',
    environment: {},
    input: {kind: 'text', text: ''},
    cancellation,
  });
  if (lines === undefined) {
    return undefined;
  }
  const method = lines.find(line => line.startsWith(LOCK_METHOD_LINE));
  const path = lines.find(line => line.startsWith(LOCK_PATH_LINE));
  return method === `${LOCK_METHOD_LINE}flock` &&
    path !== undefined &&
    path.length > LOCK_PATH_LINE.length
    ? path.slice(LOCK_PATH_LINE.length)
    : undefined;
}

/** Gives up the session shell's hold on the install lock of `parameters`, when the host takes a session lock at all. */
export async function releaseSessionLockOf(
  channel: HostChannel,
  parameters: ScriptParameters,
): Promise<void> {
  const path = await sessionLockPath(
    channel,
    parameters,
    AbortSignal.timeout(RELEASE_MILLISECONDS),
  );
  if (path !== undefined) {
    await releaseSessionLock(channel, path);
  }
}

/** Gives the session shell's hold on the lock file `path` up: the descriptor, and the file when the shell held the lock. */
export async function releaseSessionLock(
  channel: HostChannel,
  path: string,
): Promise<void> {
  await channel.runScript(
    {
      script: ':',
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text: ''},
      sessionLock: {path, action: 'release'},
      cancellation: AbortSignal.timeout(RELEASE_MILLISECONDS),
    },
    () => undefined,
  );
}
