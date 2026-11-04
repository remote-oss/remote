/**
 * @fileoverview The URLs of a folder's Git remotes, as `git config --get-regexp '^remote\..*\.url$'` prints them. It
 * runs through the one-shot run of C2's host over the `git` program, with its arguments apart and no shell, in the
 * folder the command is given, so a subfolder of a repository finds the enclosing one.
 */

import type {EngineHost} from '../engine/engine-host.ts';

/** The pattern of the configuration keys that hold a remote's URL. */
const REMOTE_URL_KEYS = '^remote\\..*\\.url$';

/** How long the read may take before it counts as no remotes. */
export const GIT_READ_MILLISECONDS = 10_000;

/**
 * What `git` prints for the remotes of `folder`; none when it printed nothing, failed or could not start. A failure is
 * no remote, and no message of `git` is kept: it may hold the folder's own text.
 */
export async function gitRemotesOf(
  host: Pick<EngineHost, 'run'>,
  folder: string,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  const outcome = await host.run(
    ['-C', folder, 'config', '--get-regexp', REMOTE_URL_KEYS],
    {kind: 'none'},
    {cancellation},
  );
  return outcome.kind === 'ran' && outcome.status === 0 && outcome.stdout !== ''
    ? outcome.stdout
    : undefined;
}
