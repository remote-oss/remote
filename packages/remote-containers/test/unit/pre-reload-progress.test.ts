import {deepStrictEqual} from 'node:assert';
import {
  PRE_RELOAD_PROGRESS_MILLISECONDS,
  startPreReloadProgress,
} from '../../src/open/pre-reload-progress.ts';
import {settled} from './pending.ts';

const START =
  '[Reading Dev Container Configuration (show log)](command:remote-containers.revealLogTerminal)';

/** The timer and the notification a row steers, and what they recorded. */
interface Recording {
  waits: number[];
  fire: Array<() => void>;
  stops: number;
  shown: string[];
  closes: number;
  /** The Cancel callbacks of the progresses shown. */
  cancels: Array<() => void>;
  /** How often the progress asked its owner to stop the work. */
  stopped: number;
}

function progressOf(): {
  recording: Recording;
  start: () => ReturnType<typeof startPreReloadProgress>;
} {
  const recording: Recording = {
    waits: [],
    fire: [],
    stops: 0,
    shown: [],
    closes: 0,
    cancels: [],
    stopped: 0,
  };
  return {
    recording,
    start: () =>
      startPreReloadProgress(
        {
          showProgress: (title, until, cancel) => {
            recording.cancels.push(cancel);
            recording.shown.push(title);
            void until.then(() => {
              recording.closes += 1;
            });
          },
          setTimer: (milliseconds, callback) => {
            recording.waits.push(milliseconds);
            recording.fire.push(callback);
            return () => {
              recording.stops += 1;
            };
          },
          translate: template => template,
        },
        () => {
          recording.stopped += 1;
        },
      ),
  };
}

describe('the progress before a reload (card containers-24, ruling (c))', () => {
  it('ruling (c): nothing shows before 500 ms', () => {
    const {recording, start} = progressOf();
    start();
    deepStrictEqual(
      [PRE_RELOAD_PROGRESS_MILLISECONDS, recording.waits, recording.shown],
      [500, [500], []],
    );
  });

  it('ruling (c): at 500 ms S283 shows until close', async () => {
    const {recording, start} = progressOf();
    const progress = start();
    recording.fire[0]?.();
    await settled();
    const during = [recording.shown, recording.closes];
    progress.close();
    await settled();
    deepStrictEqual([during, recording.closes], [[[START], 0], 1]);
  });

  it('ruling (c): closed before 500 ms, it never shows', () => {
    const {recording, start} = progressOf();
    start().close();
    recording.fire[0]?.();
    deepStrictEqual([recording.shown, recording.stops], [[], 1]);
  });

  it('ruling (c): close is idempotent and it never reopens', async () => {
    const {recording, start} = progressOf();
    const progress = start();
    recording.fire[0]?.();
    progress.close();
    progress.close();
    recording.fire[0]?.();
    await settled();
    deepStrictEqual(
      [recording.shown, recording.closes, recording.stops],
      [[START], 1, 1],
    );
  });

  it('ruling (c): Cancel closes the progress and asks for the work to stop, once', async () => {
    const {recording, start} = progressOf();
    const progress = start();
    recording.fire[0]?.();
    await settled();
    recording.cancels[0]?.();
    await settled();
    progress.close();
    deepStrictEqual(
      [recording.closes, recording.stopped, recording.stops],
      [1, 1, 1],
    );
  });
});
