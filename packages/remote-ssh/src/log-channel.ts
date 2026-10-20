/**
 * @fileoverview The extension's log: one output channel per window, created at activation, with the effective log
 * level, the editor version, the extension and the client platform as its first lines. Every line starts with the
 * local time. The level is read for each line, so a change in the settings applies to the next operation.
 */

import {
  type ChannelPort,
  createLogger,
  type Level,
  type Logger,
  type LogLine,
} from 'lib-log';

/** What the first lines of the log say about the window. */
export interface LogEnvironment {
  editorVersion: string;
  extensionName: string;
  extensionVersion: string;
  platform: string;
  architecture: string;
}

/** The open log: its logger, the reveal of Show Log, and the end of the channel. */
export interface LogChannel {
  readonly logger: Logger;
  /** Shows the panel with the channel selected and the focus in it, as often as asked. */
  reveal(): void;
  dispose(): void;
}

const CHANNEL_NAME = 'Remote - SSH';

/** The levels the setting offers; any other value reads as `debug`. */
const SETTING_LEVELS: ReadonlyMap<unknown, Level> = new Map([
  ['debug', 'debug'],
  ['trace', 'trace'],
]);

/** The level the `remote.SSH.logLevel` value names. */
export function levelOfSetting(value: unknown): Level {
  return SETTING_LEVELS.get(value) ?? 'debug';
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** `[hh:mm:ss.mmm]` in the local time of `time` (epoch milliseconds). */
function timeStamp(time: number): string {
  const moment = new Date(time);
  const milliseconds = String(moment.getMilliseconds()).padStart(3, '0');
  return `[${twoDigits(moment.getHours())}:${twoDigits(moment.getMinutes())}:${twoDigits(moment.getSeconds())}.${milliseconds}]`;
}

function formatted(line: LogLine): string {
  return `${timeStamp(line.time)} ${line.message}`;
}

/**
 * Opens the window's log channel and writes its first lines. `readLevel` is called for every line.
 */
export function openLogChannel(
  port: ChannelPort,
  environment: LogEnvironment,
  readLevel: () => Level,
  clock: () => number,
): LogChannel {
  const channel = port.createOutputChannel(CHANNEL_NAME);
  const logger = createLogger(
    {
      write: line => {
        channel.appendLine(formatted(line));
      },
    },
    {minimumLevel: readLevel, clock},
  );
  logger.info(`Log level: ${readLevel()}`);
  logger.info(`Editor version: ${environment.editorVersion}`);
  logger.info(`${environment.extensionName} ${environment.extensionVersion}`);
  logger.info(`Client: ${environment.platform} ${environment.architecture}`);
  return {
    logger,
    reveal: () => {
      channel.show(false);
    },
    dispose: () => {
      channel.dispose();
    },
  };
}
