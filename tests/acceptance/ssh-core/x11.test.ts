import {deepStrictEqual} from 'node:assert';
import {recordLines, userSettings} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';
import {
  DISPLAY_PROBE,
  inDebugger,
  inTask,
  inTerminal,
  x11Close,
  x11Window,
} from '../windows/x11-support.ts';

/** The first line the probe prints, a display of the forwarded kind. */
const DISPLAY_LINE = /^DISPLAY=localhost:\d+\.0\n/;

/** The X client's own report of its connection to the display. */
const CONNECTED = /\nname of display: +localhost:\d+\.0\n/;

describe('F-2312: X11 forwarding into the remote environment', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2312 AC-3, AC-4 (c84-task-debug): a shell task and a node launch configuration see the window’s display and run an X client on it', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-task-debug', 'x11fwd');
      const terminal = await inTerminal('c84-task-debug', DISPLAY_PROBE);
      const task = await inTask('c84-task-debug', DISPLAY_PROBE);
      const debugged = await inDebugger('c84-task-debug', DISPLAY_PROBE);
      function display(text: string): string {
        return text.split('\n')[0] ?? '';
      }
      deepStrictEqual(
        [
          display(task),
          display(debugged),
          CONNECTED.test(task),
          CONNECTED.test(debugged),
        ],
        [display(terminal), display(terminal), true, true],
      );
      await x11Close('c84-task-debug');
    });
  });

  it('F-2312 AC-15 (c84-terminal): with the local server off the terminal, the task and the debugger have the display too', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-terminal', 'x11fwd', {
        'remote.SSH.useLocalServer': false,
      });
      const terminal = await inTerminal('c84-terminal', DISPLAY_PROBE);
      const task = await inTask('c84-terminal', DISPLAY_PROBE);
      const debugged = await inDebugger('c84-terminal', DISPLAY_PROBE);
      deepStrictEqual(
        [terminal, task, debugged].map(
          text => DISPLAY_LINE.test(text) && CONNECTED.test(text),
        ),
        [true, true, true],
      );
      await x11Close('c84-terminal');
    });
  });

  it('F-2312 AC-16 (c84-trusted): the SECURITY extension is listed with ForwardX11Trusted yes and not by default', async () => {
    await keepingSettings(async () => {
      const seen: string[] = [];
      for (const alias of ['x11fwd', 'x11-untrusted']) {
        await closeAllButLocal();
        await x11Window('c84-trusted', alias);
        const text = await inTerminal('c84-trusted', DISPLAY_PROBE);
        seen.push(
          `${DISPLAY_LINE.test(text) && CONNECTED.test(text) ? 'works' : 'fails'} ${text.trim().split('\n').at(-1) ?? ''}`,
        );
        await x11Close('c84-trusted');
      }
      deepStrictEqual(seen, ['works 1', 'works 0']);
    });
  });

  it('F-2312 AC-20 (c84-match): ForwardX11 given only in a Match block that applies to the host gives the display', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-match', 'x11-match');
      const terminal = await inTerminal('c84-match', DISPLAY_PROBE);
      deepStrictEqual(
        [DISPLAY_LINE.test(terminal), CONNECTED.test(terminal)],
        [true, true],
      );
      await x11Close('c84-match');
    });
  });

  it('F-2312 AC-13 (c84-off-after): turning the setting off in a connected window shows nothing, and new terminals keep the display', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-off-after', 'x11fwd');
      const before = await inTerminal('c84-off-after', DISPLAY_PROBE);
      await userSettings({'remote.SSH.enableX11Forwarding': false});
      await new Promise(resolve => setTimeout(resolve, 3000));
      const after = await inTerminal('c84-off-after', DISPLAY_PROBE);
      deepStrictEqual(
        [after.split('\n')[0], recordLines('notice', 'c84-off-after').length],
        [before.split('\n')[0], 0],
      );
      await x11Close('c84-off-after');
    });
  });
});
