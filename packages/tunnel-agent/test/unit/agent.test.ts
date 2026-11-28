import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {type AgentRun, agentHandlers} from '../../src/agent.ts';
import {ConfigError} from '../../src/config.ts';
import {RelayError} from '../../src/relay.ts';
import type {HostEnd} from '../../src/serve.ts';
import {
  readTunnelRecord,
  stateFolderOf,
  writeStateFile,
} from '../../src/state.ts';
import {MemoryRelay} from './tunnel.fixture.ts';

/** A run of the agent over a relay in memory, in a home folder of its own. */
function runOf(
  end: HostEnd = {kind: 'stopped'},
  stop: AbortSignal = new AbortController().signal,
) {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-run-'));
  const relay = new MemoryRelay();
  const said: string[] = [];
  const connected: string[] = [];
  const held: number[] = [];
  const shipped = {read: (): string => 'relay.example'};
  const agentRun: AgentRun = {
    folder: stateFolderOf(home),
    hostName: 'Dev-Box',
    domain: () => shipped.read(),
    connect: (relayDomain, token) => {
      connected.push(`${relayDomain} ${token}`);
      return {
        service: relay,
        hostLeg: {
          hold: () => {
            held.push(1);
            return Promise.resolve(end);
          },
        },
      };
    },
    stop,
    report: line => {
      said.push(line);
    },
  };
  return {
    agentRun,
    relay,
    said,
    connected,
    held,
    handlers: agentHandlers(agentRun),
    signIn: (token: string) => {
      writeStateFile(agentRun.folder, 'credential', token);
    },
    useDomain: (read: () => string) => {
      shipped.read = read;
    },
    end: () => {
      rmSync(home, {recursive: true, force: true});
    },
  };
}

describe('the agent’s tunnel commands', () => {
  let world = runOf();

  beforeEach(() => {
    world = runOf();
  });

  afterEach(() => {
    world.end();
  });

  it('every one of them needs the sign-in, and says to run login when there is none or it is empty, before the relay is asked', async () => {
    const first = await Promise.all([
      world.handlers.start?.(undefined),
      world.handlers.rename?.('new-name'),
      world.handlers.unregister?.(),
    ]);
    world.signIn('  \n');
    const second = await world.handlers.start?.(undefined);
    deepStrictEqual(
      [first, second, world.said.length, world.connected, world.relay.calls],
      [[1, 1, 1], 1, 4, [], []],
    );
  });

  it('every one of them says why when the shipped defaults are unusable, naming the file, and fails', async () => {
    world.signIn('the-token');
    world.useDomain(() => {
      throw new ConfigError('/agent/config.json has no domain');
    });
    deepStrictEqual(
      [await world.handlers.start?.(undefined), world.said, world.connected],
      [1, ['/agent/config.json has no domain'], []],
    );
  });

  it('a defect in reading the defaults is not told away', async () => {
    world.signIn('the-token');
    world.useDomain(() => {
      throw new TypeError('a defect');
    });
    deepStrictEqual(
      await world.handlers.start?.(undefined).then(
        () => 'told away',
        (caught: unknown) => (caught as Error).message,
      ),
      'a defect',
    );
  });

  it('a start registers the tunnel with the stored token at the shipped domain, serves it, and ends with the leg’s status', async () => {
    world.signIn('the-token\n');
    const status = await world.handlers.start?.('my-box');
    deepStrictEqual(
      [status, world.connected, readTunnelRecord(world.agentRun.folder)?.name],
      [0, ['relay.example the-token'], 'my-box'],
    );
  });

  it('a start ends with status 1 and serves nothing when the relay refuses the registration, saying why', async () => {
    world.signIn('the-token');
    world.relay.failures.set(
      'create',
      new RelayError(409, 'The tunnel name is taken.'),
    );
    deepStrictEqual(
      [await world.handlers.start?.(undefined), world.said],
      [1, ['The tunnel name is taken.']],
    );
  });

  it('a stop before the leg starts, whether it came before the start or while the tunnel was being registered, ends the run with status 0 and never holds the leg', async () => {
    const before = new AbortController();
    before.abort();
    const early = runOf({kind: 'ended', reason: 'gone'}, before.signal);
    early.signIn('the-token');
    const during = new AbortController();
    const late = runOf({kind: 'ended', reason: 'gone'}, during.signal);
    late.signIn('the-token');
    const create = late.relay.create.bind(late.relay);
    late.relay.create = name => {
      during.abort();
      return create(name);
    };
    deepStrictEqual(
      [
        await early.handlers.start?.(undefined),
        early.held,
        await late.handlers.start?.(undefined),
        late.held,
      ],
      [0, [], 0, []],
    );
    early.end();
    late.end();
  });

  it('a start whose leg ended for good ends with status 1', async () => {
    const ending = runOf({kind: 'ended', reason: 'gone'});
    ending.signIn('the-token');
    const status = await ending.handlers.start?.(undefined);
    deepStrictEqual([status, ending.said], [1, ['the host leg ended: gone']]);
    ending.end();
  });

  it('a rename and an unregister act on the registered tunnel over the same sign-in', async () => {
    world.signIn('the-token');
    await world.handlers.start?.('old-name');
    const renamed = await world.handlers.rename?.('new-name');
    const unregistered = await world.handlers.unregister?.();
    deepStrictEqual(
      [
        renamed,
        unregistered,
        world.relay.tunnels.size,
        readTunnelRecord(world.agentRun.folder),
      ],
      [0, 0, 0, undefined],
    );
  });
});
