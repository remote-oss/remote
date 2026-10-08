import type {LogLine, Sink} from '../logger.ts';
import type {EditorLogPort} from './editor-port.ts';

/**
 * Format one line the way the default sinks print it: ISO time, level, the dotted scope with a
 * colon (omitted when empty), and the message.
 */
export function defaultFormat(line: LogLine): string {
  const head = `${new Date(line.time).toISOString()} [${line.level}] `;
  const scope = line.scope.join('.');
  return scope === ''
    ? `${head}${line.message}`
    : `${head}${scope}: ${line.message}`;
}

/**
 * A sink that appends its formatted lines to one editor output channel. The channel is created on
 * the first write, never up front; `dispose` closes the current channel, and a later write opens
 * a new one.
 */
export function createChannelSink(
  port: EditorLogPort,
  channelName: string,
  format?: (line: LogLine) => string,
): Sink & {dispose(): void} {
  const render = format ?? defaultFormat;
  let channel: {appendLine(text: string): void; dispose(): void} | undefined;
  return {
    write(line: LogLine): void {
      channel ??= port.createOutputChannel(channelName);
      channel.appendLine(render(line));
    },
    dispose(): void {
      if (channel !== undefined) {
        channel.dispose();
        channel = undefined;
      }
    },
  };
}
