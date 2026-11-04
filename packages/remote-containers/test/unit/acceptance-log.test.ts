import {deepStrictEqual} from 'node:assert';
import {AppendedText} from 'lib-log/testing/noting-channels';
import {containersLogMirrorOf} from '../../src/acceptance-log.ts';

const CONTAINERS_LOG = '/run/containers.log';
const LINE = {
  level: 'info',
  scope: [],
  message: 'banner',
  time: Date.UTC(2026, 10, 3, 12, 0, 0, 0),
} as const;

describe('the Dev Containers log for the harness (card containers-37)', () => {
  it('with the switch on and the containers variable set, each line goes to that file as the log prints it', () => {
    const files = new AppendedText();
    containersLogMirrorOf(
      {
        REMOTE_OSS_ACCEPTANCE: '1',
        REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG: CONTAINERS_LOG,
      },
      files.append,
    )?.write(LINE);
    deepStrictEqual(
      [...files.appended],
      [[CONTAINERS_LOG, '2026-11-03T12:00:00.000Z [info] banner\n']],
    );
  });

  it('with the switch off, with the variable unset, or with only Remote - SSH’s variable, there is no mirror', () => {
    const append = new AppendedText().append;
    deepStrictEqual(
      [
        containersLogMirrorOf(
          {REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG: CONTAINERS_LOG},
          append,
        ),
        containersLogMirrorOf({REMOTE_OSS_ACCEPTANCE: '1'}, append),
        containersLogMirrorOf(
          {
            REMOTE_OSS_ACCEPTANCE: '1',
            REMOTE_OSS_ACCEPTANCE_LOG: '/run/log.txt',
          },
          append,
        ),
      ],
      [undefined, undefined, undefined],
    );
  });
});
