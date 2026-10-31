import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogOf,
  statusBarText,
  toastDetails,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  COUNTDOWN,
  docker,
  eventually,
  logSince,
  serverPortsOf,
  serverProcessesOf,
  settledWindow,
} from './resolve-support.ts';

/** What core's terminal dialog for a connection that cannot be restored says. */
const CANNOT_RECONNECT = 'Cannot reconnect. Please reload the window.';

/** The lines of our log that answer one reconnection attempt of core. */
function attemptsIn(lines: readonly string[]): string[] {
  return lines.filter(line => line.startsWith('reconnection: '));
}

/** The gaps in milliseconds between core's first four reconnection attempts: at once, then after 5, 5 and 10 s (BR-7). */
const SCHEDULE_GAPS = [5000, 5000, 10_000];

/** The S286 phases "Start: Reconnection attempt N" that the lines hold, one per attempt of core; our connector does not log them yet. */
function phasesIn(lines: readonly string[]): string[] {
  return lines.filter(line => /^Start: Reconnection attempt \d+$/.test(line));
}

/** Waits `milliseconds`. */
async function pause(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** Kills every server process of container `containerId`. */
async function killServer(containerId: string): Promise<void> {
  const servers = await serverProcessesOf(containerId);
  await docker(
    'exec',
    containerId,
    'kill',
    '-9',
    ...servers.map(server => String(server.processId)),
  );
}

/** The text of the countdown dialog of window `name`, once it shows, within `milliseconds`. */
async function countdownIn(name: string, milliseconds: number) {
  return eventually(
    'the countdown dialog',
    async () => {
      const shown = await dialogOf(name);
      return shown !== undefined && COUNTDOWN.test(shown.details)
        ? shown
        : undefined;
    },
    milliseconds,
  );
}

/** Connects a settled window on a new folder named `label` and gives it with the server's port and the log mark taken before. */
async function connectedWithPort(label: string) {
  const mark = containersLog().length;
  const connected = await settledWindow(label);
  const [port = 0] = serverPortsOf(logSince(mark));
  return {...connected, port};
}

describe('F-0502 reconnection and the give-up rules (card containers-43)', function () {
  this.timeout(900_000);

  it.skip('F-0502 AC-6 (c43-stop): a stopped container gives core’s terminal dialog within 15 s with the indicator disconnected and one answered attempt; Reload Window starts the container and a new server on a new port (skipped until S286 is logged)', async () => {
    const {name, containerId, folder, port} =
      await connectedWithPort('c43-stop');
    try {
      const mark = containersLog().length;
      const began = Date.now();
      await docker('stop', containerId);
      const dialog = await waitForDialog(name, 30_000);
      const seconds = (Date.now() - began) / 1000;
      const indicator = await statusBarText(name, 'status.host');
      await pause(20_000);
      const attempts = phasesIn(logSince(mark));
      await answerDialog(name, 'Reload Window');
      await connectedToContainer(name);
      const state = {
        details: dialog.details,
        buttons: [...dialog.buttons],
        withinFifteenSeconds: seconds < 15,
        indicator,
        attempts,
        status: await docker('inspect', '-f', '{{.State.Status}}', containerId),
        newPort: serverPortsOf(logSince(mark)).every(each => each !== port),
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        details: CANNOT_RECONNECT,
        buttons: ['Cancel', 'Reload Window'],
        withinFifteenSeconds: true,
        indicator: 'Disconnected from Dev Container: c43-stop',
        attempts: ['Start: Reconnection attempt 1'],
        status: 'running',
        newPort: true,
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it.skip('F-0502 AC-40 (c43-restart): a restarted container gives the terminal dialog within 6 s and keeps it for 60 s although the container runs again, with one attempt; Reload Window connects a new server on a new port (skipped until S286 is logged)', async () => {
    const {name, containerId, folder, port} =
      await connectedWithPort('c43-restart');
    try {
      const mark = containersLog().length;
      const began = Date.now();
      await docker('restart', '-t', '2', containerId);
      const dialog = await waitForDialog(name, 30_000);
      const seconds = (Date.now() - began) / 1000;
      await pause(60_000);
      const state = {
        details: dialog.details,
        buttons: [...dialog.buttons],
        withinSixSeconds: seconds < 6,
        stillShown: (await dialogOf(name))?.details,
        indicator: await statusBarText(name, 'status.host'),
        running: await docker(
          'inspect',
          '-f',
          '{{.State.Status}}',
          containerId,
        ),
        attempts: phasesIn(logSince(mark)).length,
      };
      await answerDialog(name, 'Reload Window');
      await connectedToContainer(name);
      const newPort = serverPortsOf(logSince(mark)).every(
        each => each !== port,
      );
      await closeWindow(name);
      deepStrictEqual(
        {...state, newPort},
        {
          details: CANNOT_RECONNECT,
          buttons: ['Cancel', 'Reload Window'],
          withinSixSeconds: true,
          stillShown: CANNOT_RECONNECT,
          indicator: 'Disconnected from Dev Container: c43-restart',
          running: 'running',
          attempts: 1,
          newPort: true,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it.skip('F-0502 AC-39 (c43-pause): a paused container is waited for with attempts and no give-up, and after the unpause the window is connected again to its server without a start (skipped until S286 is logged)', async () => {
    const {name, containerId, folder} = await connectedWithPort('c43-pause');
    try {
      const mark = containersLog().length;
      await docker('pause', containerId);
      const reconnecting = await eventually(
        'the Reconnecting indicator',
        async () => {
          const text = await statusBarText(name, 'status.host');
          return text.startsWith('Reconnecting to Dev Container:')
            ? text
            : undefined;
        },
        60_000,
      );
      await countdownIn(name, 90_000);
      await pause(40_000);
      const whilePaused = {
        terminal: (await dialogOf(name))?.details === CANNOT_RECONNECT,
        attempts: phasesIn(logSince(mark)),
      };
      await docker('unpause', containerId);
      const returned = await eventually(
        'the indicator to return',
        async () => {
          const text = await statusBarText(name, 'status.host');
          return text === 'Dev Container: c43-pause' ? text : undefined;
        },
        60_000,
      );
      const after = logSince(mark);
      const serverLog = await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        "find / -xdev -name '*.log' -exec grep -l 'The client has reconnected.' {} + 2>/dev/null | head -n 1",
      );
      const dialog = await dialogOf(name);
      await closeWindow(name);
      deepStrictEqual(
        {
          reconnecting,
          terminal: whilePaused.terminal,
          attemptsWhilePaused: whilePaused.attempts.length >= 2,
          gaveUp: after.some(line => line.endsWith('containerGone')),
          returned,
          dialog,
          startedAgain: after.includes('Starting VS Code Server'),
          newPort: serverPortsOf(after),
          clientReconnected: serverLog !== '',
        },
        {
          reconnecting: 'Reconnecting to Dev Container: c43-pause...',
          terminal: false,
          attemptsWhilePaused: true,
          gaveUp: false,
          returned: 'Dev Container: c43-pause',
          dialog: undefined,
          startedAgain: false,
          newPort: [],
          clientReconnected: true,
        },
      );
    } finally {
      await docker('unpause', containerId).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it.skip('F-0502 AC-3 (c43-server-killed): a killed server turns the indicator to Reconnecting within 10 s, the countdown dialog comes after 40 s, and our log answers one attempt each at core’s schedule (skipped until S286 is logged)', async () => {
    const {name, containerId, folder} = await connectedWithPort('c43-killed');
    try {
      const mark = containersLog().length;
      const began = Date.now();
      await killServer(containerId);
      const arrivals: number[] = [];
      let indicatorAt = 0;
      let dialogAt = 0;
      while (dialogAt === 0 && Date.now() - began < 120_000) {
        const count = phasesIn(logSince(mark)).length;
        while (arrivals.length < count) {
          arrivals.push(Date.now() - began);
        }
        if (
          indicatorAt === 0 &&
          (await statusBarText(name, 'status.host').catch(() => '')).startsWith(
            'Reconnecting to Dev Container: c43-killed',
          )
        ) {
          indicatorAt = Date.now() - began;
        }
        const shown = await dialogOf(name).catch(() => undefined);
        if (shown !== undefined && COUNTDOWN.test(shown.details)) {
          dialogAt = Date.now() - began;
        }
        await pause(250);
      }
      const gaps = arrivals
        .slice(1, 4)
        .map((arrival, index) => arrival - (arrivals[index] ?? 0));
      await answerDialog(name, 'Dismiss').catch(() => undefined);
      await closeWindow(name);
      deepStrictEqual(
        {
          indicatorWithinTen: indicatorAt > 0 && indicatorAt < 10_000,
          dialogAfterForty: dialogAt > 40_000,
          firstAtOnce: (arrivals[0] ?? 99_999) < 8000,
          gapsNearSchedule: SCHEDULE_GAPS.map(
            (expected, index) => Math.abs((gaps[index] ?? 0) - expected) < 3000,
          ),
        },
        {
          indicatorWithinTen: true,
          dialogAfterForty: true,
          firstAtOnce: true,
          gapsNearSchedule: [true, true, true],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-4 (c43-reconnect-now): Reconnect Now runs an attempt at once and restarts the countdown while the server is down, and Dismiss turns the countdown into a notification with Reconnect Now and Reload Window', async () => {
    const {name, containerId, folder} = await connectedWithPort('c43-now');
    try {
      const mark = containersLog().length;
      await killServer(containerId);
      await countdownIn(name, 120_000);
      const before = attemptsIn(logSince(mark)).length;
      await answerDialog(name, 'Reconnect Now');
      const atOnce = await eventually(
        'an attempt after Reconnect Now',
        () =>
          Promise.resolve(
            attemptsIn(logSince(mark)).length > before ? true : undefined,
          ),
        8000,
      );
      const restarted = await countdownIn(name, 30_000);
      await answerDialog(name, 'Dismiss');
      const notice = await eventually(
        'the countdown notification',
        async () =>
          (await toastDetails(name)).find(toast =>
            toast.message.startsWith('Attempting to reconnect in'),
          ),
        30_000,
      );
      await closeWindow(name);
      deepStrictEqual(
        {
          atOnce,
          restarted: [...restarted.buttons],
          notice: [COUNTDOWN.test(notice.message), [...notice.buttons]],
        },
        {
          atOnce: true,
          restarted: ['Reload Window', 'Dismiss', 'Reconnect Now'],
          notice: [true, ['Reconnect Now', 'Reload Window']],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-5 (c43-five-minutes): after 5 minutes with the container running and the server down, the countdown still counts and the indicator still reads Reconnecting; Reload Window connects a new server on a new port within 8 s', async () => {
    const {name, containerId, folder, port} =
      await connectedWithPort('c43-five');
    try {
      const mark = containersLog().length;
      await killServer(containerId);
      await pause(300_000);
      const dialog = await countdownIn(name, 60_000);
      const indicator = await statusBarText(name, 'status.host');
      const began = Date.now();
      await answerDialog(name, 'Reload Window');
      await connectedToContainer(name);
      const seconds = (Date.now() - began) / 1000;
      const state = {
        countdown: COUNTDOWN.test(dialog.details),
        indicator,
        withinEightSeconds: seconds < 8,
        newPort: serverPortsOf(logSince(mark)).every(each => each !== port),
        started: logSince(mark).includes('Starting VS Code Server'),
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        countdown: true,
        indicator: 'Reconnecting to Dev Container: c43-five...',
        withinEightSeconds: true,
        newPort: true,
        started: true,
      });
    } finally {
      await removeContainers(folder);
    }
  });
});
