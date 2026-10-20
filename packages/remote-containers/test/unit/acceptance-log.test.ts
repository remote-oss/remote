import {deepStrictEqual, strictEqual} from 'node:assert';
import {AppendedText, NotingChannels} from 'lib-log/testing/noting-channels';
import {containersChannelPortFor} from '../../src/acceptance-log.ts';

const CONTAINERS_LOG = '/run/containers.log';

describe('the Dev Containers log for the harness (card containers-37)', () => {
  it('with the switch on and the containers variable set, each line goes to that file and to the real channel', () => {
    const real = new NotingChannels();
    const files = new AppendedText();
    const channel = containersChannelPortFor(
      {
        REMOTE_OSS_ACCEPTANCE: '1',
        REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG: CONTAINERS_LOG,
      },
      real,
      files.append,
    ).createOutputChannel('Dev Containers');
    channel.appendLine('banner');
    deepStrictEqual(
      [[...files.appended], real.channel.lines],
      [[[CONTAINERS_LOG, 'banner\n']], ['banner']],
    );
  });

  it('with the switch off it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      containersChannelPortFor(
        {REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG: CONTAINERS_LOG},
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('with the variable unset it is the real port itself', () => {
    const real = new NotingChannels();
    strictEqual(
      containersChannelPortFor(
        {REMOTE_OSS_ACCEPTANCE: '1'},
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it("Remote - SSH's variable does not name this log", () => {
    const real = new NotingChannels();
    strictEqual(
      containersChannelPortFor(
        {
          REMOTE_OSS_ACCEPTANCE: '1',
          REMOTE_OSS_ACCEPTANCE_LOG: '/run/log.txt',
        },
        real,
        new AppendedText().append,
      ),
      real,
    );
  });
});
