import {deepStrictEqual} from 'node:assert';
import {
  CLIENT_CHECK_MILLISECONDS,
  connectionLimitsFor,
  effectiveConnectTimeoutSeconds,
  HELPER_CLIENT_WAITS,
  HELPER_GRACE_MILLISECONDS,
  HOST_LOCK_ATTEMPTS,
  HOST_LOCK_INTERVAL_MILLISECONDS,
  PRECONNECT_MILLISECONDS,
  SERVER_BOUNDS,
  SESSION_RUN_LIMITS,
  connectWaitsFor,
} from '../../src/pipeline/bounds.ts';

describe('the connect bounds', () => {
  it('F-2403 AC-24: half an hour for the host download, a minute for the server to listen', () => {
    deepStrictEqual(SERVER_BOUNDS, {downloadSeconds: 1800, readySeconds: 15});
  });

  it('F-2108 AC-8: five minutes for the pre-connection script', () => {
    deepStrictEqual(PRECONNECT_MILLISECONDS, 300000);
  });

  it('F-2101 AC-20: thirty seconds for one check of an ssh program', () => {
    deepStrictEqual(CLIENT_CHECK_MILLISECONDS, 30000);
  });
});

describe('the connect timeout', () => {
  it('F-2105 BR-1: neither the host nor the setting names one: 15', () => {
    deepStrictEqual(effectiveConnectTimeoutSeconds(undefined, undefined), 15);
  });

  it('F-2105 BR-1: the setting names 30', () => {
    deepStrictEqual(effectiveConnectTimeoutSeconds(undefined, 30), 30);
  });

  it("F-2105 BR-1: the host's own value wins over the setting", () => {
    deepStrictEqual(effectiveConnectTimeoutSeconds('45', 30), 45);
  });

  it("F-2105 BR-4: the setting's 0 stays 0", () => {
    deepStrictEqual(effectiveConnectTimeoutSeconds(undefined, 0), 0);
  });

  it("ruled on #253 Q7: a host's 0 gets the named ceiling", () => {
    deepStrictEqual(effectiveConnectTimeoutSeconds('0', 30), 600);
  });

  for (const setting of [-3, 'x', 1.5]) {
    it(`F-2105 BR-1: a setting of ${JSON.stringify(setting)} is not a timeout: 15`, () => {
      deepStrictEqual(effectiveConnectTimeoutSeconds(undefined, setting), 15);
    });
  }

  it('F-2105 BR-1: a host value that is no whole number is ignored', () => {
    deepStrictEqual(effectiveConnectTimeoutSeconds('abc', 20), 20);
  });
});

describe('the waits of the probe and the tunnel', () => {
  it('F-2401 AC-18: a timeout of 15 waits 17 seconds for the probe and 15 for the tunnel', () => {
    deepStrictEqual(connectWaitsFor(15), {
      probeMilliseconds: 17000,
      tunnelMilliseconds: 15000,
    });
  });

  it('F-2105 BR-4: a timeout of 0 waits 2 seconds for both', () => {
    deepStrictEqual(connectWaitsFor(0), {
      probeMilliseconds: 2000,
      tunnelMilliseconds: 2000,
    });
  });

  it("ruled on #253 Q7: a host's 0 waits 602 seconds for the probe and 600 for the tunnel", () => {
    deepStrictEqual(connectWaitsFor(600), {
      probeMilliseconds: 602000,
      tunnelMilliseconds: 600000,
    });
  });
});

describe("the window's waits on the shared connection's helper", () => {
  it('ruled on #253 Q8: the helper outlives its last window by 3 seconds', () => {
    deepStrictEqual(HELPER_GRACE_MILLISECONDS, 3000);
  });

  it('ruled on #253 Q8: a reply may take 10 s, and the login the default 17 s plus 10 s', () => {
    deepStrictEqual(connectionLimitsFor(undefined, undefined), {
      requestMilliseconds: 10000,
      loginMilliseconds: 27000,
    });
  });

  it("ruled on #253 Q8: the login wait follows the host's own timeout", () => {
    deepStrictEqual(connectionLimitsFor('9', 30).loginMilliseconds, 21000);
  });

  it("F-2105 BR-4: a host's 0 waits the ceiling plus the margin", () => {
    deepStrictEqual(connectionLimitsFor('0', 30).loginMilliseconds, 610000);
  });

  it("F-2105 AC-9: the setting's 0 waits the extra 2 s plus the margin", () => {
    deepStrictEqual(connectionLimitsFor(undefined, 0).loginMilliseconds, 12000);
  });
});

describe('the waits around the helper and the host lock', () => {
  it("ruled on #253 Q10: the client's hello 2 s, a started helper's listening 10 s, retries 100 ms apart", () => {
    deepStrictEqual(HELPER_CLIENT_WAITS, {
      helloLimitMilliseconds: 2000,
      startLimitMilliseconds: 10000,
      retryMilliseconds: 100,
    });
  });

  it('F-2408: the host lock is asked for 30 times', () => {
    deepStrictEqual(HOST_LOCK_ATTEMPTS, 30);
  });

  it('F-2408: one second apart', () => {
    deepStrictEqual(HOST_LOCK_INTERVAL_MILLISECONDS, 1000);
  });
});

describe("the shared session's run limits", () => {
  it('ruled on #253 Q10: a run may take the host download and the ready wait, and 5 minutes more (35.25 minutes)', () => {
    deepStrictEqual(SESSION_RUN_LIMITS.runDeadlineMilliseconds, 2_115_000);
  });

  it('ruled on #253 Q10: a caller waits one run more (40.25 minutes)', () => {
    deepStrictEqual(SESSION_RUN_LIMITS.runWaitMilliseconds, 2_415_000);
  });

  it('ruled on #253 Q10: the deadline is never shorter than the host download and the ready wait', () => {
    deepStrictEqual(
      SESSION_RUN_LIMITS.runDeadlineMilliseconds >
        (SERVER_BOUNDS.downloadSeconds + SERVER_BOUNDS.readySeconds) * 1000,
      true,
    );
  });

  it('ruled on #253 Q10: an input of 1 MiB at most goes through the shell', () => {
    deepStrictEqual(SESSION_RUN_LIMITS.maximumInputBytes, 1_048_576);
  });
});
