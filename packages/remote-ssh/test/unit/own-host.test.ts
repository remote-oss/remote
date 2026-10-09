/**
 * @fileoverview Kill and uninstall on the window's own host (card connect-11): the availability, the two
 * plans with and without the local server, and the notice of each outcome.
 */

import {deepStrictEqual} from 'node:assert';
import {
  killCurrentAvailable,
  killCurrentPlan,
  killResult,
  uninstallOwnHostPlan,
  uninstallResult,
} from '../../src/maintenance/own-host.ts';

describe('killCurrentAvailable (the availability of the command)', () => {
  it('F-2411.AC-1: only the connected window may kill', () => {
    deepStrictEqual(
      [
        killCurrentAvailable('local'),
        killCurrentAvailable('sshConnected'),
        killCurrentAvailable('sshDisconnected'),
      ],
      [false, true, false],
    );
  });
});

describe('killCurrentPlan (the plan of the kill)', () => {
  it('F-2411.BR-10: with the local server, no connection and no host act, the window switches', () => {
    deepStrictEqual(killCurrentPlan(true), {
      opensConnection: false,
      actsOnHost: false,
      switchesToLocalWindow: true,
      forgetsStoredDetails: true,
      notice: 'killed',
    });
  });

  it('F-2411.BR-10: without it, the connection is made and the host acted on, the window stays', () => {
    deepStrictEqual(killCurrentPlan(false), {
      opensConnection: true,
      actsOnHost: true,
      switchesToLocalWindow: false,
      forgetsStoredDetails: true,
      notice: 'killed',
    });
  });

  it('F-2411.BR-10: the notice is killed in every mode', () => {
    deepStrictEqual(
      [killCurrentPlan(true).notice, killCurrentPlan(false).notice],
      ['killed', 'killed'],
    );
  });

  it('F-2411.BR-8: the stored details are forgotten in every mode', () => {
    deepStrictEqual(
      [
        killCurrentPlan(true).forgetsStoredDetails,
        killCurrentPlan(false).forgetsStoredDetails,
      ],
      [true, true],
    );
  });

  it('F-2410.BR-2: the caller applies the socket-mode rule, the plan takes the effective value', () => {
    deepStrictEqual(killCurrentPlan(false), {
      opensConnection: true,
      actsOnHost: true,
      switchesToLocalWindow: false,
      forgetsStoredDetails: true,
      notice: 'killed',
    });
  });
});

describe('uninstallOwnHostPlan (the plan of the uninstall)', () => {
  it('F-2412.BR-6: with the local server, nothing is removed and the window switches', () => {
    deepStrictEqual(uninstallOwnHostPlan(true), {
      opensConnection: false,
      actsOnHost: false,
      switchesToLocalWindow: true,
      forgetsStoredDetails: true,
      notice: 'none',
    });
  });

  it('F-2412.BR-6: without it, the connection is made and the removal runs, the window stays', () => {
    deepStrictEqual(uninstallOwnHostPlan(false), {
      opensConnection: true,
      actsOnHost: true,
      switchesToLocalWindow: false,
      forgetsStoredDetails: true,
      notice: 'none',
    });
  });

  it('F-2412.BR-1: the notice is none in every mode', () => {
    deepStrictEqual(
      [uninstallOwnHostPlan(true).notice, uninstallOwnHostPlan(false).notice],
      ['none', 'none'],
    );
  });

  it('F-2412.BR-7: the stored details are forgotten in every mode', () => {
    deepStrictEqual(
      [
        uninstallOwnHostPlan(true).forgetsStoredDetails,
        uninstallOwnHostPlan(false).forgetsStoredDetails,
      ],
      [true, true],
    );
  });
});

describe('the notices of the outcomes', () => {
  it('F-2411.BR-5: the kill shows killed, or killFailed when the connection failed', () => {
    deepStrictEqual(
      [killResult('stepRan'), killResult('connectionFailed')],
      ['killed', 'killFailed'],
    );
  });

  it('F-2412.BR-5: the uninstall is silent, or shows the command error', () => {
    deepStrictEqual(
      [uninstallResult('stepRan'), uninstallResult('connectionFailed')],
      ['silent', 'commandError'],
    );
  });
});
