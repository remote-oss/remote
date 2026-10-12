import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {
  commandsFor,
  type RunEnd,
  type ShellRun,
  ShellRuns,
} from '../../src/connection-server/shell-runs.ts';

const SCRIPT: ShellRun = {
  script: 'echo hello',
  environment: {},
  inputBase64: null,
  deadlineMilliseconds: 1000,
};

describe('the scripts on the shared session (contracts §4 S10)', () => {
  let clock: FakeClock;
  let written: string[];
  let wedged: number;
  let markers: number;
  let runs: ShellRuns;

  /** Starts a run and collects its lines and its end. */
  function start(request: ShellRun = SCRIPT): {
    lines: string[];
    ended: Promise<RunEnd>;
  } {
    const lines: string[] = [];
    return {lines, ended: runs.execute(request, line => lines.push(line))};
  }

  /** Feeds one run's command lines into the reader, as a terminal echoes them back. */
  function echoOwnCommands(request: ShellRun = SCRIPT): void {
    for (const line of commandsFor(`m${String(markers)}`, request).split(
      '\n',
    )) {
      runs.hear(line);
    }
  }

  beforeEach(() => {
    clock = new FakeClock();
    written = [];
    wedged = 0;
    markers = 0;
    runs = new ShellRuns({
      write: text => written.push(text),
      scheduler: clock.scheduler(),
      newMarker: () => {
        markers += 1;
        return `m${String(markers)}`;
      },
      onWedged: () => {
        wedged += 1;
      },
    });
  });

  describe('the commands of a run', () => {
    it('print the start marker, run the script with no input, and print the end marker with the status', () => {
      deepStrictEqual(
        commandsFor('m1', SCRIPT),
        [
          "printf '%s%s\\n' 'm1:st' 'art'",
          "sh -c 'echo hello' </dev/null",
          "printf '%s%s %s\\n' 'm1:e' 'nd' \"$?\"",
          '',
        ].join('\n'),
      );
    });

    it('quote a script with quotes in it as one word', () => {
      deepStrictEqual(
        commandsFor('m1', {...SCRIPT, script: "echo 'x'"}).split('\n')[1],
        "sh -c 'echo '\\''x'\\''' </dev/null",
      );
    });

    it('§S10: put the environment in front of sh -c as assignments, with no input', () => {
      deepStrictEqual(
        commandsFor('m1', {
          ...SCRIPT,
          environment: {FIRST: 'x y', SECOND: "it's"},
        }).split('\n')[1],
        "FIRST='x y' SECOND='it'\\''s' sh -c 'echo hello' </dev/null",
      );
    });

    it('§S10: put the environment in front of sh -c as assignments, after the pipe, with input', () => {
      deepStrictEqual(
        commandsFor('m1', {
          ...SCRIPT,
          environment: {FIRST: 'x y'},
          inputBase64: 'AQID',
        }).split('\n')[1],
        "base64 -d <<'m1_input' | FIRST='x y' sh -c 'echo hello'",
      );
    });

    it('§S10: an empty environment leaves the command as it was', () => {
      deepStrictEqual(
        commandsFor('m1', SCRIPT).split('\n')[1],
        "sh -c 'echo hello' </dev/null",
      );
    });

    it('give an input to the script as a base64 here-document in lines of 76 characters', () => {
      deepStrictEqual(
        commandsFor('m1', {...SCRIPT, inputBase64: 'A'.repeat(100)}).split(
          '\n',
        ),
        [
          "printf '%s%s\\n' 'm1:st' 'art'",
          "base64 -d <<'m1_input' | sh -c 'echo hello'",
          'A'.repeat(76),
          'A'.repeat(24),
          'm1_input',
          "printf '%s%s %s\\n' 'm1:e' 'nd' \"$?\"",
          '',
        ],
      );
    });

    it('give an empty input as an empty here-document', () => {
      deepStrictEqual(
        commandsFor('m1', {...SCRIPT, inputBase64: ''})
          .split('\n')
          .slice(1, 3),
        ["base64 -d <<'m1_input' | sh -c 'echo hello'", 'm1_input'],
      );
    });

    it('#299: no command line holds the start marker', () => {
      deepStrictEqual(
        commandsFor('m1', SCRIPT)
          .split('\n')
          .some(line => line.includes('m1:start')),
        false,
      );
    });

    it('#299: no command line holds the end marker with its space', () => {
      deepStrictEqual(
        commandsFor('m1', SCRIPT)
          .split('\n')
          .some(line => line.includes('m1:end ')),
        false,
      );
    });

    it('#299: the input commands hold no marker line', () => {
      deepStrictEqual(
        commandsFor('m1', {...SCRIPT, inputBase64: 'A'.repeat(100)})
          .split('\n')
          .some(line => line.includes('m1:start') || line.includes('m1:end ')),
        false,
      );
    });
  });

  describe('the terminal echoing the commands of a run', () => {
    it("F-2308: the commands piped into sh print the markers and the script's lines", () => {
      const result = spawnSync('/bin/sh', [], {
        input: commandsFor('m1', SCRIPT),
      });
      deepStrictEqual(
        [result.status, result.stdout.toString().trim().split('\n')],
        [0, ['m1:start', 'hello', 'm1:end 0']],
      );
    });

    it('#299: a run that hears its own commands keeps them out of its lines', async () => {
      const {lines, ended} = start();
      echoOwnCommands();
      runs.hear('m1:start');
      runs.hear('hi');
      runs.hear('m1:end 0');
      await ended;
      deepStrictEqual(lines, ['hi']);
    });

    it('#299: such a run ends with the script status', async () => {
      const {ended} = start();
      echoOwnCommands();
      runs.hear('m1:start');
      runs.hear('m1:end 0');
      deepStrictEqual(await ended, {kind: 'ended', status: 0});
    });

    it('#299: the same with an input keeps the payload, not the commands', async () => {
      const request: ShellRun = {
        script: 'cat',
        environment: {},
        inputBase64: Buffer.from('payload\n').toString('base64'),
        deadlineMilliseconds: 1000,
      };
      const {lines, ended} = start(request);
      echoOwnCommands(request);
      runs.hear('m1:start');
      runs.hear('payload');
      runs.hear('m1:end 0');
      await ended;
      deepStrictEqual(lines, ['payload']);
    });
  });

  describe('a run', () => {
    it('is written to the session at once when nothing else is on it', () => {
      start();
      deepStrictEqual(written, [commandsFor('m1', SCRIPT)]);
    });

    it('gives the lines after the start marker, not the noise of the login before it', async () => {
      const {lines, ended} = start();
      runs.hear('Welcome to the host');
      runs.hear('m1:start');
      runs.hear('hello');
      runs.hear('m1:end 0');
      await ended;
      deepStrictEqual(lines, ['hello']);
    });

    it('ends with the exit status of the script', async () => {
      const {ended} = start();
      runs.hear('m1:start');
      runs.hear('m1:end 3');
      deepStrictEqual(await ended, {kind: 'ended', status: 3});
    });

    it('gives the last words of a script that wrote no line end', async () => {
      const {lines, ended} = start();
      runs.hear('m1:start');
      runs.hear('partial m1:end 0');
      await ended;
      deepStrictEqual(lines, ['partial ']);
    });

    it('gives no empty line for a marker at the start of a line', async () => {
      const {lines, ended} = start();
      runs.hear('m1:start');
      runs.hear('m1:end 0');
      await ended;
      deepStrictEqual(lines, []);
    });

    it('ignores what the session writes when no run is on it', () => {
      runs.hear('motd');
      deepStrictEqual(written, []);
    });

    it('does not take the marker of another run for its own', async () => {
      const {lines, ended} = start();
      runs.hear('m1:start');
      runs.hear('m2:end 0');
      runs.hear('m1:end 0');
      await ended;
      deepStrictEqual(lines, ['m2:end 0']);
    });
  });

  describe('runs one behind the other', () => {
    it('start only when the one before has ended, in the order they came', async () => {
      const first = start();
      start({...SCRIPT, script: 'echo two'});
      const before = [...written];
      runs.hear('m1:start');
      runs.hear('m1:end 0');
      await first.ended;
      deepStrictEqual(
        [before, written],
        [
          [commandsFor('m1', SCRIPT)],
          [
            commandsFor('m1', SCRIPT),
            commandsFor('m2', {...SCRIPT, script: 'echo two'}),
          ],
        ],
      );
    });

    it('give each run its own lines', async () => {
      const first = start();
      const second = start();
      runs.hear('m1:start');
      runs.hear('one');
      runs.hear('m1:end 0');
      runs.hear('m2:start');
      runs.hear('two');
      runs.hear('m2:end 0');
      await Promise.all([first.ended, second.ended]);
      deepStrictEqual([first.lines, second.lines], [['one'], ['two']]);
    });
  });

  describe('a run past its deadline', () => {
    it('fails as a timeout, and asks the session to end', async () => {
      const {ended} = start();
      runs.hear('m1:start');
      clock.advance(1000);
      deepStrictEqual(
        [await ended, wedged],
        [
          {kind: 'failed', reason: 'timeout', detail: 'no end within 1000 ms'},
          1,
        ],
      );
    });

    it('does not start the run behind it on the session that cannot be trusted', () => {
      start();
      start();
      clock.advance(1000);
      deepStrictEqual(written.length, 1);
    });

    it('is not a timeout when the script ends in time', async () => {
      const {ended} = start();
      runs.hear('m1:start');
      runs.hear('m1:end 0');
      clock.advance(5000);
      deepStrictEqual([await ended, wedged], [{kind: 'ended', status: 0}, 0]);
    });

    it('is counted from the start of the run, not from its wait', async () => {
      start();
      const second = start();
      clock.advance(900);
      runs.hear('m1:start');
      runs.hear('m1:end 0');
      clock.advance(900);
      runs.hear('m2:start');
      runs.hear('m2:end 0');
      deepStrictEqual(await second.ended, {kind: 'ended', status: 0});
    });
  });

  describe('the end of the session', () => {
    it('fails the run on it and the runs behind it as a closed channel', async () => {
      const first = start();
      const second = start();
      runs.end();
      deepStrictEqual(await Promise.all([first.ended, second.ended]), [
        {kind: 'failed', reason: 'channelClosed', detail: 'the session ended'},
        {kind: 'failed', reason: 'channelClosed', detail: 'the session ended'},
      ]);
    });

    it('fails a run that comes after it', async () => {
      runs.end();
      deepStrictEqual(await start().ended, {
        kind: 'failed',
        reason: 'channelClosed',
        detail: 'the session ended',
      });
    });

    it('is harmless when nothing runs', () => {
      runs.end();
      deepStrictEqual(written, []);
    });
  });
});
