import {deepStrictEqual} from 'node:assert';
import {
  findFreePort,
  type FindOptions,
  type PortRange,
} from '../../src/index.ts';
import {FakeProber} from '../../src/testing/fake-prober.ts';

const RANGE: PortRange = {first: 40000, last: 40002};

/** A clock that reads 0 ms before the first probe, then 500 ms per probe already run. */
function clockAdvancingPerProbe(stepMilliseconds: number): () => number {
  let reads = 0;
  return () => {
    reads += 1;
    return reads <= 2 ? 0 : (reads - 2) * stepMilliseconds;
  };
}

describe('findFreePort (card forwarding-01 table)', () => {
  it('range 40000-40002, 40000 open, 40001 refused -> port 40001; 40002 never probed', async () => {
    const prober = new FakeProber({40000: 'open', 40001: 'refused'});
    const outcome = await findFreePort(prober, RANGE);
    deepStrictEqual([outcome, prober.probed], [{port: 40001}, [40000, 40001]]);
  });

  it('range 40000-40002, all open -> noFreePort; three probes', async () => {
    const prober = new FakeProber({
      40000: 'open',
      40001: 'open',
      40002: 'open',
    });
    const outcome = await findFreePort(prober, RANGE);
    deepStrictEqual(
      [outcome, prober.probed],
      [{failure: 'noFreePort'}, [40000, 40001, 40002]],
    );
  });

  it('range 40000-40002, first error then refused -> port 40001', async () => {
    const prober = new FakeProber({40000: 'error', 40001: 'refused'});
    const outcome = await findFreePort(prober, RANGE);
    deepStrictEqual([outcome, prober.probed], [{port: 40001}, [40000, 40001]]);
  });

  it('range 40000-40100, each probe advances the clock 500 ms, budget 3000 -> stops after six probes', async () => {
    const prober = new FakeProber({});
    const options: FindOptions = {
      timeBudgetMilliseconds: 3000,
      now: clockAdvancingPerProbe(500),
      randomPort: () => 50000,
    };
    const outcome = await findFreePort(
      prober,
      {first: 40000, last: 40100},
      options,
    );
    deepStrictEqual(
      [outcome, prober.probed.length],
      [{failure: 'noFreePort'}, 6],
    );
  });

  it('no range, random sequence [50000 open, 50001 refused] -> port 50001', async () => {
    const prober = new FakeProber({50000: 'open', 50001: 'refused'});
    const sequence = [50000, 50001];
    let index = 0;
    const options: FindOptions = {
      timeBudgetMilliseconds: 3000,
      now: () => 0,
      randomPort: () => sequence[index++] ?? 59999,
    };
    const outcome = await findFreePort(prober, undefined, options);
    deepStrictEqual([outcome, prober.probed], [{port: 50001}, [50000, 50001]]);
  });

  it('no range, ten opens -> noFreePort; exactly ten probes', async () => {
    const prober = new FakeProber({});
    const options: FindOptions = {
      timeBudgetMilliseconds: 3000,
      now: () => 0,
      randomPort: () => 51000,
    };
    const outcome = await findFreePort(prober, undefined, options);
    deepStrictEqual(
      [
        outcome,
        prober.probed.length,
        prober.probed.every(port => port === 51000),
      ],
      [{failure: 'noFreePort'}, 10, true],
    );
  });

  it('no range, default randomPort -> a port within 49152-65535, one of 100 calls', async () => {
    const prober = {probe: () => Promise.resolve('refused' as const)};
    const options: FindOptions = {timeBudgetMilliseconds: 3000, now: () => 0};
    const ports: number[] = [];
    for (let call = 0; call < 100; call += 1) {
      const outcome = await findFreePort(prober, undefined, options);
      if ('port' in outcome) {
        ports.push(outcome.port);
      }
    }
    deepStrictEqual(
      [ports.length, ports.every(port => port >= 49152 && port <= 65535)],
      [100, true],
    );
  });

  it('FakeProber takes a map port -> answer and records the probed ports in order', async () => {
    const prober = new FakeProber({7000: 'refused'});
    const answers = await Promise.all(
      [7000, 7001, 7002].map(port => prober.probe(port)),
    );
    deepStrictEqual(
      [answers, prober.probed],
      [
        ['refused', 'open', 'open'],
        [7000, 7001, 7002],
      ],
    );
  });

  it('no range with an exhausted clock before the first probe -> noFreePort, no probes', async () => {
    const prober = new FakeProber({});
    const options: FindOptions = {
      timeBudgetMilliseconds: 0,
      now: () => 100,
      randomPort: () => 50000,
    };
    const outcome = await findFreePort(prober, undefined, options);
    deepStrictEqual([outcome, prober.probed], [{failure: 'noFreePort'}, []]);
  });
});
