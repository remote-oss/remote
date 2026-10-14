/**
 * @fileoverview What a reconnection of a window that holds a connection answers, from the container's state and the
 * server's process.
 */

/** What `docker inspect` says of the container's state, or that there is no such container. */
export type ContainerState = {status: string; startedAt: string} | 'missing';

/** What the resolve answers: the held connection again, the container gone for good, or a connection that may return. */
export type ReconnectionOutcome = 'held' | 'containerGone' | 'transportLost';

/**
 * The answer for a window holding a connection that started at `held.startedAt`. `serverAlive` is the result of the
 * check of the server's process, made only for a running container of the same start; nothing means it was not made.
 */
export function reconnectionOutcomeOf(
  held: {startedAt: string},
  state: ContainerState,
  serverAlive: boolean | undefined,
): ReconnectionOutcome {
  if (state === 'missing') {
    return 'containerGone';
  }
  if (state.status === 'paused') {
    return 'transportLost';
  }
  if (state.status !== 'running' || state.startedAt !== held.startedAt) {
    return 'containerGone';
  }
  return serverAlive === true ? 'held' : 'transportLost';
}
