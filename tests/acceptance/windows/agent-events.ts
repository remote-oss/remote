/**
 * @fileoverview What a window's agent reported about the commands a row sent it, as lines for a failure to carry: the
 * command each event concerns, when it came after a start, and the message of a failure.
 */

/** One event of a window's agent that concerns a command a row sent. */
export interface CommandEvent {
  event: string;
  time: number;
  id?: string;
  message?: string;
}

/** The commands a row sent to a window: the id each carries and its name. */
export interface SentCommand {
  id: string;
  command?: string;
}

/** The events that say how far a command got: the agent took it, finished it, or it failed. */
const COMMAND_PROGRESS = new Set(['accepted', 'done', 'failed']);

/**
 * The lines for the progress events of the window's commands from `since` (a time in milliseconds) on, in order, at
 * most `limit`: the seconds after `since`, the event, the command's name and the failure's message when there is one.
 */
export function commandEventLines(
  events: readonly CommandEvent[],
  commands: readonly SentCommand[],
  since: number,
  limit: number,
): string[] {
  return events
    .filter(each => each.time >= since && COMMAND_PROGRESS.has(each.event))
    .slice(0, limit)
    .map(each => {
      const name =
        commands.find(sent => sent.id === each.id)?.command ?? 'a command';
      const reason = each.message === undefined ? '' : `: ${each.message}`;
      return `[+${((each.time - since) / 1000).toFixed(1)} s] ${each.event} ${name}${reason}`;
    });
}
