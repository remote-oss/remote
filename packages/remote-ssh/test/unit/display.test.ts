/**
 * @fileoverview The forwarded display of an SSH window (card connect-09): the session's own `DISPLAY` passed to
 * the terminals unchanged, the setting and the session decide the plan, and a reused connection keeps its
 * stored plan.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  mergedDisplay,
  planDisplay,
  terminalEnvironment,
} from '../../src/environment/display.ts';

/** The inputs a row sets, over a new connection with the setting on. */
function input(
  changes: Partial<Parameters<typeof planDisplay>[0]>,
): Parameters<typeof planDisplay>[0] {
  return {
    settingEnabled: true,
    sessionDisplay: 'localhost:10.0',
    newConnection: true,
    stored: undefined,
    ...changes,
  };
}

describe('planDisplay (the forwarded display of a window)', () => {
  it('F-2312.BR-2: setting off, a session display present, is none with settingOff', () => {
    deepStrictEqual(planDisplay(input({settingEnabled: false})), {
      kind: 'none',
      reason: 'settingOff',
    });
  });

  it('F-2312.BR-2: setting on, no session display, is none with noSessionDisplay', () => {
    deepStrictEqual(planDisplay(input({sessionDisplay: ''})), {
      kind: 'none',
      reason: 'noSessionDisplay',
    });
  });

  it('F-2312.AC-25: setting on and no session display, the environment is empty', () => {
    deepStrictEqual(
      terminalEnvironment(
        planDisplay(input({newConnection: true, sessionDisplay: ''})),
      ),
      {},
    );
  });

  it('F-2312.BR-3: a session display becomes a display plan with its value', () => {
    deepStrictEqual(planDisplay(input({sessionDisplay: 'localhost:11.0'})), {
      kind: 'display',
      value: 'localhost:11.0',
    });
  });

  it('F-2312.BR-3: a unix display path stays exactly as reported', () => {
    deepStrictEqual(
      planDisplay(input({sessionDisplay: 'unix:/run/user/1/x11'})),
      {kind: 'display', value: 'unix:/run/user/1/x11'},
    );
  });

  it('F-2312.BR-1: a reused connection with a stored display keeps it, setting off', () => {
    deepStrictEqual(
      planDisplay(
        input({
          newConnection: false,
          stored: {kind: 'display', value: 'localhost:10.0'},
          settingEnabled: false,
        }),
      ),
      {kind: 'display', value: 'localhost:10.0'},
    );
  });

  it('F-2312.AC-31: a reused connection with a stored none keeps it, setting on', () => {
    deepStrictEqual(
      planDisplay(
        input({
          newConnection: false,
          stored: {kind: 'none', reason: 'settingOff'},
          settingEnabled: true,
          sessionDisplay: 'localhost:10.0',
        }),
      ),
      {kind: 'none', reason: 'settingOff'},
    );
  });

  it('F-2312.BR-1: a reused connection with nothing stored plans fresh', () => {
    deepStrictEqual(
      planDisplay(input({newConnection: false, stored: undefined})),
      {kind: 'display', value: 'localhost:10.0'},
    );
  });

  it('F-2312.BR-11: a new connection takes the session display over the stored one', () => {
    deepStrictEqual(
      planDisplay(
        input({
          newConnection: true,
          stored: {kind: 'display', value: 'localhost:10.0'},
          sessionDisplay: 'localhost:12.0',
        }),
      ),
      {kind: 'display', value: 'localhost:12.0'},
    );
  });

  it('F-2312.BR-5: the environment of a display plan holds DISPLAY only', () => {
    deepStrictEqual(
      terminalEnvironment({kind: 'display', value: 'localhost:11.0'}),
      {DISPLAY: 'localhost:11.0'},
    );
  });

  it('F-2312.BR-2: the environment of a none plan is empty', () => {
    deepStrictEqual(
      terminalEnvironment({kind: 'none', reason: 'noSessionDisplay'}),
      {},
    );
  });

  it('F-2312.BR-4: a display plan replaces the inherited value', () => {
    strictEqual(
      mergedDisplay('localhost:10.0', {
        kind: 'display',
        value: 'localhost:12.0',
      }),
      'localhost:12.0',
    );
  });

  it('F-2312.AC-21: a none plan leaves the inherited value, stale as it is', () => {
    strictEqual(
      mergedDisplay('localhost:10.0', {kind: 'none', reason: 'settingOff'}),
      'localhost:10.0',
    );
  });

  it('F-2312.AC-8: a none plan with nothing inherited is undefined', () => {
    strictEqual(
      mergedDisplay(undefined, {kind: 'none', reason: 'noSessionDisplay'}),
      undefined,
    );
  });
});
