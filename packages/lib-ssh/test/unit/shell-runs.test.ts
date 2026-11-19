import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {NOISE_LINES} from 'lib-host/testing/noise';
import {
  commandsFor,
  type RunEnd,
  SESSION_LOCK_TAKEN,
  type ShellRun,
  ShellRuns,
} from '../../src/connection-server/shell-runs.ts';
import {powershellCommandsFor} from '../../src/connection-server/powershell-session.ts';

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
      interpreter: 'posixShell',
      newMarker: () => {
        markers += 1;
        return `m${String(markers)}`;
      },
      onWedged: () => {
        wedged += 1;
      },
    });
  });

  it('F-2701 5.0 step 5: a session of PowerShell writes each run as the loop reads it', () => {
    const written: string[] = [];
    const powershellRuns = new ShellRuns({
      write: text => written.push(text),
      scheduler: clock.scheduler(),
      interpreter: 'powershell',
      newMarker: () => 'p1',
      onWedged: () => undefined,
    });
    void powershellRuns.execute(SCRIPT, () => undefined);
    deepStrictEqual(written, [powershellCommandsFor('p1', SCRIPT)]);
  });

  describe('the commands of a run', () => {
    it('print the start marker, run the script with no input, and print the end marker with the status', () => {
      deepStrictEqual(
        commandsFor('m1', SCRIPT),
        [
          "printf '%s%s\\n' 'm1:st' 'art'",
          "sh -c 'echo hello' 9>&- </dev/null",
          "printf '%s%s %s\\n' 'm1:e' 'nd' \"$?\"",
          '',
        ].join('\n'),
      );
    });

    it('quote a script with quotes in it as one word', () => {
      deepStrictEqual(
        commandsFor('m1', {...SCRIPT, script: "echo 'x'"}).split('\n')[1],
        "sh -c 'echo '\\''x'\\''' 9>&- </dev/null",
      );
    });

    it('§S10: put the environment in front of sh -c as assignments, with no input', () => {
      deepStrictEqual(
        commandsFor('m1', {
          ...SCRIPT,
          environment: {FIRST: 'x y', SECOND: "it's"},
        }).split('\n')[1],
        "FIRST='x y' SECOND='it'\\''s' sh -c 'echo hello' 9>&- </dev/null",
      );
    });

    it('§S10: put the environment in front of sh -c as assignments, after the pipe, with input', () => {
      deepStrictEqual(
        commandsFor('m1', {
          ...SCRIPT,
          environment: {FIRST: 'x y'},
          inputBase64: 'AQID',
        }).split('\n')[1],
        "base64 -d <<'m1_input' | FIRST='x y' sh -c 'echo hello' 9>&-",
      );
    });

    it('§S10: an empty environment leaves the command as it was', () => {
      deepStrictEqual(
        commandsFor('m1', SCRIPT).split('\n')[1],
        "sh -c 'echo hello' 9>&- </dev/null",
      );
    });

    it('F-2408 BR-4: a run without a session lock closes descriptor 9 for its script, so no process it leaves behind holds the lock', () => {
      deepStrictEqual(
        commandsFor('m1', SCRIPT).split('\n')[1]?.includes(' 9>&- '),
        true,
      );
    });

    it('F-2408 BR-4: a run that takes the session lock has the shell open descriptor 9 on the path first, unless the shell holds it, and keeps it for the script', () => {
      deepStrictEqual(
        commandsFor('m1', {
          ...SCRIPT,
          sessionLock: {path: '/tmp/lock one', action: 'open'},
        }).split('\n'),
        [
          "[ -n \"${REMOTE_OSS_LOCK_HELD:-}\" ] || { ( exec 9>>'/tmp/lock one' ) 2>/dev/null && exec 9>>'/tmp/lock one'; }",
          "printf '%s%s\\n' 'm1:st' 'art'",
          "sh -c 'echo hello' </dev/null",
          "printf '%s%s %s\\n' 'm1:e' 'nd' \"$?\"",
          '',
        ],
      );
    });

    it('F-2408 BR-4: a release run gives descriptor 9 up and removes the file only when the shell held the lock', () => {
      deepStrictEqual(
        commandsFor('m1', {
          ...SCRIPT,
          script: '',
          sessionLock: {path: '/tmp/lock', action: 'release'},
        }).split('\n')[1],
        'exec 9>&-; [ -z "${REMOTE_OSS_LOCK_HELD:-}" ] || rm -f \'/tmp/lock\'; unset REMOTE_OSS_LOCK_HELD; trap - EXIT HUP',
      );
    });

    it('give an input to the script as a base64 here-document in lines of 76 characters', () => {
      deepStrictEqual(
        commandsFor('m1', {...SCRIPT, inputBase64: 'A'.repeat(100)}).split(
          '\n',
        ),
        [
          "printf '%s%s\\n' 'm1:st' 'art'",
          "base64 -d <<'m1_input' | sh -c 'echo hello' 9>&-",
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
        ["base64 -d <<'m1_input' | sh -c 'echo hello' 9>&-", 'm1_input'],
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

  describe('the host lock of a session', () => {
    const LOCKED: ShellRun = {
      ...SCRIPT,
      sessionLock: {path: '/tmp/lock', action: 'open'},
    };
    const ARMING =
      "REMOTE_OSS_LOCK_HELD=1; trap 'rm -f '\\''/tmp/lock'\\''' EXIT HUP\n";

    it('F-2408 BR-4: a run whose script reported the lock taken arms the removal at the shell, before the next run is written', async () => {
      const {ended} = start(LOCKED);
      runs.execute(SCRIPT, () => undefined).catch(() => undefined);
      runs.hear('m1:start');
      runs.hear(SESSION_LOCK_TAKEN);
      runs.hear('m1:end 0');
      await ended;
      deepStrictEqual(written.slice(1, 2), [ARMING]);
    });

    it('F-2408 BR-4: a run that was busy arms nothing, so a session that only waited never removes the file', async () => {
      const {ended} = start(LOCKED);
      runs.hear('m1:start');
      runs.hear('server.lockPath=/tmp/lock');
      runs.hear('m1:end 0');
      await ended;
      deepStrictEqual(written, [commandsFor('m1', LOCKED)]);
    });

    it('F-2408 BR-4: a run without a session lock arms nothing even when its output says the lock was taken', async () => {
      const {ended} = start();
      runs.hear('m1:start');
      runs.hear(SESSION_LOCK_TAKEN);
      runs.hear('m1:end 0');
      await ended;
      deepStrictEqual(written, [commandsFor('m1', SCRIPT)]);
    });

    it('F-2408 BR-4: in a real sh, an orderly end after a taken run removes the file, a held lock stays while the shell lives, and a second descriptor on the file finds it busy', function () {
      if (spawnSync('sh', ['-c', 'command -v flock']).status !== 0) {
        this.skip();
      }
      const folder = mkdtempSync(path.join(tmpdir(), 'lock-'));
      const file = path.join(folder, 'host.lock');
      const locked: ShellRun = {
        ...SCRIPT,
        script: `flock -n 9 && echo ${SESSION_LOCK_TAKEN}`,
        sessionLock: {path: file, action: 'open'},
      };
      const arming = `REMOTE_OSS_LOCK_HELD=1; trap 'rm -f '\\''${file}'\\''' EXIT HUP\n`;
      const another = `( exec 7>>'${file}'; flock -n 7 ) && echo free || echo busy\n`;
      const result = spawnSync('/bin/sh', [], {
        input: `${commandsFor('m1', locked)}${arming}${another}`,
      });
      deepStrictEqual(
        [result.stdout.toString().trim().split('\n'), existsSync(file)],
        [['m1:start', SESSION_LOCK_TAKEN, 'm1:end 0', 'busy'], false],
      );
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

    it('ADR-0010: the run markers: noise around and inside its stream changes nothing', async () => {
      const noise = [...NOISE_LINES, 'm9:start', 'm9:end 0'];
      const first = start();
      const second = start();
      for (const line of [
        ...noise,
        'm1:start',
        'one',
        'm1:end 4',
        ...noise,
        'm2:start',
        'two',
        'm2:end 0',
        ...noise,
      ]) {
        runs.hear(line);
      }
      deepStrictEqual(
        [first.lines, await first.ended, second.lines, await second.ended],
        [
          ['one'],
          {kind: 'ended', status: 4},
          ['two'],
          {kind: 'ended', status: 0},
        ],
      );
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
