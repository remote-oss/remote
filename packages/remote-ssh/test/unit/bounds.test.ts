import {deepStrictEqual} from 'node:assert';
import {
  CLIENT_CHECK_MILLISECONDS,
  effectiveConnectTimeoutSeconds,
  PRECONNECT_MILLISECONDS,
  SERVER_BOUNDS,
  connectWaitsFor,
} from '../../src/pipeline/bounds.ts';

describe('the connect bounds', () => {
  it('F-2403 AC-24: half an hour for the host download, a minute for the server to listen', () => {
    deepStrictEqual(SERVER_BOUNDS, {downloadSeconds: 1800, readySeconds: 60});
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
