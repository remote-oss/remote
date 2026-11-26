import {deepStrictEqual, throws} from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../../src/store.ts';

describe('the store of the relay', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('writes, reads and replaces a tunnel, whose generation stays the one it was created with', () => {
    store.putTunnel({
      id: 'one',
      owner: 7,
      name: 'web',
      generation: 'g1',
      fields: {alpha: 1},
    });
    store.putTunnel({
      id: 'one',
      owner: 7,
      name: 'api',
      generation: 'g2',
      fields: {beta: 2},
    });
    deepStrictEqual(
      [store.tunnelById('one'), store.tunnelById('two')],
      [
        {id: 'one', owner: 7, name: 'api', generation: 'g1', fields: {beta: 2}},
        undefined,
      ],
    );
  });

  it("finds a tunnel by its owner's name, never by another owner's or by the empty name", () => {
    store.putTunnel({
      id: 'one',
      owner: 7,
      name: 'web',
      generation: 'g1',
      fields: {},
    });
    store.putTunnel({
      id: 'two',
      owner: 7,
      name: '',
      generation: 'g1',
      fields: {},
    });
    deepStrictEqual(
      [
        store.tunnelByName(7, 'web')?.id,
        store.tunnelByName(8, 'web'),
        store.tunnelByName(7, ''),
      ],
      ['one', undefined, undefined],
    );
  });

  it('refuses a second tunnel of the same owner with the same name, and allows unnamed ones', () => {
    store.putTunnel({
      id: 'one',
      owner: 7,
      name: 'web',
      generation: 'g1',
      fields: {},
    });
    store.putTunnel({
      id: 'three',
      owner: 7,
      name: '',
      generation: 'g1',
      fields: {},
    });
    store.putTunnel({
      id: 'four',
      owner: 7,
      name: '',
      generation: 'g1',
      fields: {},
    });
    store.putTunnel({
      id: 'five',
      owner: 8,
      name: 'web',
      generation: 'g1',
      fields: {},
    });
    throws(() => {
      store.putTunnel({
        id: 'two',
        owner: 7,
        name: 'web',
        generation: 'g1',
        fields: {},
      });
    });
  });

  it("lists an owner's tunnels by id", () => {
    store.putTunnel({
      id: 'bbb',
      owner: 7,
      name: '',
      generation: 'g1',
      fields: {},
    });
    store.putTunnel({
      id: 'aaa',
      owner: 7,
      name: '',
      generation: 'g1',
      fields: {},
    });
    store.putTunnel({
      id: 'ccc',
      owner: 8,
      name: '',
      generation: 'g1',
      fields: {},
    });
    deepStrictEqual(
      store.tunnelsOf(7).map(tunnel => tunnel.id),
      ['aaa', 'bbb'],
    );
  });

  it('deleting a tunnel deletes its ports and endpoints, and says whether there was one', () => {
    store.putTunnel({
      id: 'one',
      owner: 7,
      name: '',
      generation: 'g1',
      fields: {},
    });
    store.putPort('one', 80, {portNumber: 80});
    store.putEndpoint('one', 'h-relay', {id: 'h-relay'});
    deepStrictEqual(
      [
        store.deleteTunnel('one'),
        store.deleteTunnel('one'),
        store.portsOf('one'),
        store.endpointsOf('one'),
      ],
      [true, false, [], []],
    );
  });

  it('writes, replaces, lists and deletes ports by number', () => {
    store.putTunnel({
      id: 'one',
      owner: 7,
      name: '',
      generation: 'g1',
      fields: {},
    });
    store.putPort('one', 443, {portNumber: 443});
    store.putPort('one', 80, {portNumber: 80, protocol: 'http'});
    store.putPort('one', 80, {portNumber: 80, protocol: 'auto'});
    deepStrictEqual(
      [
        store.portsOf('one'),
        store.port('one', 80),
        store.port('one', 81),
        store.deletePort('one', 80),
        store.deletePort('one', 80),
      ],
      [
        [{portNumber: 80, protocol: 'auto'}, {portNumber: 443}],
        {portNumber: 80, protocol: 'auto'},
        undefined,
        true,
        false,
      ],
    );
  });

  it('writes, replaces, lists and deletes endpoints by id', () => {
    store.putTunnel({
      id: 'one',
      owner: 7,
      name: '',
      generation: 'g1',
      fields: {},
    });
    store.putEndpoint('one', 'b', {id: 'b'});
    store.putEndpoint('one', 'a', {id: 'a', hostId: 'x'});
    store.putEndpoint('one', 'a', {id: 'a', hostId: 'y'});
    deepStrictEqual(
      [
        store.endpointsOf('one'),
        store.deleteEndpoint('one', 'a'),
        store.deleteEndpoint('one', 'a'),
      ],
      [[{id: 'a', hostId: 'y'}, {id: 'b'}], true, false],
    );
  });

  it('a transaction commits what its work wrote, and rolls back all of it when the work throws', () => {
    store.transaction(() => {
      store.putTunnel({
        id: 'kept',
        owner: 7,
        name: '',
        generation: 'g1',
        fields: {},
      });
    });
    let thrown = '';
    try {
      store.transaction(() => {
        store.putTunnel({
          id: 'lost',
          owner: 7,
          name: '',
          generation: 'g1',
          fields: {},
        });
        throw new Error('stop');
      });
    } catch (error) {
      thrown = (error as Error).message;
    }
    deepStrictEqual(
      [thrown, store.tunnelById('kept')?.id, store.tunnelById('lost')],
      ['stop', 'kept', undefined],
    );
  });

  it('keeps its tunnels in its file across a reopening', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'relay-store-'));
    try {
      const file = path.join(folder, 'relay.db');
      const first = new Store(file);
      first.putTunnel({
        id: 'one',
        owner: 7,
        name: 'web',
        generation: 'g1',
        fields: {alpha: 1},
      });
      first.close();
      const second = new Store(file);
      deepStrictEqual(second.tunnelById('one'), {
        id: 'one',
        owner: 7,
        name: 'web',
        generation: 'g1',
        fields: {alpha: 1},
      });
      second.close();
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
