/**
 * @fileoverview The extension's side of a connection's relay host: it reads the host's frames, opens each stream's
 * host end when the stream opens, and pipes both ways. Frames from the container are untrusted: a fault, a kind this
 * connection didn't set up, or a stream number in use ends the relay host; a stream over the cap is closed at once.
 * Payloads are never logged.
 */

import {
  encodeFrame,
  type Frame,
  FrameReader,
  MAX_PAYLOAD_BYTES,
} from './relay-frames.ts';

/** The most streams one relay host may have open. */
export const MAX_OPEN_STREAMS = 64;

/** How long a stream's host end may take to connect, in milliseconds; the stream closes after it. */
export const HOST_CONNECT_MILLISECONDS = 10_000;

/** A stream's host end, once connected. */
export interface HostEnd {
  /** Writes bytes; false when the host end wants no more until it drains. */
  write(bytes: Uint8Array): boolean;
  onData(listener: (bytes: Uint8Array) => void): void;
  onDrain(listener: () => void): void;
  onClose(listener: () => void): void;
  end(): void;
}

/** What the session needs of its surroundings. */
export interface RelaySessionPorts {
  /** The kinds this connection set up; a stream of any other kind ends the relay host. */
  kinds: ReadonlySet<string>;
  /** Connects the host end of a stream of `kind`; rejects when it can't. */
  connect(kind: string, cancellation: AbortSignal): Promise<HostEnd>;
  /** Writes to the relay host's standard input. */
  send(bytes: Uint8Array): void;
  /** Stops and restarts reading the relay host's standard output. */
  pauseInput(): void;
  resumeInput(): void;
  /** Ends the relay host's process. */
  endHost(): void;
  /** Calls `callback` after `milliseconds`; the result stops the wait. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  logLine(line: string): void;
}

/** One open stream: its kind, its host end once connected, and the bytes that arrived before it was. */
interface OpenStream {
  kind: string;
  hostEnd?: HostEnd;
  waiting: Uint8Array[];
  connecting: AbortController;
}

/** The session of one relay host. */
export interface RelaySession {
  /** Takes a chunk of the relay host's standard output. */
  receive(chunk: Uint8Array): void;
  /** The relay host has ended: every stream's host end closes. */
  ended(): void;
}

/** Starts the session of one relay host. */
export function relaySession(ports: RelaySessionPorts): RelaySession {
  const reader = new FrameReader();
  const streams = new Map<number, OpenStream>();
  const paused = new Set<string>();
  let finished = false;

  /** Whether the relay host has ended, as a handled frame may have decided. */
  function stopped(): boolean {
    return finished;
  }

  function pause(reason: string): void {
    if (paused.size === 0) {
      ports.pauseInput();
    }
    paused.add(reason);
  }

  function resume(reason: string): void {
    if (paused.delete(reason) && paused.size === 0) {
      ports.resumeInput();
    }
  }

  function closeStream(stream: number, tellHost: boolean): void {
    const open = streams.get(stream);
    if (open === undefined) {
      return;
    }
    streams.delete(stream);
    open.connecting.abort();
    open.hostEnd?.end();
    resume(`drain ${String(stream)}`);
    resume(`connect ${String(stream)}`);
    if (tellHost) {
      ports.send(
        encodeFrame({type: 'close', stream, payload: new Uint8Array(0)}),
      );
    }
  }

  function finish(reason: string): void {
    if (finished) {
      return;
    }
    finished = true;
    ports.logLine(`the relay host ended: ${reason}`);
    for (const stream of [...streams.keys()]) {
      closeStream(stream, false);
    }
    ports.endHost();
  }

  function sendData(stream: number, bytes: Uint8Array): void {
    for (let start = 0; start < bytes.length; start += MAX_PAYLOAD_BYTES) {
      ports.send(
        encodeFrame({
          type: 'data',
          stream,
          payload: bytes.slice(start, start + MAX_PAYLOAD_BYTES),
        }),
      );
    }
  }

  function writeToHost(
    stream: number,
    open: OpenStream,
    bytes: Uint8Array,
  ): void {
    if (open.hostEnd === undefined) {
      open.waiting.push(bytes);
      pause(`connect ${String(stream)}`);
      return;
    }
    if (!open.hostEnd.write(bytes)) {
      pause(`drain ${String(stream)}`);
    }
  }

  function connected(stream: number, open: OpenStream, hostEnd: HostEnd): void {
    open.hostEnd = hostEnd;
    hostEnd.onData(bytes => {
      sendData(stream, bytes);
    });
    hostEnd.onDrain(() => {
      resume(`drain ${String(stream)}`);
    });
    hostEnd.onClose(() => {
      closeStream(stream, true);
    });
    const waiting = open.waiting;
    open.waiting = [];
    resume(`connect ${String(stream)}`);
    for (const bytes of waiting) {
      writeToHost(stream, open, bytes);
    }
  }

  function opened(stream: number, kind: string): void {
    if (!ports.kinds.has(kind)) {
      finish(`a stream of a kind this connection has no relay for`);
      return;
    }
    if (streams.has(stream)) {
      finish('a stream number already in use');
      return;
    }
    if (streams.size >= MAX_OPEN_STREAMS) {
      ports.logLine(
        `a ${kind} stream was closed: ${String(MAX_OPEN_STREAMS)} streams are open`,
      );
      ports.send(
        encodeFrame({type: 'close', stream, payload: new Uint8Array(0)}),
      );
      return;
    }
    const open: OpenStream = {
      kind,
      waiting: [],
      connecting: new AbortController(),
    };
    streams.set(stream, open);
    function unreachable(): void {
      if (streams.get(stream) === open) {
        ports.logLine(`the ${kind} relay could not reach its host end`);
        closeStream(stream, true);
      }
    }
    const stopTimer = ports.setTimer(HOST_CONNECT_MILLISECONDS, unreachable);
    ports.connect(kind, open.connecting.signal).then(
      hostEnd => {
        stopTimer();
        if (streams.get(stream) !== open) {
          hostEnd.end();
          return;
        }
        connected(stream, open, hostEnd);
      },
      () => {
        stopTimer();
        unreachable();
      },
    );
  }

  function handle(frame: Frame): void {
    if (frame.type === 'open') {
      opened(frame.stream, new TextDecoder().decode(frame.payload));
      return;
    }
    const open = streams.get(frame.stream);
    if (open === undefined) {
      return;
    }
    if (frame.type === 'data') {
      writeToHost(frame.stream, open, frame.payload);
    } else {
      closeStream(frame.stream, false);
    }
  }

  return {
    receive: chunk => {
      if (finished) {
        return;
      }
      const read = reader.push(chunk);
      for (const frame of read.frames) {
        handle(frame);
        if (stopped()) {
          return;
        }
      }
      if (read.fault !== undefined) {
        finish(`its output broke the framing (${read.fault})`);
      }
    },
    ended: () => {
      if (!finished) {
        finished = true;
        for (const stream of [...streams.keys()]) {
          closeStream(stream, false);
        }
      }
    },
  };
}
