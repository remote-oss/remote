import {deepStrictEqual} from 'node:assert';
import {
  daemonDownText,
  type DesktopData,
  desktopDataOf,
  mayRecheck,
  recheckBoundOf,
  shouldStartDesktop,
} from '../../src/engine/docker-desktop.ts';

/** The data of a host that has some. */
function dataOf(platform: string): DesktopData {
  const data = desktopDataOf(platform);
  if (data === undefined) {
    throw new Error(`${platform} has start data`);
  }
  return data;
}

describe('Docker Desktop on each host (card containers-200, §1)', () => {
  it('F-0202 BR-9: macOS has start data: the application in /Applications, started in the background through open, its process listed by pgrep', () => {
    const data = desktopDataOf('darwin');
    deepStrictEqual(
      [
        data?.application,
        data?.start,
        data?.listing,
        data?.recheckIntervalMilliseconds,
      ],
      [
        '/Applications/Docker.app',
        {program: 'open', args: ['--background', '-a', 'Docker']},
        {
          program: 'pgrep',
          args: ['-x', 'Docker Desktop'],
          processName: 'Docker Desktop',
        },
        5000,
      ],
    );
  });

  it('F-0202 BR-9: Windows has start data: the installed executable is the start, its process listed by tasklist', () => {
    const data = desktopDataOf('win32');
    deepStrictEqual(
      [data?.application, data?.start, data?.listing],
      [
        'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
        {
          program: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
          args: [],
        },
        {
          program: 'tasklist',
          args: ['/FI', 'IMAGENAME eq Docker Desktop.exe', '/FO', 'CSV', '/NH'],
          processName: 'Docker Desktop.exe',
        },
      ],
    );
  });

  it('F-0202 BR-9, AC-7: Linux and any other host have no start data, and a name that is only on the table’s prototype is none either', () => {
    deepStrictEqual(
      ['linux', 'freebsd', '', 'toString', '__proto__'].map(desktopDataOf),
      [undefined, undefined, undefined, undefined, undefined],
    );
  });

  it('F-0202 BR-12: the two error texts of the CLI mean the daemon is not up, in any letter case, and no other text does', () => {
    deepStrictEqual(
      [
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
        'error during connect: failed to connect to the docker API at npipe:////./pipe/docker_engine',
        'CANNOT CONNECT TO THE DOCKER DAEMON',
        'permission denied while trying to connect to the Docker daemon socket',
        'command not found',
        '',
      ].map(daemonDownText),
      [true, true, true, false, false, false],
    );
  });

  it('F-0202 BR-12: a failed check starts Docker Desktop only with start data, an installed application and the daemon-down error', () => {
    const data = desktopDataOf('darwin');
    const down = 'Cannot connect to the Docker daemon';
    deepStrictEqual(
      [
        shouldStartDesktop(data, true, down),
        shouldStartDesktop(undefined, true, down),
        shouldStartDesktop(data, false, down),
        shouldStartDesktop(data, true, 'permission denied'),
      ],
      [true, false, false, false],
    );
  });

  it('F-0202 BR-13, AC-24, AC-56: macOS waits for six re-checks, and Windows for six when the application was running and for five minutes when this check started it', () => {
    const mac = dataOf('darwin');
    const windows = dataOf('win32');
    deepStrictEqual(
      [
        recheckBoundOf(mac, true),
        recheckBoundOf(mac, false),
        recheckBoundOf(windows, false),
        recheckBoundOf(windows, true),
      ],
      [
        {kind: 'count', limit: 6},
        {kind: 'count', limit: 6},
        {kind: 'count', limit: 6},
        {kind: 'time', limit: 300_000},
      ],
    );
  });

  it('F-0202 6.2: a count allows exactly its limit of re-checks, whatever time has gone', () => {
    const six = {kind: 'count', limit: 6} as const;
    deepStrictEqual(
      [0, 5, 6, 7].map(done => mayRecheck(six, done, 10_000_000)),
      [true, true, false, false],
    );
  });

  it('F-0202 AC-56: a time allows a re-check up to five minutes after the start and none after, whatever the count', () => {
    const minutes = {kind: 'time', limit: 300_000} as const;
    deepStrictEqual(
      [0, 299_999, 300_000, 300_001].map(elapsed =>
        mayRecheck(minutes, 1000, elapsed),
      ),
      [true, true, true, false],
    );
  });
});
