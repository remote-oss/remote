import {deepStrictEqual} from 'node:assert';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  appendScript,
  connectedWithin,
  isOpen,
  openWindow,
  recordLines,
  reloadWindow,
  signal,
  waitFor,
} from '../windows/harness.ts';
import {
  answerEntry,
  dialogLines,
  failureOf,
  dismissals,
  markerOf,
  openConnected,
  withSetting,
  writeScript,
} from './support.ts';

/** The numbers on the lines of a script's marker. */
function pidsOf(script: string): number[] {
  return (markerOf(script) ?? '')
    .split('\n')
    .filter(line => /^\d+$/.test(line))
    .map(Number);
}

/** Whether a process with this id runs. */
function alive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

/** Ends the processes, whatever their state. */
function end(processIds: readonly number[]): void {
  for (const processId of processIds) {
    try {
      process.kill(processId, 'SIGKILL');
    } catch {
      // The process has ended already.
    }
  }
}

/** The dialog lines that were shown, not the ones that wait. */
function shown(window: string): number {
  return dialogLines(window).filter(line => line.held !== true).length;
}

const SECOND = 1000;

describe('the pre-connection script that takes its time (card connect-87)', function () {
  this.timeout(900_000);

  afterEach(closeAllButLocal);

  it('F-2108 AC-5 (waits): a dialog nobody answers stays open for two minutes, with no failure and no script, and runs the script when allowed', async () => {
    const script = writeScript('waits.sh', 'echo ran > "$MARKER"');
    appendScript([{...answerEntry('pw5', 'Allow'), after: 'f2108-allow-pw5'}]);
    await withSetting(script, async () => {
      await openWindow('harness', 'pw5');
      await new Promise(resolve => setTimeout(resolve, 120 * SECOND));
      const waiting = [
        markerOf(script),
        recordLines('failureDialog', 'pw5').length,
        isOpen('pw5'),
      ];
      signal('f2108-allow-pw5');
      await connectedWithin('pw5', 120 * SECOND);
      deepStrictEqual(
        [waiting, markerOf(script)],
        [[undefined, 0, true], 'ran\n'],
      );
    });
  });

  it('F-2108 AC-8 (long): a script that runs for 150 seconds holds the connect, which goes on when it ends', async () => {
    const script = writeScript(
      'long.sh',
      'date +%s > "$MARKER"\nsleep 150\ndate +%s >> "$MARKER"',
    );
    appendScript([answerEntry('pw8', 'Allow')]);
    await withSetting(script, async () => {
      await openWindow('harness', 'pw8');
      await connectedWithin('pw8', 200 * SECOND);
    });
    const [began, ended] = (markerOf(script) ?? '').split('\n').map(Number);
    deepStrictEqual((ended ?? 0) - (began ?? 0) >= 150, true);
  });

  it('F-2108 AC-9 (reload): a reload asks again', async () => {
    const script = writeScript('reload.sh', 'echo ran >> "$MARKER"');
    appendScript([answerEntry('pw9', 'Allow'), answerEntry('pw9', 'Allow')]);
    await withSetting(script, async () => {
      await openConnected('pw9');
      await reloadWindow('pw9');
      await connectedWithin('pw9', 120 * SECOND);
    });
    deepStrictEqual([shown('pw9'), markerOf(script)], [2, 'ran\nran\n']);
  });

  it('F-2108 AC-34 (reload-running): a script a reload leaves running goes on and ends by itself, and Allow after the reload starts a second one', async () => {
    const script = writeScript(
      'running.sh',
      'echo $$ >> "$MARKER"\nsleep 60\necho end >> "$MARKER"',
    );
    appendScript([answerEntry('pw34', 'Allow'), answerEntry('pw34', 'Allow')]);
    try {
      await withSetting(script, async () => {
        await openWindow('harness', 'pw34');
        await waitFor(
          'the first script to start',
          () => Promise.resolve(pidsOf(script).length === 1),
          60 * SECOND,
        );
        await reloadWindow('pw34');
        await waitFor(
          'the second script to start',
          () => Promise.resolve(pidsOf(script).length === 2),
          60 * SECOND,
        );
        const [first = 0, second = 0] = pidsOf(script);
        deepStrictEqual(
          [alive(first), alive(second), first !== second],
          [true, true, true],
        );
        await connectedWithin('pw34', 200 * SECOND);
      });
    } finally {
      end(pidsOf(script));
    }
  });

  it('F-2108 AC-40 (two-windows): two windows ask once each, answering one leaves the other held, and each script runs once', async () => {
    const script = writeScript('two.sh', 'echo $$ >> "$MARKER"\nsleep 5');
    appendScript([
      answerEntry('pw40a', 'Allow'),
      {...answerEntry('pw40b', 'Allow'), after: 'f2108-allow-pw40b'},
    ]);
    try {
      await withSetting(script, async () => {
        await openWindow('harness', 'pw40a');
        await openWindow('harness', 'pw40b');
        await connectedWithin('pw40a', 120 * SECOND);
        const whileWaiting = [
          pidsOf(script).length,
          recordLines('preconnectDialog', 'pw40b').filter(
            line => line.held === true,
          ).length,
        ];
        signal('f2108-allow-pw40b');
        await connectedWithin('pw40b', 120 * SECOND);
        deepStrictEqual(
          [whileWaiting, pidsOf(script).length, new Set(pidsOf(script)).size],
          [[1, 1], 2, 2],
        );
      });
    } finally {
      end(pidsOf(script));
    }
  });

  it('F-2108 AC-42 (bound): a script that outlasts five minutes fails the connect within the bound and is left running', async () => {
    const script = writeScript('bound.sh', 'echo $$ >> "$MARKER"\nsleep 400');
    appendScript([answerEntry('pw42', 'Allow'), ...dismissals('pw42')]);
    const began = Date.now();
    try {
      const dialog = await withSetting(script, () =>
        failureOf('pw42', 'harness', 340 * SECOND),
      );
      const [processId = 0] = pidsOf(script);
      deepStrictEqual(
        [
          dialog.question.startsWith(
            'Could not establish connection to "harness"',
          ),
          Date.now() - began <= 330 * SECOND,
          alive(processId),
        ],
        [true, true, true],
      );
    } finally {
      end(pidsOf(script));
    }
  });
});
