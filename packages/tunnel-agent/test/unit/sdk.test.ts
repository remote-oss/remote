import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {RelayTunnel} from '../../src/relay.ts';
import {relayOf} from '../../src/sdk.ts';
import {stateFolderOf, writeStateFile} from '../../src/state.ts';

const TUNNEL: RelayTunnel = {
  tunnelId: 'tunnel1',
  clusterId: 'cluster',
  name: 'dev-box',
  ports: [],
};

describe('the host leg over the SDK, before it reaches the relay', () => {
  let folder = '';
  let home = '';

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'agent-sdk-'));
    folder = stateFolderOf(home);
  });

  afterEach(() => {
    rmSync(home, {recursive: true, force: true});
  });

  /** The leg of a relay that nothing answers, over the state folder of the row. */
  function legOnNoRelay() {
    return relayOf('relay.invalid', 'a-token', folder, () => undefined).hostLeg;
  }

  it('a leg whose stop came already ends as stopped at once, without making a host key or asking the relay', async () => {
    const stopped = new AbortController();
    stopped.abort();
    const end = await legOnNoRelay().hold(TUNNEL, stopped.signal);
    deepStrictEqual(
      [end, existsSync(path.join(folder, 'host-key'))],
      [{kind: 'stopped'}, false],
    );
  });

  it('a host key file that cannot be read ends the leg with a named reason before the relay is asked, and rejects nothing', async () => {
    writeStateFile(folder, 'host-key', '{not json');
    const end = await legOnNoRelay().hold(TUNNEL, new AbortController().signal);
    deepStrictEqual(
      end.kind === 'ended' &&
        end.reason.startsWith('the host key could not be read: '),
      true,
    );
  });
});
