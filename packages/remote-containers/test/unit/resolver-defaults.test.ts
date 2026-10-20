import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {resolverEditorOf} from 'lib-authority';
import {RESOLVER_EDITOR_OPTIONS} from '../../src/connect/register-connector.ts';

class FakeResolvedAuthority {
  readonly host: string;
  readonly port: number;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }
}

/** The resolver the editor was given for `dev-container`, and what a resolve through it gave. */
async function registeredAndResolved(): Promise<{
  resolver: vscode.RemoteAuthorityResolver | undefined;
  result: object | undefined;
  registeredPrefix: string;
}> {
  let resolver: vscode.RemoteAuthorityResolver | undefined;
  let registeredPrefix = '';
  const editor = {
    ResolvedAuthority: FakeResolvedAuthority,
    workspace: {
      registerRemoteAuthorityResolver: (
        prefix: string,
        given: vscode.RemoteAuthorityResolver,
      ) => {
        registeredPrefix = prefix;
        resolver = given;
        return {dispose: () => undefined};
      },
    },
  } as unknown as typeof vscode;
  resolverEditorOf(
    editor,
    RESOLVER_EDITOR_OPTIONS,
  ).registerRemoteAuthorityResolver('dev-container', {
    resolve: () =>
      Promise.resolve({
        host: '127.0.0.1',
        port: 4000,
        connectionToken: 'token',
        extensionHostEnv: {},
        environmentTunnels: [],
      }),
  });
  const result = await resolver?.resolve('dev-container+7b7d', {
    resolveAttempt: 1,
  });
  return {resolver, result, registeredPrefix};
}

describe('the resolver of the dev container authority (F-1102 §16)', () => {
  it('F-1102 duty 2: the resolver gives core no tunnel factory and no candidatePortSource', async () => {
    const {resolver} = await registeredAndResolved();
    deepStrictEqual(
      ['tunnelFactory', 'candidatePortSource'].map(
        key => key in (resolver ?? {}),
      ),
      [false, false],
    );
  });

  it('F-1102 duty 2: the resolver is the one of the dev-container authority', async () => {
    deepStrictEqual(
      (await registeredAndResolved()).registeredPrefix,
      'dev-container',
    );
  });

  it('F-1102 duty 2: a resolve gives core no tunnel features', async () => {
    const {result} = await registeredAndResolved();
    deepStrictEqual('tunnelFeatures' in (result ?? {}), false);
  });
});
