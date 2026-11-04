import {deepStrictEqual} from 'node:assert';
import {
  logChoicesOf,
  logFileNameOf,
  logLevelOf,
  type LogFile,
  localStartOf,
  parseLogFileName,
  previousLogOf,
} from '../../src/logging/log-files.ts';

function fileOf(kind: LogFile['kind'], start: string, size = 10): LogFile {
  return {kind, start, size, file: `/logs/${kind}-${start}.log`};
}

describe('the log files of the extension (card containers-186, F-0104)', () => {
  it('F-0104 AC-12, BR-4: a name is the kind, the start in UTC with the colons replaced and the dot kept, and .log', () => {
    deepStrictEqual(
      [
        logFileNameOf('remoteContainers', new Date('2026-11-03T12:34:56.789Z')),
        logFileNameOf('shutdownMonitor', new Date('2026-01-02T03:04:05.006Z')),
      ],
      [
        'remoteContainers-2026-11-03T12-34-56.789Z.log',
        'shutdownMonitor-2026-01-02T03-04-05.006Z.log',
      ],
    );
  });

  it('F-0104 AC-12: only a name of that form is a log file of ours', () => {
    deepStrictEqual(
      [
        'remoteContainers-2026-11-03T12-34-56.789Z.log',
        'shutdownMonitor-2026-11-03T12-34-56.789Z.log',
        'remoteContainers-2026-11-03T12:34:56.789Z.log',
        'remoteContainers-2026-11-03T12-34-56Z.log',
        'remote-ssh-2026-11-03T12-34-56.789Z.log',
        'remoteContainers-2026-11-03T12-34-56.789Z.log.bak',
        '',
      ].map(parseLogFileName),
      [
        {kind: 'remoteContainers', start: '2026-11-03T12-34-56.789Z'},
        {kind: 'shutdownMonitor', start: '2026-11-03T12-34-56.789Z'},
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it('F-0104 AC-4, AC-21: the pick lists the newest name timestamp first, labelled by kind, with the local start and the size with no digit grouping', () => {
    const files = [
      fileOf('remoteContainers', '2026-11-01T10-00-00.000Z', 1234567),
      fileOf('shutdownMonitor', '2026-11-03T10-00-00.000Z', 42),
      fileOf('remoteContainers', '2026-11-02T10-00-00.000Z', 7),
    ];
    deepStrictEqual(
      logChoicesOf(files).map(each => [each.label, each.description]),
      [
        [
          'shutdownMonitor',
          `${localStartOf('2026-11-03T10-00-00.000Z')} - 42 bytes`,
        ],
        [
          'remoteContainers',
          `${localStartOf('2026-11-02T10-00-00.000Z')} - 7 bytes`,
        ],
        [
          'remoteContainers',
          `${localStartOf('2026-11-01T10-00-00.000Z')} - 1234567 bytes`,
        ],
      ],
    );
  });

  it('F-0104 AC-21: the local start is the UTC start moved to the local zone, as yyyy-MM-dd HH:mm:ss', () => {
    const time = new Date('2026-11-03T22:05:09.000Z');
    function padded(value: number): string {
      return String(value).padStart(2, '0');
    }
    deepStrictEqual(
      localStartOf('2026-11-03T22-05-09.000Z'),
      `${String(time.getFullYear())}-${padded(time.getMonth() + 1)}-${padded(time.getDate())} ${padded(time.getHours())}:${padded(time.getMinutes())}:${padded(time.getSeconds())}`,
    );
  });

  it('F-0104 AC-4: two files of one start order by their path, so the pick is stable', () => {
    const first = fileOf('remoteContainers', '2026-11-03T10-00-00.000Z');
    const second = fileOf('shutdownMonitor', '2026-11-03T10-00-00.000Z');
    deepStrictEqual(
      [logChoicesOf([second, first]), logChoicesOf([first, second])].map(
        choices => choices.map(each => each.file),
      ),
      [
        [first.file, second.file],
        [first.file, second.file],
      ],
    );
  });

  it('F-0104 BR-6, AC-20: the previous log is the newest remoteContainers file that is not the current activation’s, and a shutdownMonitor file is never it', () => {
    const current = '2026-11-03T10-00-00.000Z';
    const files = [
      fileOf('remoteContainers', current),
      fileOf('shutdownMonitor', '2026-11-03T09-00-00.000Z'),
      fileOf('remoteContainers', '2026-11-02T09-00-00.000Z'),
      fileOf('remoteContainers', '2026-11-01T09-00-00.000Z'),
    ];
    deepStrictEqual(
      [
        previousLogOf(files, current)?.start,
        previousLogOf([fileOf('remoteContainers', current)], current),
        previousLogOf(
          [fileOf('shutdownMonitor', '2026-11-03T09-00-00.000Z')],
          current,
        ),
        previousLogOf([], current),
      ],
      ['2026-11-02T09-00-00.000Z', undefined, undefined, undefined],
    );
  });

  it('F-0104 BR-7, BR-7a, AC-25, AC-26: info, debug and trace are matched exactly, any other text is info, and empty, null and absent are debug', () => {
    deepStrictEqual(
      [
        'info',
        'debug',
        'trace',
        'verbose',
        'off',
        'TRACE',
        'Debug',
        ' info',
        '',
        null,
        undefined,
        3,
        {},
      ].map(logLevelOf),
      [
        'info',
        'debug',
        'trace',
        'info',
        'info',
        'info',
        'info',
        'info',
        'debug',
        'debug',
        'debug',
        'debug',
        'debug',
      ],
    );
  });
});
