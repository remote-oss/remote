import {deepStrictEqual} from 'node:assert';
import type {LogFile} from '../../src/logging/log-files.ts';
import {
  type LogCommandPorts,
  openLastLogFileOf,
  openLogFileOf,
} from '../../src/logging/log-commands.ts';

const CURRENT = '2026-11-04T12-00-00.000Z';

function fileOf(kind: LogFile['kind'], start: string, size: number): LogFile {
  return {kind, start, size, file: `/logs/${kind}-${start}.log`};
}

/** The ports over `files`, the row the user picks, and a record of what the editor was asked. */
function portsOver(files: LogFile[], picks: number | undefined) {
  const events: string[] = [];
  const ports: LogCommandPorts = {
    files: () => Promise.resolve(files),
    pick: (placeholder, rows) => {
      events.push(`pick ${placeholder}: ${JSON.stringify(rows)}`);
      return Promise.resolve(picks);
    },
    open: file => {
      events.push(`open ${file}`);
      return Promise.resolve();
    },
    tell: detail => {
      events.push(`tell ${detail}`);
      return Promise.resolve();
    },
    currentStart: CURRENT,
    translate: template => template,
  };
  return {ports, events};
}

describe('the commands that open a log file (card containers-186, F-0104)', () => {
  it('F-0104 AC-4, AC-5: the pick has the placeholder and every file newest first, and the one picked is opened', async () => {
    const seen = portsOver(
      [
        fileOf('remoteContainers', '2026-11-03T08-00-00.000Z', 30),
        fileOf('shutdownMonitor', CURRENT, 5),
      ],
      0,
    );
    await openLogFileOf(seen.ports)();
    deepStrictEqual(
      seen.events.map(event =>
        event.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/gu, 'T'),
      ),
      [
        'pick Choose a log file: [{"label":"shutdownMonitor","description":"T - 5 bytes"},{"label":"remoteContainers","description":"T - 30 bytes"}]',
        `open /logs/shutdownMonitor-${CURRENT}.log`,
      ],
    );
  });

  it('F-0104 AC-5: a pick that is dismissed opens nothing', async () => {
    const seen = portsOver([fileOf('remoteContainers', CURRENT, 5)], undefined);
    await openLogFileOf(seen.ports)();
    deepStrictEqual(
      seen.events.filter(event => event.startsWith('open')),
      [],
    );
  });

  it('F-0104 AC-6: with no log file the pick has one row, and nothing is opened whatever is chosen', async () => {
    const seen = portsOver([], 0);
    await openLogFileOf(seen.ports)();
    deepStrictEqual(seen.events, [
      'pick Choose a log file: [{"label":"No log files found."}]',
    ]);
  });

  it('F-0104 AC-7, AC-8, AC-20: the previous log is the newest remoteContainers file of an earlier activation, never a shutdownMonitor one, and with none the dialog is shown', async () => {
    const earlier = portsOver(
      [
        fileOf('remoteContainers', CURRENT, 5),
        fileOf('shutdownMonitor', '2026-11-04T13-00-00.000Z', 5),
        fileOf('remoteContainers', '2026-11-03T08-00-00.000Z', 30),
        fileOf('remoteContainers', '2026-11-02T08-00-00.000Z', 31),
      ],
      undefined,
    );
    const none = portsOver([fileOf('remoteContainers', CURRENT, 5)], undefined);
    await openLastLogFileOf(earlier.ports)();
    await openLastLogFileOf(none.ports)();
    deepStrictEqual(
      [earlier.events, none.events],
      [
        ['open /logs/remoteContainers-2026-11-03T08-00-00.000Z.log'],
        ['tell No previous log file found.'],
      ],
    );
  });
});
