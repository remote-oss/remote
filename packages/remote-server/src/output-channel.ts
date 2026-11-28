/**
 * @fileoverview The extension's Output channel, created at the first request for it and never at activation, so a
 * window that runs no command of the extension has no channel.
 */

/** What the extension writes to its Output channel. */
export interface LogChannel {
  info(line: string): void;
}

/**
 * The function that opens the channel: the first call creates it and, when the remote resolvers are unavailable,
 * writes the line that says so; later calls give the same channel.
 */
export function lazyChannel(
  create: () => LogChannel,
  resolverAvailable: boolean,
  unavailableLine: string,
): () => LogChannel {
  let channel: LogChannel | undefined;
  return () => {
    if (channel === undefined) {
      channel = create();
      if (!resolverAvailable) {
        channel.info(unavailableLine);
      }
    }
    return channel;
  };
}
