/**
 * @fileoverview Holds what lifecycle commands print by line. The CLI streams it as `raw` events, chunk by chunk, so a
 * value a command prints can straddle two events; each complete line goes out at once and an unfinished tail waits for
 * its newline, a non-raw event on its channel, the end of the process, or 50 ms with no further raw chunk (released by
 * the bridge), per channel.
 */

import type {CliEvent} from './cli-lines.ts';

/** One `raw` event of the CLI. */
export type RawEvent = Extract<CliEvent, {kind: 'log'}>;

/** What holds the unfinished tails. */
export interface RawHold {
  /** Takes a chunk; gives the event of its complete lines, if it completes any. */
  push(chunk: RawEvent): RawEvent[];
  /** Gives the held tail of `channel`, if there is one: the channel has said something else. */
  release(channel: string | undefined): RawEvent[];
  /** Gives every held tail: the process has ended, or its output has been idle (the bridge's 50 ms release). */
  releaseAll(): RawEvent[];
}

/** The channel as a key; the events with no channel share one. */
function keyOf(channel: string | undefined): string {
  return channel ?? '';
}

/** A hold with nothing held. */
export function rawHoldOf(): RawHold {
  const tails = new Map<string, RawEvent>();
  function release(channel: string | undefined): RawEvent[] {
    const tail = tails.get(keyOf(channel));
    tails.delete(keyOf(channel));
    return tail === undefined ? [] : [tail];
  }
  return {
    push: chunk => {
      const key = keyOf(chunk.channel);
      const held = tails.get(key);
      const text = (held?.text ?? '') + chunk.text;
      const lineEnd = text.lastIndexOf('\n');
      const rest = text.slice(lineEnd + 1);
      const first = held ?? chunk;
      if (rest === '') {
        tails.delete(key);
      } else {
        tails.set(key, {...(lineEnd < 0 ? first : chunk), text: rest});
      }
      return lineEnd < 0 ? [] : [{...first, text: text.slice(0, lineEnd + 1)}];
    },
    release,
    releaseAll: () =>
      [...tails.values()].flatMap(tail => release(tail.channel)),
  };
}
