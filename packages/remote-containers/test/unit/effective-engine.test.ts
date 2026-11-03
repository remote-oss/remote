import {deepStrictEqual} from 'node:assert';
import {
  engineEnvironment,
  engineKeyOf,
  engineLabelOf,
  environmentOfPinned,
  type EngineSources,
  pinnedEngineOf,
  withAmbientContext,
  withEnvironment,
} from '../../src/engine/effective-engine.ts';
import type {EngineHost} from '../../src/engine/engine-host.ts';

const NONE: EngineSources = {
  containersEnvironment: undefined,
  dockerEnvironment: undefined,
  dockerHost: undefined,
  certPath: undefined,
  tlsVerify: undefined,
  processEnvironment: {},
};

function sourcesOf(parts: Partial<EngineSources>): EngineSources {
  return {...NONE, ...parts};
}

describe('the effective engine (card containers-133)', () => {
  it('F-0205 AC-31: containers.environment wins over docker.environment, which wins over docker.host; an empty one gives way', () => {
    const all = sourcesOf({
      containersEnvironment: {DOCKER_HOST: 'tcp://a:1'},
      dockerEnvironment: {DOCKER_HOST: 'tcp://b:1'},
      dockerHost: 'tcp://c:1',
    });
    deepStrictEqual(
      [
        engineEnvironment(all),
        engineEnvironment({...all, containersEnvironment: {}}),
        engineEnvironment({
          ...all,
          containersEnvironment: undefined,
          dockerEnvironment: {},
        }),
      ],
      [
        {DOCKER_HOST: 'tcp://a:1'},
        {DOCKER_HOST: 'tcp://b:1'},
        {DOCKER_HOST: 'tcp://c:1'},
      ],
    );
  });

  it('F-0205 AC-31, AC-14d, AC-41: a host wins over a context, from any source', () => {
    deepStrictEqual(
      [
        engineEnvironment(
          sourcesOf({
            containersEnvironment: {DOCKER_CONTEXT: 'other'},
            dockerHost: 'tcp://c:1',
          }),
        ),
        engineEnvironment(
          sourcesOf({
            containersEnvironment: {DOCKER_HOST: 'tcp://a:1'},
            dockerEnvironment: {DOCKER_CONTEXT: 'other'},
          }),
        ),
        engineEnvironment(
          sourcesOf({
            processEnvironment: {
              DOCKER_HOST: 'tcp://p:1',
              DOCKER_CONTEXT: 'other',
            },
          }),
        ),
      ],
      [
        {DOCKER_HOST: 'tcp://c:1'},
        {DOCKER_HOST: 'tcp://a:1'},
        {DOCKER_HOST: 'tcp://p:1'},
      ],
    );
  });

  it('F-0205 AC-32, AC-42: a setting’s host wins over the process’s, and the process’s host over a setting’s context', () => {
    deepStrictEqual(
      [
        engineEnvironment(
          sourcesOf({
            dockerHost: 'tcp://s:1',
            processEnvironment: {DOCKER_HOST: 'tcp://p:1'},
          }),
        ),
        engineEnvironment(
          sourcesOf({
            containersEnvironment: {DOCKER_CONTEXT: 'n'},
            processEnvironment: {DOCKER_HOST: 'tcp://p:1'},
          }),
        ),
        engineEnvironment(
          sourcesOf({
            containersEnvironment: {
              DOCKER_CONTEXT: 'n',
              DOCKER_HOST: 'tcp://s:1',
            },
            processEnvironment: {DOCKER_HOST: 'tcp://p:1'},
          }),
        ),
      ],
      [
        {DOCKER_HOST: 'tcp://s:1'},
        {DOCKER_HOST: 'tcp://p:1'},
        {DOCKER_HOST: 'tcp://s:1'},
      ],
    );
  });

  it('F-0205 AC-14c, AC-30: a context alone is kept, from a setting or the process; a setting’s wins', () => {
    deepStrictEqual(
      [
        engineEnvironment(
          sourcesOf({dockerEnvironment: {DOCKER_CONTEXT: 'n'}}),
        ),
        engineEnvironment(
          sourcesOf({processEnvironment: {DOCKER_CONTEXT: 'p'}}),
        ),
        engineEnvironment(
          sourcesOf({
            containersEnvironment: {DOCKER_CONTEXT: 'n'},
            processEnvironment: {DOCKER_CONTEXT: 'p'},
          }),
        ),
      ],
      [{DOCKER_CONTEXT: 'n'}, {DOCKER_CONTEXT: 'p'}, {DOCKER_CONTEXT: 'n'}],
    );
  });

  it('F-0205 AC-33, AC-14a: the certificates and the TLS switch go with a host, from docker.certPath and docker.tlsVerify or the environment, and are dropped without one', () => {
    deepStrictEqual(
      [
        engineEnvironment(
          sourcesOf({
            dockerHost: 'tcp://t:2376',
            certPath: '/certs',
            tlsVerify: '1',
          }),
        ),
        engineEnvironment(
          sourcesOf({
            containersEnvironment: {DOCKER_HOST: 'tcp://t:2376'},
            certPath: '/certs',
            tlsVerify: '1',
          }),
        ),
        engineEnvironment(
          sourcesOf({
            processEnvironment: {
              DOCKER_HOST: 'tcp://t:2376',
              DOCKER_CERT_PATH: '/p',
              DOCKER_TLS_VERIFY: '1',
            },
          }),
        ),
        engineEnvironment(
          sourcesOf({
            dockerEnvironment: {DOCKER_CONTEXT: 'n'},
            certPath: '/certs',
            tlsVerify: '1',
          }),
        ),
      ],
      [
        {
          DOCKER_HOST: 'tcp://t:2376',
          DOCKER_CERT_PATH: '/certs',
          DOCKER_TLS_VERIFY: '1',
        },
        {
          DOCKER_HOST: 'tcp://t:2376',
          DOCKER_CERT_PATH: '/certs',
          DOCKER_TLS_VERIFY: '1',
        },
        {
          DOCKER_HOST: 'tcp://t:2376',
          DOCKER_CERT_PATH: '/p',
          DOCKER_TLS_VERIFY: '1',
        },
        {DOCKER_CONTEXT: 'n'},
      ],
    );
  });

  it('F-0205 AC-50: only the four variables that pick the engine are taken from an environment; PATH, HOME and DOCKER_CONFIG, and values that are not text, are ignored', () => {
    deepStrictEqual(
      [
        engineEnvironment(
          sourcesOf({
            containersEnvironment: {
              PATH: '/evil',
              HOME: '/evil',
              DOCKER_CONFIG: '/evil',
              DOCKER_HOST: 'tcp://a:1',
            },
          }),
        ),
        engineEnvironment(
          sourcesOf({
            containersEnvironment: {DOCKER_HOST: 4},
            dockerEnvironment: ['DOCKER_HOST'],
            dockerHost: '',
          }),
        ),
        engineEnvironment(sourcesOf({containersEnvironment: null})),
      ],
      [{DOCKER_HOST: 'tcp://a:1'}, {}, {}],
    );
  });

  it('F-0205 AC-45: the current context is added only when nothing else picks the engine', () => {
    deepStrictEqual(
      [
        withAmbientContext({}, 'colima'),
        withAmbientContext({}, undefined),
        withAmbientContext({DOCKER_CONTEXT: 'n'}, 'colima'),
        withAmbientContext({DOCKER_HOST: 'tcp://a:1'}, 'colima'),
      ],
      [
        {DOCKER_CONTEXT: 'colima'},
        {},
        {DOCKER_CONTEXT: 'n'},
        {DOCKER_HOST: 'tcp://a:1'},
      ],
    );
  });

  it('F-0205 AC-51, AC-38: the payload’s engine round-trips through the variables, and its label is the host or else the context', () => {
    const environment = {
      DOCKER_HOST: 'tcp://t:2376',
      DOCKER_CERT_PATH: '/certs',
      DOCKER_TLS_VERIFY: '1',
    };
    const pinned = pinnedEngineOf(environment);
    deepStrictEqual(
      [
        pinned,
        environmentOfPinned(pinned),
        engineLabelOf(pinned),
        engineLabelOf({context: 'encode-tcp'}),
        engineLabelOf({}),
      ],
      [
        {host: 'tcp://t:2376', certPath: '/certs', tlsVerify: '1'},
        environment,
        'tcp://t:2376',
        'encode-tcp',
        undefined,
      ],
    );
  });

  it('F-0205 AC-34: an engine built over the environment reads it at each call, for a run and a spawn, and the caller’s variables win', async () => {
    const seen: Array<Readonly<Record<string, string>> | undefined> = [];
    const recorder: EngineHost = {
      // eslint-disable-next-line id-length -- the port's method is named run
      run: (argv, input, options) => {
        seen.push(options.environment);
        return Promise.resolve({kind: 'failed', detail: ''});
      },
      spawn: (argv, options) => {
        seen.push(options.environment);
        return Promise.resolve({kind: 'failed', detail: ''});
      },
    };
    let current: Record<string, string> = {DOCKER_HOST: 'tcp://a:1'};
    const wrapped = withEnvironment(recorder, () => current);
    const cancellation = new AbortController().signal;
    await wrapped.run(['ps'], {kind: 'none'}, {cancellation});
    current = {DOCKER_HOST: 'tcp://b:1'};
    await wrapped.spawn(['ps'], {cancellation});
    await wrapped.run(
      ['ps'],
      {kind: 'none'},
      {cancellation, environment: {DOCKER_HOST: 'tcp://c:1', EXTRA: 'y'}},
    );
    deepStrictEqual(seen, [
      {DOCKER_HOST: 'tcp://a:1'},
      {DOCKER_HOST: 'tcp://b:1'},
      {DOCKER_HOST: 'tcp://c:1', EXTRA: 'y'},
    ]);
  });
});

describe('the key of the effective engine (card containers-142)', () => {
  const AMBIENTS = [
    {context: undefined, endpoint: 'unix:///a.sock'},
    {context: 'box', endpoint: 'tcp://box:2376'},
  ] as const;

  it('F-0205 AC-39, BR-17: a host or a context from a setting names the engine alone, so the current context changes nothing', () => {
    deepStrictEqual(
      [{DOCKER_HOST: 'tcp://far:2376'}, {DOCKER_CONTEXT: 'fixed'}].map(
        environment =>
          AMBIENTS.map(ambient => engineKeyOf(environment, ambient)).concat(
            engineKeyOf(environment, 'noContexts'),
          ),
      ),
      [
        Array(3).fill('{"DOCKER_HOST":"tcp://far:2376"}'),
        Array(3).fill('{"DOCKER_CONTEXT":"fixed"}'),
      ],
    );
  });

  it('F-0205 AC-39, BR-17: with none, the current context and its endpoint make the key, the default context named default', () => {
    deepStrictEqual(
      AMBIENTS.map(ambient => engineKeyOf({}, ambient)),
      [
        '{"context":"default","endpoint":"unix:///a.sock"}',
        '{"context":"box","endpoint":"tcp://box:2376"}',
      ],
    );
  });

  it('F-0205 BR-17: an engine without contexts has the key noContexts', () => {
    deepStrictEqual(engineKeyOf({}, 'noContexts'), 'noContexts');
  });
});
