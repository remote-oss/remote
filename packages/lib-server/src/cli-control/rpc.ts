/**
 * @fileoverview The framing of the editor command-line program's control connection: msgpack maps that follow each
 * other on a byte stream with no separator, read incrementally and told apart as replies, notifications and
 * malformed messages.
 */

import {Decoder} from '@msgpack/msgpack';

/** What a reply carries: a result, or the error with its message. */
export type Reply =
  {kind: 'result'; result: unknown} | {kind: 'error'; message: string};

/** One message read from the stream. */
export type Incoming =
  | {kind: 'reply'; id: number; reply: Reply}
  | {
      kind: 'notification';
      method: string;
      params: Readonly<Record<string, unknown>>;
    }
  | {kind: 'malformed'};

/** Whether `value` is a map: msgpack maps decode to plain objects. */
export function isMap(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The reply a map with an `id` carries, or nothing when it carries neither a result nor an error. */
function replyOf(
  message: Readonly<Record<string, unknown>>,
): Reply | undefined {
  const {error} = message;
  if (isMap(error) && typeof error.message === 'string') {
    return {kind: 'error', message: error.message};
  }
  return 'result' in message
    ? {kind: 'result', result: message.result}
    : undefined;
}

/** Tells what one decoded message is. */
export function classify(message: unknown): Incoming {
  if (!isMap(message)) {
    return {kind: 'malformed'};
  }
  if (typeof message.id === 'number') {
    const reply = replyOf(message);
    return reply === undefined
      ? {kind: 'malformed'}
      : {kind: 'reply', id: message.id, reply};
  }
  return typeof message.method === 'string'
    ? {
        kind: 'notification',
        method: message.method,
        params: isMap(message.params) ? message.params : {},
      }
    : {kind: 'malformed'};
}

/** What reads the stream: bytes go in, whole messages come out in order. */
export interface MessageReader {
  push(chunk: Uint8Array): void;
  /** No more bytes will come; the messages already pushed are still delivered, then `onEnd` runs. */
  end(): void;
}

/**
 * Reads concatenated msgpack messages from the chunks pushed to it. A partial message waits for the next chunk, and
 * several in one chunk are delivered in order. `onEnd` runs once after the last message, also when the bytes are not
 * msgpack, which ends the reading.
 */
export function messageReader(
  onMessage: (message: unknown) => void,
  onEnd: () => void,
): MessageReader {
  const waiting: Uint8Array[] = [];
  const wake: {resume?: () => void} = {};
  let ended = false;

  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (;;) {
      const next = waiting.shift();
      if (next !== undefined) {
        yield next;
      } else if (ended) {
        return;
      } else {
        await new Promise<void>(resolve => {
          wake.resume = resolve;
        });
      }
    }
  }

  async function read(): Promise<void> {
    try {
      for await (const message of new Decoder().decodeStream(chunks())) {
        onMessage(message);
      }
    } catch {
      // Bytes that are not msgpack end the reading like the end of the stream.
    }
    onEnd();
  }

  void read();
  return {
    push: chunk => {
      waiting.push(chunk);
      wake.resume?.();
    },
    end: () => {
      ended = true;
      wake.resume?.();
    },
  };
}
