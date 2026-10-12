import {deepStrictEqual} from 'node:assert';
import {
  openWebUiHandler,
  type WebUiPorts,
} from '../../src/surfaces/web-ui-command.ts';

interface FakePorts extends WebUiPorts {
  port: number | 'none';
  opened: string[];
}

function fakePorts(
  port: number | 'none',
  openExternal: (address: string) => Promise<boolean> = () =>
    Promise.resolve(true),
): FakePorts {
  const fake: FakePorts = {
    port,
    opened: [],
    serverPort: () => fake.port,
    openExternal: address => {
      fake.opened.push(address);
      return openExternal(address);
    },
  };
  return fake;
}

describe('openWebUiHandler (card remote-ssh-16 table)', () => {
  it('F-2509 BR-5: opens the address of the server port', async () => {
    const ports = fakePorts(38123);
    await openWebUiHandler(ports).execute();
    deepStrictEqual(ports.opened, ['http://localhost:38123/']);
  });

  it('F-2509 BR-5: arguments do not change the address', async () => {
    const ports = fakePorts(38123);
    await openWebUiHandler(ports).execute('x', 1);
    deepStrictEqual(ports.opened, ['http://localhost:38123/']);
  });

  it('F-2509 AC-19: opens nothing while no server is known', async () => {
    const ports = fakePorts('none');
    await openWebUiHandler(ports).execute();
    deepStrictEqual(ports.opened, []);
  });

  it('F-2509 AC-13: resolves undefined while no server is known', async () => {
    deepStrictEqual(
      await openWebUiHandler(fakePorts('none')).execute(),
      undefined,
    );
  });

  it('F-2509 AC-20: a new server after a reconnection gives the new port', async () => {
    const ports = fakePorts(38123);
    const handler = openWebUiHandler(ports);
    await handler.execute();
    ports.port = 40001;
    await handler.execute();
    deepStrictEqual(ports.opened, [
      'http://localhost:38123/',
      'http://localhost:40001/',
    ]);
  });

  it('F-2509 BR-6: a browser that fails does not reject the command', async () => {
    const ports = fakePorts(38123, () => Promise.reject(new Error('no')));
    deepStrictEqual(await openWebUiHandler(ports).execute(), undefined);
  });

  it('F-2509 BR-6: a user who declines does not change the result', async () => {
    const ports = fakePorts(38123, () => Promise.resolve(false));
    deepStrictEqual(await openWebUiHandler(ports).execute(), undefined);
  });

  it('F-2509 BR-6: running twice opens the same address twice', async () => {
    const ports = fakePorts(38123);
    const handler = openWebUiHandler(ports);
    await handler.execute();
    await handler.execute();
    deepStrictEqual(ports.opened, [
      'http://localhost:38123/',
      'http://localhost:38123/',
    ]);
  });

  it('F-2509 BR-8: the handler has no availability check', () => {
    deepStrictEqual('isAvailable' in openWebUiHandler(fakePorts(38123)), false);
  });
});
