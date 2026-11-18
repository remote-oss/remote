/**
 * @fileoverview What a window's agent has not finished: a command it took and never reported as done or failed holds
 * the commands after it, since the agent runs one at a time. A failure that waits for the agent names it, so a window
 * whose agent is held by one command reads as that and not as a timeout of each command after it.
 */

/** One event of a window's agent that concerns a command. */
export interface AgentCommandEvent {
  event: string;
  time: number;
  id?: string;
}

/** A command a row sent to a window: its id and its name. */
export interface SentCommandName {
  id: string;
  command?: string;
}

/**
 * The commands the agent took that no `done` or `failed` followed, as `<command> accepted <seconds> s ago`, oldest
 * first; none when it holds nothing.
 */
export function unfinishedCommands(
  events: readonly AgentCommandEvent[],
  commands: readonly SentCommandName[],
  now: number,
): string[] {
  const ended = new Set(
    events
      .filter(each => each.event === 'done' || each.event === 'failed')
      .map(each => each.id),
  );
  return events
    .filter(each => each.event === 'accepted' && !ended.has(each.id))
    .map(
      each =>
        `${commands.find(sent => sent.id === each.id)?.command ?? 'a command'} accepted ${String(Math.round((now - each.time) / 1000))} s ago`,
    );
}
