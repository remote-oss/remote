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
    start: {program: 'open', parameters: ['-g', '-a', 'Docker']},
    listing: {
      program: 'pgrep',
      parameters: ['-x', 'Docker'],
      processName: 'Docker',
    },
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
      return Promise.resolve(setup.results.shift() ?? {passed: true});
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
  it('F-0202 AC-24, BR-13: a passing check ends the step at once', async () => {
    const {ports, calls, signal} = portsOf({results: [{passed: true}]});
    const outcome = await checkAndStart(ports, signal);
    deepStrictEqual([outcome, calls], [{kind: 'ok'}, ['check']]);
  });

  it('F-0202 AC-57, BR-12: a host without start data keeps the first failure', async () => {
    const {ports, calls, signal} = portsOf({
      results: [{passed: false, errorText: DOWN}],
    });
    const outcome = await checkAndStart(ports, signal);
    deepStrictEqual(
      [outcome, calls],
      [{kind: 'failed', errorText: DOWN}, ['check']],
    );
  });

  for (const [reason, installed, errorText] of [
    ['an application that is not installed', false, DOWN],
    ['an error that is not the daemon being down', true, 'denied'],
  ] as const) {
    it(`F-0202 AC-57, BR-12: ${reason} keeps the failure`, async () => {
      const {ports, calls, signal} = portsOf({
        data: dataOf({kind: 'count', limit: 2}, {kind: 'count', limit: 2}),
        installed,
        results: [{passed: false, errorText}],
      });
      const outcome = await checkAndStart(ports, signal);
      deepStrictEqual(
        [outcome, calls],
        [{kind: 'failed', errorText}, ['check']],
      );
    });
  }

  it('F-0202 AC-24, BR-13: a daemon that is down starts the application and the repeated check passes', async () => {
    const {ports, calls, signal} = portsOf({
      data: dataOf({kind: 'count', limit: 2}, {kind: 'count', limit: 3}),
      results: [
        {passed: false, errorText: DOWN},
        {passed: false, errorText: DOWN},
        {passed: true},
      ],
    });
    const outcome = await checkAndStart(ports, signal);
    deepStrictEqual(
      [outcome, calls],
      [{kind: 'ok'}, ['check', 'start', 'wait', 'check', 'wait', 'check']],
    );
  });

  it('F-0202 AC-44, BR-13: an application already running is not started again and uses the running bound', async () => {
    const {ports, calls, signal} = portsOf({
      data: dataOf({kind: 'count', limit: 1}, {kind: 'count', limit: 5}),
      running: true,
      results: [
        {passed: false, errorText: DOWN},
        {passed: false, errorText: 'still down'},
      ],
    });
    const outcome = await checkAndStart(ports, signal);
    deepStrictEqual(
      [outcome, calls],
      [{kind: 'failed', errorText: 'still down'}, ['check', 'wait', 'check']],
    );
  });

  it('F-0202 AC-56: a timed bound ends the repeats once the time since the start is over', async () => {
    const {ports, calls, signal} = portsOf({
      data: dataOf({kind: 'count', limit: 1}, {kind: 'time', limit: 25}),
      results: Array.from({length: 10}, () => ({
        passed: false as const,
        errorText: DOWN,
      })),
    });
    const outcome = await checkAndStart(ports, signal);
    deepStrictEqual(
      [outcome, calls.filter(call => call === 'wait').length],
      [{kind: 'failed', errorText: DOWN}, 3],
    );
  });

  it('F-0202 AC-32: cancelling during a wait ends the step without another check', async () => {
    const {ports, calls, signal} = portsOf({
      data: dataOf({kind: 'count', limit: 3}, {kind: 'count', limit: 3}),
      abortOnWait: true,
      results: [{passed: false, errorText: DOWN}],
    });
    const outcome = await checkAndStart(ports, signal);
    deepStrictEqual(
      [outcome, calls],
      [{kind: 'stopped'}, ['check', 'start', 'wait']],
    );
  });
});
