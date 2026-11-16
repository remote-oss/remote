import {deepStrictEqual} from 'node:assert';
import {
  REGISTER_WAIT_MILLISECONDS,
  SHUTDOWN_CLIENT_WAITS,
  shutdownHelperRequest,
} from '../../src/shutdown/helper-request.ts';
import {SHUTDOWN_END_POLICY} from '../../src/shutdown/shutdown-handler.ts';

describe('the window’s request for the shutdown helper (card containers-69)', () => {
  it('F-0417 BR-9: one helper per instance, keyed under the extension’s own storage, started outside the window’s process tree and ending ten seconds after its last lease', async () => {
    const cancellation = new AbortController().signal;
    const request = shutdownHelperRequest(
      {
        extensionFolder: '/ext/containers',
        storageFolder: '/data/User/globalStorage/remote-oss.remote-containers',
      },
      cancellation,
    );
    deepStrictEqual(
      [
        request.folder,
        request.namespace,
        request.helperKey,
        request.script,
        'launcherScript' in request ? request.launcherScript : undefined,
        request.leaveStarterTree,
        request.policy,
        await request.prepare(),
        request.cancellation === cancellation,
      ],
      [
        {instanceOf: '/data/User/globalStorage/remote-oss.remote-containers'},
        'remote-containers.shutdown',
        'instance',
        '/ext/containers/dist/shutdown-helper.js',
        '/ext/containers/dist/helper-launcher.js',
        true,
        SHUTDOWN_END_POLICY,
        {kind: 'ready', options: {}, payload: {}},
        true,
      ],
    );
  });

  it('F-0417 BR-9: a window waits two seconds for a running helper’s answer and ten for a started one to listen', () => {
    deepStrictEqual(SHUTDOWN_CLIENT_WAITS, {
      helloLimitMilliseconds: 2000,
      startLimitMilliseconds: 10_000,
      retryMilliseconds: 100,
    });
  });

  it('card #2734: the connect waits for its register to be answered as long as the acquire may take after a refused hello and the answer may take after that', () => {
    deepStrictEqual(
      [
        REGISTER_WAIT_MILLISECONDS,
        REGISTER_WAIT_MILLISECONDS >
          SHUTDOWN_CLIENT_WAITS.helloLimitMilliseconds +
            SHUTDOWN_END_POLICY.actionBound +
            SHUTDOWN_CLIENT_WAITS.startLimitMilliseconds +
            12_000,
      ],
      [38_000, true],
    );
  });
});
