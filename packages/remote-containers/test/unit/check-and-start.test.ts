import {deepStrictEqual} from 'node:assert';
import {
  checkAndStart,
  type CheckAndStartPorts,
  type CheckResult,
} from '../../src/engine/check-and-start.ts';
import type {DesktopData} from '../../src/engine/docker-desktop.ts';

const DOWN = 'failed to connect to the docker API at npipe';

/** Start data with a 10 ms interval and the given bounds. */
function dataOf(
  running: DesktopData['rechecks']['running'],
  started: DesktopData['rechecks']['started'],
): DesktopData {
  return {
    application: '/Applications/Docker.app',
    start: {program: 'open', args: ['-g', '-a', 'Docker']},
    listing: {program: 'pgrep', args: ['-x', 'Docker'], processName: 'Docker'},
    recheckIntervalMilliseconds: 10,
    rechecks: {running, started},
  };
}

interface Setup {
  results: CheckResult[];
  data?: DesktopData;
  installed?: boolean;
  running?: boolean;
  abortOnWait?: boolean;
}

/** Ports over a script of check results; `calls` records what happened, and the clock moves by each wait. */
function portsOf(setup: Setup) {
  const calls: string[] = [];
  const controller = new AbortController();
  let clock = 0;
  const ports: CheckAndStartPorts = {
    check: () => {
      calls.push('check');
      return Promise.resolve(setup.results.shift() ?? {ok: true});
    },
    data: setup.data,
    installed: () => Promise.resolve(setup.installed ?? true),
    running: () => Promise.resolve(setup.running ?? false),
    start: () => {
      calls.push('start');
      return Promise.resolve();
    },
    wait: milliseconds => {
      calls.push('wait');
      clock += milliseconds;
      if (setup.abortOnWait === true) {
        controller.abort();
      }
      return Promise.resolve();
    },
    now: () => clock,
  };
  return {ports, calls, signal: controller.signal};
}

describe('check and start (card containers-200, §2)', () => {
  it('F-0202 AC-39: a passing check ends the step at once', async () => {
    const {ports, calls, signal} = portsOf({results: [{ok: true}]});
    deepStrictEqual(await checkAndStart(ports, signal), {kind: 'ok'});
    deepStrictEqual(calls, ['check']);
  });

  it('F-0202 AC-39: a host without start data keeps the first failure', async () => {
    const {ports, calls, signal} = portsOf({
      results: [{ok: false, errorText: DOWN}],
    });
    deepStrictEqual(await checkAndStart(ports, signal), {
      kind: 'failed',
      errorText: DOWN,
    });
    deepStrictEqual(calls, ['check']);
  });

  it('F-0202 AC-39: an application that is not installed, or an error that is not the daemon being down, keeps the failure', async () => {
    const data = dataOf({kind: 'count', limit: 2}, {kind: 'count', limit: 2});
    const missing = portsOf({
      data,
      installed: false,
      results: [{ok: false, errorText: DOWN}],
    });
    deepStrictEqual(await checkAndStart(missing.ports, missing.signal), {
      kind: 'failed',
      errorText: DOWN,
    });
    const other = portsOf({data, results: [{ok: false, errorText: 'denied'}]});
    deepStrictEqual(await checkAndStart(other.ports, other.signal), {
      kind: 'failed',
      errorText: 'denied',
    });
    deepStrictEqual([missing.calls, other.calls], [['check'], ['check']]);
  });

  it('F-0202 AC-39: a daemon that is down starts the application and the repeated check passes', async () => {
    const {ports, calls, signal} = portsOf({
      data: dataOf({kind: 'count', limit: 2}, {kind: 'count', limit: 3}),
      results: [
        {ok: false, errorText: DOWN},
        {ok: false, errorText: DOWN},
        {ok: true},
      ],
    });
    deepStrictEqual(await checkAndStart(ports, signal), {kind: 'ok'});
    deepStrictEqual(calls, [
      'check',
      'start',
      'wait',
      'check',
      'wait',
      'check',
    ]);
  });

  it('F-0202 AC-39: an application already running is not started again and uses the running bound', async () => {
    const {ports, calls, signal} = portsOf({
      data: dataOf({kind: 'count', limit: 1}, {kind: 'count', limit: 5}),
      running: true,
      results: [
        {ok: false, errorText: DOWN},
        {ok: false, errorText: 'still down'},
      ],
    });
    deepStrictEqual(await checkAndStart(ports, signal), {
      kind: 'failed',
      errorText: 'still down',
    });
    deepStrictEqual(calls, ['check', 'wait', 'check']);
  });

  it('F-0202 AC-39: a timed bound ends the repeats once the time since the start is over', async () => {
    const {ports, calls, signal} = portsOf({
      data: dataOf({kind: 'count', limit: 1}, {kind: 'time', limit: 25}),
      results: Array.from({length: 10}, () => ({
        ok: false as const,
        errorText: DOWN,
      })),
    });
    deepStrictEqual(await checkAndStart(ports, signal), {
      kind: 'failed',
      errorText: DOWN,
    });
    deepStrictEqual(calls.filter(call => call === 'wait').length, 3);
  });

  it('F-0202 AC-39: cancelling during a wait ends the step without another check', async () => {
    const {ports, calls, signal} = portsOf({
      data: dataOf({kind: 'count', limit: 3}, {kind: 'count', limit: 3}),
      abortOnWait: true,
      results: [{ok: false, errorText: DOWN}],
    });
    deepStrictEqual(await checkAndStart(ports, signal), {kind: 'stopped'});
    deepStrictEqual(calls, ['check', 'start', 'wait']);
  });
});
