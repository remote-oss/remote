import {deepStrictEqual} from 'node:assert';
import type {Invocation} from 'lib-ssh';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {LoginTerminalTracker} from '../../src/surfaces/login-terminal-tracker.ts';

const INVOCATION: Invocation = {program: 'ssh', arguments: [], environment: {}};

/** A tracker over recording terminals, and how often the log was shown. */
function trackerOver() {
  const terminals = new RecordingTerminals();
  const shown = {logs: 0};
  return {
    terminals,
    tracker: new LoginTerminalTracker(terminals),
    shown,
    details: (tracker: LoginTerminalTracker, terminalMode: boolean) => {
      tracker.revealDetails(terminalMode, () => {
        shown.logs += 1;
      });
    },
  };
}

describe('the login terminal tracker (card connect-108)', () => {
  it('F-2308 AC-6: in the terminal mode the details reveal the running install terminal, not the log', () => {
    const {terminals, tracker, shown, details} = trackerOver();
    tracker.open(INVOCATION, 'install', false);
    details(tracker, true);
    deepStrictEqual([terminals.opened[0]?.revealCount, shown.logs], [1, 0]);
  });

  it('F-2308 6.2: the details reveal the latest running terminal, the tunnel’s when it asks', () => {
    const {terminals, tracker, details} = trackerOver();
    tracker.open(INVOCATION, 'install', false);
    tracker.open(INVOCATION, 'SSH Tunnel', false);
    details(tracker, true);
    deepStrictEqual(
      terminals.opened.map(terminal => terminal.revealCount),
      [0, 1],
    );
  });

  it('F-2308 6.4: outside the terminal mode the details show the log, whatever terminal runs', () => {
    const {terminals, tracker, shown, details} = trackerOver();
    tracker.open(INVOCATION, 'install', false);
    details(tracker, false);
    deepStrictEqual([terminals.opened[0]?.revealCount, shown.logs], [0, 1]);
  });

  it('F-2308: with no terminal running the details show the log', () => {
    const {tracker, shown, details} = trackerOver();
    details(tracker, true);
    deepStrictEqual(shown.logs, 1);
  });

  it('F-2308: a terminal that ended is not revealed, and the log shows instead', () => {
    const {terminals, tracker, shown, details} = trackerOver();
    tracker.open(INVOCATION, 'install', false);
    terminals.opened[0]?.end(0);
    details(tracker, true);
    deepStrictEqual([terminals.opened[0]?.revealCount, shown.logs], [0, 1]);
  });

  it('F-2308: the end of an earlier terminal leaves the latest one to reveal', () => {
    const {terminals, tracker, shown, details} = trackerOver();
    tracker.open(INVOCATION, 'install', false);
    tracker.open(INVOCATION, 'SSH Tunnel', false);
    terminals.opened[0]?.end(0);
    details(tracker, true);
    deepStrictEqual([terminals.opened[1]?.revealCount, shown.logs], [1, 0]);
  });
});
