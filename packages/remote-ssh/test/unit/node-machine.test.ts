import {deepStrictEqual, match} from 'node:assert';
import {createServer} from 'node:net';
import {
  clientPlatformOf,
  clientSearchOf,
  drawLinkNumber,
  freeLoopbackPort,
  type MachinePlaces,
  newTemporaryToken,
  nodeFacts,
  nodeMachineOf,
} from '../../src/node-machine.ts';
import {PROFILE} from './server-steps.fixture.ts';

const PLACES: MachinePlaces = {
  extensionFolder: '/extensions/remote-oss.remote-ssh',
  storageFolder: '/storage/remote-oss.remote-ssh',
  runtime: '/editor/code',
  profile: PROFILE,
  httpGet: () => Promise.reject(new Error('no request in a unit test')),
};

const FACTS = {
  platform: 'linux',
  environment: {PATH: '/usr/bin', XDG_RUNTIME_DIR: '/run/user/1000'},
  homeFolder: '/home/alex',
  temporaryFolder: '/tmp',
  workingDirectory: '/work',
};

/** Whether a listener can bind `port` on the loopback. */
function bindable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

describe('the machine a connect runs on', () => {
  it('F-2101: macOS is the client platform of darwin', () => {
    deepStrictEqual(clientPlatformOf('darwin'), 'macOS');
  });

  it('F-2101: Windows is the client platform of win32', () => {
    deepStrictEqual(clientPlatformOf('win32'), 'windows');
  });

  it('F-2101: any other platform is Linux', () => {
    deepStrictEqual(
      ['linux', 'freebsd'].map(platform => clientPlatformOf(platform)),
      ['linux', 'linux'],
    );
  });

  it('F-2101: the client search reads PATH and ProgramFiles', () => {
    deepStrictEqual(
      clientSearchOf({PATH: '/usr/bin', ProgramFiles: 'C:\\Program Files'}),
      {searchPath: '/usr/bin', programFilesFolder: 'C:\\Program Files'},
    );
  });

  it("F-2101: Windows' Path is read when PATH is absent", () => {
    deepStrictEqual(
      clientSearchOf({Path: 'C:\\Windows'}).searchPath,
      'C:\\Windows',
    );
  });

  it('F-2101: no search path is the empty one', () => {
    deepStrictEqual(clientSearchOf({}), {
      searchPath: '',
      programFilesFolder: '',
    });
  });

  it("contracts §S9: the helper's SOCKS port is free on the loopback once released", async () => {
    deepStrictEqual(await bindable(await freeLoopbackPort()), true);
  });

  it('F-2311 R2: an agent link number is an integer in 1..999999999', () => {
    const draws = Array.from({length: 200}, () => drawLinkNumber());
    deepStrictEqual(
      draws.every(
        draw => Number.isInteger(draw) && draw >= 1 && draw <= 999_999_999,
      ),
      true,
    );
  });

  it("F-2311 R2: the machine's draw is the link number's", () => {
    deepStrictEqual(
      nodeMachineOf(PLACES, FACTS).drawLinkNumber,
      drawLinkNumber,
    );
  });

  it('contracts: two temporary tokens differ', () => {
    deepStrictEqual(newTemporaryToken() === newTemporaryToken(), false);
  });

  it('contracts: a temporary token names this process', () => {
    match(
      newTemporaryToken(),
      new RegExp(`^${String(process.pid)}-[0-9a-f]{12}$`),
    );
  });

  it("ruled on #253 Q8: the helper and askpass are the extension's bundles, run by the editor", () => {
    deepStrictEqual(nodeMachineOf(PLACES, FACTS).bundles, {
      helperScript:
        '/extensions/remote-oss.remote-ssh/dist/connection-helper.js',
      askpassProgram: '/extensions/remote-oss.remote-ssh/dist/askpass.js',
      runtime: '/editor/code',
    });
  });

  it("contracts §9: the registry is in the profile's storage, the endpoints in the user's runtime folder", () => {
    deepStrictEqual(nodeMachineOf(PLACES, FACTS).folders, {
      registry: '/storage/remote-oss.remote-ssh/registry',
      runtime: '/run/user/1000',
      clientTemporary: '/tmp',
    });
  });

  it('ruled on #253 Q10: the helper client waits 2 s for a hello, 10 s for a start, 100 ms between tries', () => {
    const {helpers} = nodeMachineOf(PLACES, FACTS);
    deepStrictEqual(
      [
        helpers.helloLimitMilliseconds,
        helpers.startLimitMilliseconds,
        helpers.retryMilliseconds,
        helpers.runtime,
      ],
      [2000, 10000, 100, '/editor/code'],
    );
  });

  it('connect-14: the platform, home and client search come from the facts', () => {
    const machine = nodeMachineOf(PLACES, {...FACTS, platform: 'darwin'});
    deepStrictEqual(
      [machine.platform, machine.homeFolder, machine.clientSearch.searchPath],
      ['macOS', '/home/alex', '/usr/bin'],
    );
  });

  it('connect-14: the scheduler and the clock wait on real time', async () => {
    const machine = nodeMachineOf(PLACES, FACTS);
    const fired = await new Promise<boolean>(resolve => {
      machine.scheduler.setTimer(1, () => {
        resolve(true);
      });
    });
    await machine.clock.wait(1);
    deepStrictEqual([fired, machine.clock.now() > 0], [true, true]);
  });

  it("connect-14: the facts are this process's", () => {
    const facts = nodeFacts();
    deepStrictEqual(
      [facts.platform, facts.environment === process.env],
      [process.platform, true],
    );
  });
});
