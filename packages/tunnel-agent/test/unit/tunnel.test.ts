import {deepStrictEqual} from 'node:assert';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {CONTROL_PORT, RelayError} from '../../src/relay.ts';
import {readTunnelRecord, writeTunnelRecord} from '../../src/state.ts';
import {
  registeredTunnel,
  renameTunnel,
  tunnelNameOf,
  unregisterTunnel,
} from '../../src/tunnel.ts';
import {worldOf} from './tunnel.fixture.ts';

describe('the name of a first tunnel', () => {
  it('is the host name by the relay’s rule: lower case, letters, digits and hyphens, 3 to 49 characters', () => {
    deepStrictEqual(
      [
        'Dev-Box',
        'my_laptop.local',
        '--edge--',
        'a'.repeat(60),
        `${'b'.repeat(48)}-c`,
        'ab',
        '___',
        '',
      ].map(tunnelNameOf),
      [
        'dev-box',
        'my-laptop-local',
        'edge',
        'a'.repeat(49),
        'b'.repeat(48),
        'my-machine',
        'my-machine',
        'my-machine',
      ],
    );
  });
});

describe('the commands over the machine’s tunnel', () => {
  let world = worldOf();
  const context = {
    get service() {
      return world.relay;
    },
    get folder() {
      return world.folder;
    },
    hostName: 'Dev-Box',
    report: (line: string) => {
      world.said.push(line);
    },
  };

  beforeEach(() => {
    world = worldOf();
  });

  afterEach(() => {
    world.end();
  });

  describe('the machine’s tunnel on the relay', () => {
    it('a first start creates a tunnel named for the machine, keeps its record, and gives it the control port', async () => {
      const tunnel = await registeredTunnel(context, undefined);
      deepStrictEqual(
        [tunnel, readTunnelRecord(world.folder), world.relay.calls],
        [
          {
            tunnelId: 'tunnel1',
            clusterId: 'cluster',
            name: 'dev-box',
            ports: [CONTROL_PORT],
          },
          {tunnelId: 'tunnel1', clusterId: 'cluster', name: 'dev-box'},
          ['create dev-box', `addPort tunnel1 ${String(CONTROL_PORT)}`],
        ],
      );
    });

    it('a first start takes the name it is asked for', async () => {
      const tunnel = await registeredTunnel(context, 'my-box');
      deepStrictEqual(tunnel?.name, 'my-box');
    });

    it('a later start finds its tunnel by the stored ids and creates nothing', async () => {
      await registeredTunnel(context, undefined);
      world.relay.calls.length = 0;
      const tunnel = await registeredTunnel(context, undefined);
      deepStrictEqual(
        [tunnel?.tunnelId, world.relay.calls, world.said],
        ['tunnel1', ['get tunnel1'], []],
      );
    });

    it('a later start gives a tunnel that lacks the control port its port', async () => {
      await registeredTunnel(context, undefined);
      world.relay.tunnels.set('tunnel1', {
        tunnelId: 'tunnel1',
        clusterId: 'cluster',
        name: 'dev-box',
        ports: [],
      });
      world.relay.calls.length = 0;
      const tunnel = await registeredTunnel(context, undefined);
      deepStrictEqual(
        [tunnel?.ports, world.relay.calls],
        [
          [CONTROL_PORT],
          ['get tunnel1', `addPort tunnel1 ${String(CONTROL_PORT)}`],
        ],
      );
    });

    it('a start that failed after the create finds the tunnel again and gives it its port: nothing leaks against the relay’s limit', async () => {
      world.relay.failures.set(
        'addPort',
        new RelayError(500, 'the relay failed'),
      );
      const first = await registeredTunnel(context, undefined);
      world.relay.failures.clear();
      const second = await registeredTunnel(context, undefined);
      deepStrictEqual(
        [
          first,
          world.said,
          [...world.relay.tunnels.keys()],
          second?.tunnelId,
          second?.ports,
        ],
        [
          undefined,
          ['the relay failed'],
          ['tunnel1'],
          'tunnel1',
          [CONTROL_PORT],
        ],
      );
    });

    it('a tunnel the relay no longer holds is created anew, under a new id and the stored name, and the record is overwritten', async () => {
      await registeredTunnel(context, 'my-box');
      world.relay.tunnels.clear();
      const tunnel = await registeredTunnel(context, undefined);
      deepStrictEqual(
        [tunnel?.tunnelId, tunnel?.name, readTunnelRecord(world.folder)],
        [
          'tunnel2',
          'my-box',
          {tunnelId: 'tunnel2', clusterId: 'cluster', name: 'my-box'},
        ],
      );
    });

    it('any other refusal of the relay stops the run with its own words and leaves the record as it was', async () => {
      await registeredTunnel(context, undefined);
      world.relay.failures.set(
        'get',
        new RelayError(401, 'Sign in with a GitHub account.'),
      );
      const tunnel = await registeredTunnel(context, undefined);
      deepStrictEqual(
        [
          tunnel,
          world.said,
          readTunnelRecord(world.folder)?.tunnelId,
          world.relay.calls.filter(call => call.startsWith('create')),
        ],
        [
          undefined,
          ['Sign in with a GitHub account.'],
          'tunnel1',
          ['create dev-box'],
        ],
      );
    });

    it('a refusal of the create, such as a name the account has taken, leaves no record', async () => {
      world.relay.failures.set(
        'create',
        new RelayError(409, 'The tunnel name is taken.'),
      );
      const tunnel = await registeredTunnel(context, undefined);
      deepStrictEqual(
        [tunnel, world.said, readTunnelRecord(world.folder)],
        [undefined, ['The tunnel name is taken.'], undefined],
      );
    });

    it('a failure that is no refusal of the relay is not told away', async () => {
      world.relay.failures.set('get', new TypeError('a defect'));
      await registeredTunnel(context, undefined).catch(() => undefined);
      world.relay.failures.clear();
      const record = {tunnelId: 'tunnel9', clusterId: 'cluster', name: 'x-box'};
      writeTunnelRecord(world.folder, record);
      world.relay.failures.set('get', new TypeError('a defect'));
      deepStrictEqual(
        await registeredTunnel(context, undefined).then(
          () => 'told away',
          (caught: unknown) => (caught as Error).message,
        ),
        'a defect',
      );
    });

    it('a later start with another name leaves the name alone and says how to rename it, once', async () => {
      await registeredTunnel(context, undefined);
      const other = await registeredTunnel(context, 'another');
      const same = await registeredTunnel(context, 'dev-box');
      deepStrictEqual(
        [
          other?.name,
          same?.name,
          world.said,
          readTunnelRecord(world.folder)?.name,
        ],
        [
          'dev-box',
          'dev-box',
          [
            'the tunnel is named dev-box; tunnel-agent rename another changes it',
          ],
          'dev-box',
        ],
      );
    });
  });

  describe('the rename and the unregister of the machine’s tunnel', () => {
    it('with no tunnel registered both say so, and fail', async () => {
      deepStrictEqual(
        [
          await renameTunnel(context, 'new-name'),
          await unregisterTunnel(context),
          world.said,
          world.relay.calls,
        ],
        [
          1,
          1,
          [
            'no tunnel is registered on this machine',
            'no tunnel is registered on this machine',
          ],
          [],
        ],
      );
    });

    it('a rename keeps the tunnel’s id and changes its name on the relay and in the record', async () => {
      await registeredTunnel(context, 'old-name');
      const status = await renameTunnel(context, 'new-name');
      deepStrictEqual(
        [
          status,
          readTunnelRecord(world.folder),
          world.relay.tunnels.get('tunnel1')?.name,
          world.said,
        ],
        [
          0,
          {tunnelId: 'tunnel1', clusterId: 'cluster', name: 'new-name'},
          'new-name',
          ['the tunnel is named new-name'],
        ],
      );
    });

    it('a rename the relay refuses fails with the relay’s words and leaves the record', async () => {
      await registeredTunnel(context, 'old-name');
      world.relay.failures.set(
        'rename',
        new RelayError(400, 'The tunnel name is not valid.'),
      );
      deepStrictEqual(
        [
          await renameTunnel(context, 'No'),
          readTunnelRecord(world.folder)?.name,
          world.said,
        ],
        [1, 'old-name', ['The tunnel name is not valid.']],
      );
    });

    it('an unregister deletes the tunnel on the relay and forgets the record', async () => {
      await registeredTunnel(context, undefined);
      const status = await unregisterTunnel(context);
      deepStrictEqual(
        [
          status,
          world.relay.tunnels.size,
          existsSync(path.join(world.folder, 'tunnel.json')),
          world.said,
        ],
        [0, 0, false, ['the tunnel is unregistered']],
      );
    });

    it('an unregister of a tunnel the relay no longer holds still forgets the record', async () => {
      await registeredTunnel(context, undefined);
      world.relay.tunnels.clear();
      deepStrictEqual(
        [await unregisterTunnel(context), readTunnelRecord(world.folder)],
        [0, undefined],
      );
    });

    it('an unregister the relay refuses fails with the relay’s words and keeps the record', async () => {
      await registeredTunnel(context, undefined);
      world.relay.failures.set(
        'delete',
        new RelayError(403, 'The tunnel is not yours.'),
      );
      deepStrictEqual(
        [
          await unregisterTunnel(context),
          readTunnelRecord(world.folder)?.tunnelId,
          world.said,
        ],
        [1, 'tunnel1', ['The tunnel is not yours.']],
      );
    });
  });
});
