import {deepStrictEqual} from 'node:assert';
import {parseDefaultForwards} from 'lib-forwarding';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  applyDefaults,
  type TunnelOptions,
  type TunnelOpener,
} from '../../src/forwarding/default-forwards.ts';

/** An opener that records its calls and rejects the ones `failing` names by remote port. */
function opener(failing: readonly number[] = []) {
  const calls: TunnelOptions[] = [];
  const tunnels: TunnelOpener = {
    openTunnel: options => {
      calls.push(options);
      return failing.includes(options.remoteAddress.port)
        ? Promise.reject(
            new Error(`port ${String(options.remoteAddress.port)} is busy`),
          )
        : Promise.resolve({});
    },
  };
  return {calls, tunnels};
}

async function applied(setting: unknown, failing: readonly number[] = []) {
  const sink = new MemorySink();
  const {calls, tunnels} = opener(failing);
  await applyDefaults(
    parseDefaultForwards(setting),
    tunnels,
    createLogger(sink, {minimumLevel: () => 'info'}),
  );
  return {calls, lines: sink.lines.map(line => [line.level, line.message])};
}

describe('the default forwarded ports (card connect-40)', () => {
  it('F-2507.AC-2: an entry with a name and a local port is one tunnel with both', async () => {
    deepStrictEqual(
      (await applied([{name: 'web', remotePort: 8000, localPort: 18000}]))
        .calls,
      [
        {
          remoteAddress: {host: 'localhost', port: 8000},
          localAddressPort: 18000,
          label: 'web',
        },
      ],
    );
  });

  it('F-2507.AC-3: an entry with only a remote port listens on the same port and has no label', async () => {
    deepStrictEqual((await applied([{remotePort: 8001}])).calls, [
      {remoteAddress: {host: 'localhost', port: 8001}, localAddressPort: 8001},
    ]);
  });

  it('F-2507 7.E6: two entries for one remote port give one tunnel, the first entry’s', async () => {
    deepStrictEqual(
      (
        await applied([
          {remotePort: 8002, localPort: 18002},
          {remotePort: 8002, localPort: 28002},
        ])
      ).calls.map(call => call.localAddressPort),
      [18002],
    );
  });

  it('F-2507 7.E4: entries that are not usable are skipped with an info line naming their index', async () => {
    const {calls, lines} = await applied([
      {remotePort: 'x'},
      5,
      {remotePort: 8003},
    ]);
    deepStrictEqual(
      [calls.map(call => call.remoteAddress.port), lines],
      [
        [8003],
        [
          [
            'info',
            'defaultForwardedPorts entry 0 is skipped: invalidRemotePort',
          ],
          ['info', 'defaultForwardedPorts entry 1 is skipped: notAnObject'],
        ],
      ],
    );
  });

  it('F-2507 7.E4: a setting that is not a list forwards nothing and says so at info', async () => {
    const {calls, lines} = await applied('8000');
    deepStrictEqual(
      [calls, lines],
      [
        [],
        [
          [
            'info',
            'defaultForwardedPorts is not a list, so no port is forwarded',
          ],
        ],
      ],
    );
  });

  it('F-2507 W4: a forward that is rejected is logged at warn, the others are still opened, and the call resolves', async () => {
    const {calls, lines} = await applied(
      [{remotePort: 8000}, {remotePort: 8001}],
      [8000],
    );
    deepStrictEqual(
      [calls.map(call => call.remoteAddress.port), lines],
      [
        [8000, 8001],
        [
          [
            'warn',
            'the default forward of port 8000 did not open: port 8000 is busy',
          ],
        ],
      ],
    );
  });

  it('F-2507 W4: a rejection that is not an Error is logged as its text', async () => {
    const sink = new MemorySink();
    await applyDefaults(
      parseDefaultForwards([{remotePort: 8000}]),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a rejection that is not an Error
      {openTunnel: () => Promise.reject('plain')},
      createLogger(sink, {minimumLevel: () => 'info'}),
    );
    deepStrictEqual(
      sink.lines.map(line => line.message),
      ['the default forward of port 8000 did not open: plain'],
    );
  });

  it('F-2507 W4: the calls are all made before any of them settles', async () => {
    const started: number[] = [];
    const never = new Promise<void>(() => undefined);
    void applyDefaults(
      parseDefaultForwards([{remotePort: 8000}, {remotePort: 8001}]),
      {
        openTunnel: options => {
          started.push(options.remoteAddress.port);
          return never;
        },
      },
      createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    );
    await Promise.resolve();
    deepStrictEqual(started, [8000, 8001]);
  });

  it('F-2507.AC-6: nothing is shown: an empty setting makes no call and writes no line', async () => {
    deepStrictEqual(await applied([]), {calls: [], lines: []});
  });
});
