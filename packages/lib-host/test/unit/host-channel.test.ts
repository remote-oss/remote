import {deepStrictEqual} from 'node:assert';
import {failFrom, hostPathOf, type HostChannel} from '../../src/index.ts';
import {RecordingChannel} from '../../src/testing/recording-channel.ts';

describe('failFrom (host channel contract: original message as detail)', () => {
  it('keeps the message of a caught Error', () => {
    deepStrictEqual(failFrom('spawnFailed', new Error('ssh: not found')), {
      kind: 'failed',
      failure: {kind: 'spawnFailed', detail: 'ssh: not found'},
    });
  });

  it('keeps the text of a caught value that is not an Error', () => {
    deepStrictEqual(failFrom('copyFailed', 'scp: permission denied'), {
      kind: 'failed',
      failure: {kind: 'copyFailed', detail: 'scp: permission denied'},
    });
  });
});

describe('hostPathOf (client file read in place on the host)', () => {
  const channel = new RecordingChannel({
    identity: 'distro',
    platformHint: 'linux',
    hostPaths: new Map([
      ['C:\\temp\\server.tar.gz', '/mnt/c/temp/server.tar.gz'],
    ]),
  });

  function withoutOperation(): HostChannel {
    return {
      runScript: channel.runScript.bind(channel),
      copyToHost: channel.copyToHost.bind(channel),
      identity: () => 'host',
      platformHint: () => 'linux',
    };
  }

  it('returns the path the channel gives', async () => {
    deepStrictEqual(
      await hostPathOf(channel, 'C:\\temp\\server.tar.gz'),
      '/mnt/c/temp/server.tar.gz',
    );
  });

  it('returns none for a file the channel has no path for', async () => {
    deepStrictEqual(await hostPathOf(channel, '/elsewhere'), undefined);
  });

  it('returns none for a channel without the operation', async () => {
    deepStrictEqual(await hostPathOf(withoutOperation(), '/any'), undefined);
  });

  it('returns none when the channel fails to answer', async () => {
    const failing: HostChannel = {
      ...withoutOperation(),
      clientPathOnHost: () => Promise.reject(new Error('wslpath: not found')),
    };
    deepStrictEqual(await hostPathOf(failing, '/any'), undefined);
  });
});
