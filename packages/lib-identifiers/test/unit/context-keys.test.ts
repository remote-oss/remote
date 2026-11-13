import {deepStrictEqual, throws} from 'node:assert';
import {type ContextKeyHost, setContextKey} from '../../src/index.ts';

describe('setContextKey', () => {
  let calls: Array<[string, unknown]>;
  let host: ContextKeyHost;

  beforeEach(() => {
    calls = [];
    host = {
      setContext: (contextKey, value) => {
        calls.push([contextKey, value]);
        return Promise.resolve();
      },
    };
  });

  it('sets a key the extension sets', async () => {
    await setContextKey(
      host,
      {id: 'remote-x.connected', setter: 'extension'},
      true,
    );
    deepStrictEqual(calls, [['remote-x.connected', true]]);
  });

  it('wsl-07: sets a key the editor and the extension both set', async () => {
    await setContextKey(
      host,
      {id: 'remote-x.installed', setter: 'coreAndExtension'},
      true,
    );
    deepStrictEqual(calls, [['remote-x.installed', true]]);
  });

  it('fails for a key the editor sets (contracts 1.2 NotExtensionSet)', () => {
    throws(
      () =>
        setContextKey(host, {id: 'remoteName', setter: 'core'}, 'ssh-remote'),
      {
        message:
          "NotExtensionSet: context key 'remoteName' is set by the editor",
      },
    );
  });
});
