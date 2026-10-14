import {deepStrictEqual, rejects} from 'node:assert';
import {execDialer} from '../../src/exec/exec-dialer.ts';
import {dialArguments} from '../../src/exec/exec-arguments.ts';
import {fakeEngine, type ProcessScript} from './fake-engine.ts';

function dialer(...scripts: Array<ProcessScript | {failure: string}>) {
  const engine = fakeEngine(...scripts);
  return {
    engine,
    dialer: execDialer(engine, 'c1', 'node', '/srv/node', '/d/relay-abc.js'),
  };
}

/** Waits for the stream events to be told. */
function settle(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('the exec dialer (card containers-02)', () => {
  it('dialer: a socket target is refused and nothing spawns', async () => {
    const {engine, dialer: each} = dialer();
    const refused = await each.dial({kind: 'socket', path: '/x'}).then(
      () => 'dialed',
      (caught: unknown) => (caught instanceof Error ? caught.message : 'other'),
    );
    deepStrictEqual(
      [refused, engine.processes.length],
      ['a socket target is not available in a container', 0],
    );
  });

  it('dialer: a port target spawns the relay, holds what came first for the first listener, and sends to stdin', async () => {
    const {engine, dialer: each} = dialer(process => {
      process.print('abc');
    });
    const duplex = await each.dial({kind: 'port', port: 41000});
    await settle();
    const heard: string[] = [];
    duplex.onData(chunk => heard.push(Buffer.from(chunk).toString()));
    duplex.send(Buffer.from('out'));
    await settle();
    const [spawned] = engine.processes;
    deepStrictEqual(
      [spawned?.argv, heard, spawned?.stdin().toString()],
      [
        dialArguments('c1', 'node', '/srv/node', '/d/relay-abc.js', 41000),
        ['abc'],
        'out',
      ],
    );
  });

  it('dialer: when the process exits the close is told once, and to a listener added later', async () => {
    const {dialer: each} = dialer(process => {
      process.exit(0);
    });
    const duplex = await each.dial({kind: 'port', port: 1});
    const told: string[] = [];
    duplex.onClose(() => told.push('first'));
    await settle();
    await settle();
    duplex.onClose(() => told.push('later'));
    await settle();
    deepStrictEqual(told, ['first', 'later']);
  });

  it('dialer: closing ends stdin and kills the process', async () => {
    const {engine, dialer: each} = dialer();
    const duplex = await each.dial({kind: 'port', port: 1});
    duplex.close();
    await engine.processes[0]?.stdinEnded;
    deepStrictEqual(engine.processes[0]?.killed, true);
  });

  it('dialer: a spawn that fails rejects the dial with its detail', async () => {
    const {dialer: each} = dialer({failure: 'spawn docker ENOENT'});
    await rejects(each.dial({kind: 'port', port: 1}), {
      message: 'spawn docker ENOENT',
    });
  });
});
