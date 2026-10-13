import {deepStrictEqual} from 'node:assert';
import {
  type DownloadProgressPort,
  serverDownloadProgress,
} from '../../src/cli/server-download-progress.ts';

const TITLE = 'Downloading VS Code Server...';

/** A progress port that records what it was asked to show. */
function recordingPort(): {port: DownloadProgressPort; events: string[]} {
  const events: string[] = [];
  return {
    events,
    port: {
      show: title => {
        events.push(`show ${title}`);
        return {
          report: percent => events.push(`report ${String(percent)}`),
          close: () => events.push('close'),
        };
      },
    },
  };
}

/** The lines of V7a's table for a first install, in order. */
const FIRST_INSTALL = [
  {
    text: 'Checking /d/servers/Insiders-c1/log.txt and …/pid.txt for a running server...',
    level: 2,
  },
  {text: 'Installing and setting up VSCodium Server...', level: 1},
  {text: 'Downloading VSCodium server -> /tmp/.tmpIropcf/68280b82', level: 2},
  {text: 'server download progress: 2103263/88469322 (2%)', level: 0},
  {text: 'server download progress: 88469322/88469322 (100%)', level: 0},
  {text: 'server inflate progress: 180/3581 (5%)', level: 0},
  {text: 'Server setup complete', level: 1},
  {text: 'Server started', level: 2},
];

describe('the server download notification of the CLI path', () => {
  it('F-2103 5.0 steps 6–8: a first install shows it once, with the percentages, then closes it', () => {
    const {port, events} = recordingPort();
    const progress = serverDownloadProgress(port, TITLE);
    for (const line of FIRST_INSTALL) {
      progress.onLine(line);
    }
    progress.end();
    deepStrictEqual(events, [
      `show ${TITLE}`,
      'report 2',
      'report 100',
      'close',
    ]);
  });

  it('F-2103 BR-8: a serve with no download shows nothing', () => {
    const {port, events} = recordingPort();
    const progress = serverDownloadProgress(port, TITLE);
    progress.onLine(FIRST_INSTALL[0] ?? {text: '', level: 0});
    progress.onLine({text: 'Server started', level: 2});
    progress.end();
    deepStrictEqual(events, []);
  });

  it('F-2103 5.0 step 6: a percentage before the download line shows nothing', () => {
    const {port, events} = recordingPort();
    const progress = serverDownloadProgress(port, TITLE);
    progress.onLine({text: 'server download progress: 5/10 (50%)', level: 0});
    deepStrictEqual(events, []);
  });

  it('F-2103 5.0 step 6: a second download line keeps the one notification', () => {
    const {port, events} = recordingPort();
    const progress = serverDownloadProgress(port, TITLE);
    progress.onLine(FIRST_INSTALL[2] ?? {text: '', level: 0});
    progress.onLine(FIRST_INSTALL[2] ?? {text: '', level: 0});
    deepStrictEqual(events, [`show ${TITLE}`]);
  });

  it('§6: a failed serve closes the notification', () => {
    const {port, events} = recordingPort();
    const progress = serverDownloadProgress(port, TITLE);
    progress.onLine(FIRST_INSTALL[2] ?? {text: '', level: 0});
    progress.onLine({text: 'Error installing server: cannot expand', level: 4});
    progress.end();
    deepStrictEqual(events, [`show ${TITLE}`, 'close']);
  });

  it('§4a: lines after the end show nothing', () => {
    const {port, events} = recordingPort();
    const progress = serverDownloadProgress(port, TITLE);
    progress.end();
    progress.onLine(FIRST_INSTALL[2] ?? {text: '', level: 0});
    deepStrictEqual(events, []);
  });

  it('§4a: ending twice closes once', () => {
    const {port, events} = recordingPort();
    const progress = serverDownloadProgress(port, TITLE);
    progress.onLine(FIRST_INSTALL[2] ?? {text: '', level: 0});
    progress.end();
    progress.end();
    deepStrictEqual(events, [`show ${TITLE}`, 'close']);
  });
});
