import {deepStrictEqual, strictEqual} from 'node:assert';
import {acceptanceChannelPortFor} from '../../src/index.ts';
import {
  AppendedText,
  NotingChannels,
} from '../../src/testing/noting-channels.ts';

const LOG_FILE = '/run/log.txt';
const VARIABLE = 'REMOTE_OSS_ACCEPTANCE_LOG';
const SWITCHED_ON = {REMOTE_OSS_ACCEPTANCE: '1', [VARIABLE]: LOG_FILE};

describe('acceptanceChannelPortFor (card containers-37)', () => {
  it('D-85: with the switch off it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      acceptanceChannelPortFor(
        {[VARIABLE]: LOG_FILE},
        VARIABLE,
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('D-85: with the switch at any value but 1 it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      acceptanceChannelPortFor(
        {REMOTE_OSS_ACCEPTANCE: 'yes', [VARIABLE]: LOG_FILE},
        VARIABLE,
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('D-85: with the switch on and an empty log variable it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      acceptanceChannelPortFor(
        {REMOTE_OSS_ACCEPTANCE: '1', [VARIABLE]: ''},
        VARIABLE,
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('D-85: with the switch on and no log variable it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      acceptanceChannelPortFor(
        {REMOTE_OSS_ACCEPTANCE: '1'},
        VARIABLE,
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('D-85: the file holds both lines, in order, each ending in a newline', () => {
    const files = new AppendedText();
    const channel = acceptanceChannelPortFor(
      SWITCHED_ON,
      VARIABLE,
      new NotingChannels(),
      files.append,
    ).createOutputChannel('Remote - SSH');
    channel.appendLine('first');
    channel.appendLine('second');
    strictEqual(files.appended.get(LOG_FILE), 'first\nsecond\n');
  });

  it('D-85: the real channel gets both lines too', () => {
    const real = new NotingChannels();
    const channel = acceptanceChannelPortFor(
      SWITCHED_ON,
      VARIABLE,
      real,
      new AppendedText().append,
    ).createOutputChannel('Remote - SSH');
    channel.appendLine('first');
    channel.appendLine('second');
    deepStrictEqual(real.channel.lines, ['first', 'second']);
  });

  it('D-85: the real channel is opened under the name asked for', () => {
    const real = new NotingChannels();
    acceptanceChannelPortFor(
      SWITCHED_ON,
      VARIABLE,
      real,
      new AppendedText().append,
    ).createOutputChannel('Remote - SSH');
    deepStrictEqual(real.names, ['Remote - SSH']);
  });

  it('D-85: show and dispose reach the real channel', () => {
    const real = new NotingChannels();
    const channel = acceptanceChannelPortFor(
      SWITCHED_ON,
      VARIABLE,
      real,
      new AppendedText().append,
    ).createOutputChannel('Remote - SSH');
    channel.show(false);
    channel.dispose();
    deepStrictEqual([real.channel.shown, real.channel.disposed], [[false], 1]);
  });

  it('the file is the one the named variable gives, and another variable is not read', () => {
    const files = new AppendedText();
    const channel = acceptanceChannelPortFor(
      {
        REMOTE_OSS_ACCEPTANCE: '1',
        [VARIABLE]: LOG_FILE,
        OTHER_LOG: '/run/other.txt',
      },
      'OTHER_LOG',
      new NotingChannels(),
      files.append,
    ).createOutputChannel('Dev Containers');
    channel.appendLine('line');
    deepStrictEqual([...files.appended], [['/run/other.txt', 'line\n']]);
  });
});
