import {deepStrictEqual} from 'node:assert';
import type {ChannelPort, Level, RevealableChannel} from 'lib-log';
import {
  levelOfSetting,
  type LogEnvironment,
  openLogChannel,
} from '../../src/log-channel.ts';

const ENVIRONMENT: LogEnvironment = {
  editorVersion: '1.139.1',
  extensionName: 'Remote - SSH',
  extensionVersion: '0.1.0',
  platform: 'linux',
  architecture: 'arm64',
};

/** A channel that keeps the lines, the reveals and the disposals it saw, and the names it was created with. */
class RecordingChannel implements RevealableChannel {
  readonly lines: string[] = [];
  readonly reveals: Array<boolean | undefined> = [];
  disposals = 0;

  appendLine(text: string): void {
    this.lines.push(text);
  }

  show(preserveFocus?: boolean): void {
    this.reveals.push(preserveFocus);
  }

  dispose(): void {
    this.disposals += 1;
  }
}

function recordingPort(): {
  port: ChannelPort;
  channel: RecordingChannel;
  names: string[];
} {
  const channel = new RecordingChannel();
  const names: string[] = [];
  return {
    channel,
    names,
    port: {
      createOutputChannel: name => {
        names.push(name);
        return channel;
      },
    },
  };
}

/** Epoch milliseconds of a local time on a fixed day, so that the stamps do not depend on the zone. */
function localTime(
  hours: number,
  minutes: number,
  seconds: number,
  milliseconds: number,
): number {
  return new Date(2026, 9, 8, hours, minutes, seconds, milliseconds).getTime();
}

describe('the log channel', () => {
  it('is created at once under the extension name, before any line is logged', () => {
    const {port, names} = recordingPort();
    openLogChannel(
      port,
      ENVIRONMENT,
      () => 'debug',
      () => 0,
    );
    deepStrictEqual(names, ['Remote - SSH']);
  });

  it('starts with the level, the editor version, the extension and the client, in that order', () => {
    const {port, channel} = recordingPort();
    openLogChannel(
      port,
      ENVIRONMENT,
      () => 'trace',
      () => localTime(9, 5, 7, 42),
    );
    deepStrictEqual(channel.lines, [
      '[09:05:07.042] Log level: trace',
      '[09:05:07.042] Editor version: 1.139.1',
      '[09:05:07.042] Remote - SSH 0.1.0',
      '[09:05:07.042] Client: linux arm64',
    ]);
  });

  it('reads the level for each line, so a change applies to the next one', () => {
    const {port, channel} = recordingPort();
    let level: Level = 'debug';
    const logChannel = openLogChannel(
      port,
      ENVIRONMENT,
      () => level,
      () => 0,
    );
    logChannel.logger.trace('before');
    level = 'trace';
    logChannel.logger.trace('after');
    deepStrictEqual(
      channel.lines.slice(4).map(line => line.slice(15)),
      ['after'],
    );
  });

  it('reveals the channel with the focus, as often as asked', () => {
    const {port, channel} = recordingPort();
    const logChannel = openLogChannel(
      port,
      ENVIRONMENT,
      () => 'debug',
      () => 0,
    );
    logChannel.reveal();
    logChannel.reveal();
    deepStrictEqual(channel.reveals, [false, false]);
  });

  it('ends the channel when it is disposed', () => {
    const {port, channel} = recordingPort();
    openLogChannel(
      port,
      ENVIRONMENT,
      () => 'debug',
      () => 0,
    ).dispose();
    deepStrictEqual(channel.disposals, 1);
  });
});

describe('the level the setting names', () => {
  it('takes debug and trace as they are', () => {
    deepStrictEqual(
      [levelOfSetting('debug'), levelOfSetting('trace')],
      ['debug', 'trace'],
    );
  });

  it('reads anything else as debug, the empty string and an unlisted level included', () => {
    deepStrictEqual(
      [levelOfSetting(''), levelOfSetting('info'), levelOfSetting(undefined)],
      ['debug', 'debug', 'debug'],
    );
  });
});
