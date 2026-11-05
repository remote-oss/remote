import {deepStrictEqual} from 'node:assert';
import type {
  EngineHost,
  EngineOptions,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  KUBECTL_BOUND_MILLISECONDS,
  kubectlHostOf,
  listArguments,
} from '../../src/engine/kubectl-host.ts';

const POD_LIST = JSON.stringify({
  items: [
    {
      metadata: {name: 'web', namespace: 'shop'},
      spec: {containers: [{name: 'app', image: 'nginx'}]},
    },
  ],
});

const PROBE_OUTPUT =
  'remote-oss-env-probe-begin\nPATH=/login/bin:/usr/bin\0HOME=/home/u\0\nremote-oss-env-probe-end\n';

interface Call {
  argv: string[];
  environment: Readonly<Record<string, string>> | undefined;
}

/** A host that answers by `answer`, and keeps what it was asked. */
function hostOf(
  calls: Call[],
  answer: (
    argv: readonly string[],
    options: EngineOptions,
  ) => Promise<EngineRunOutcome>,
): EngineHost {
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (argv, input, options) => {
      calls.push({argv: [...argv], environment: options.environment});
      return answer(argv, options);
    },
    spawn: () => Promise.reject(new Error('no spawn')),
  };
}

function exits(
  stdout: string,
  status = 0,
  stderr = '',
): Promise<EngineRunOutcome> {
  return Promise.resolve({kind: 'ran', status, stdout, stderr});
}

/** A run that never answers but when its signal aborts, as a killed process ends with no status. */
function hangingUntilAborted(
  options: EngineOptions,
): Promise<EngineRunOutcome> {
  return new Promise(resolve => {
    function ended(): void {
      resolve({kind: 'ran', status: undefined, stdout: '', stderr: ''});
    }
    if (options.cancellation.aborted) {
      ended();
    }
    options.cancellation.addEventListener('abort', ended);
  });
}

function sceneOf(
  options: {
    platform?: string;
    environment?: Readonly<Record<string, string | undefined>>;
    kubectl?: (
      argv: readonly string[],
      options: EngineOptions,
    ) => Promise<EngineRunOutcome>;
    shell?: (
      argv: readonly string[],
      options: EngineOptions,
    ) => Promise<EngineRunOutcome>;
    bounds?: {listing: number; probe: number};
  } = {},
): {
  kubectlCalls: Call[];
  shellCalls: Call[];
  host: ReturnType<typeof kubectlHostOf>;
} {
  const kubectlCalls: Call[] = [];
  const shellCalls: Call[] = [];
  const host = kubectlHostOf({
    kubectl: hostOf(kubectlCalls, options.kubectl ?? (() => exits(POD_LIST))),
    shell: hostOf(shellCalls, options.shell ?? (() => exits(PROBE_OUTPUT))),
    platform: options.platform ?? 'linux',
    environment: options.environment ?? {PATH: '/editor/bin', Path: undefined},
    ...(options.bounds === undefined ? {} : {bounds: options.bounds}),
  });
  return {kubectlCalls, shellCalls, host};
}

const NEVER = new AbortController().signal;

describe('the kubectl host (card containers-190, #2116)', () => {
  it('F-0604 AC-6 (c190-listing): the pods of the current namespace are asked for with argv only, in the login shell’s environment, which is probed once', async () => {
    const scene = sceneOf();
    const first = await scene.host.listPods(undefined, NEVER);
    await scene.host.listPods(undefined, NEVER);
    deepStrictEqual(
      {
        first:
          first.kind === 'listed' ? first.pods.map(each => each.name) : first,
        argv: scene.kubectlCalls.map(call => call.argv),
        path: scene.kubectlCalls[0]?.environment?.PATH,
        probes: scene.shellCalls.length,
        probeArgv: scene.shellCalls[0]?.argv[0],
      },
      {
        first: ['web'],
        argv: [
          ['get', 'pods', '-o', 'json'],
          ['get', 'pods', '-o', 'json'],
        ],
        path: '/login/bin:/usr/bin',
        probes: 1,
        probeArgv: '-c',
      },
    );
  });

  it('F-0604 BR-12: the engine of the host runs and spawns kubectl in the login shell’s environment, and a variable the caller names wins', async () => {
    const seen: Array<[string, Readonly<Record<string, string>> | undefined]> =
      [];
    const kubectl: EngineHost = {
      // eslint-disable-next-line id-length -- the port's method is named run
      run: (argv, input, options) => {
        seen.push(['run', options.environment]);
        return exits('');
      },
      spawn: (argv, options) => {
        seen.push(['spawn', options.environment]);
        return Promise.resolve({kind: 'failed', detail: 'no process'});
      },
    };
    const host = kubectlHostOf({
      kubectl,
      shell: hostOf([], () => exits(PROBE_OUTPUT)),
      platform: 'linux',
      environment: {PATH: '/editor/bin', Path: undefined},
    });
    await host.engine.run(
      ['version'],
      {kind: 'none'},
      {
        environment: {EXTRA: '1', HOME: '/override'},
        cancellation: NEVER,
      },
    );
    await host.engine.spawn(['exec'], {cancellation: NEVER});
    deepStrictEqual(seen, [
      ['run', {PATH: '/login/bin:/usr/bin', HOME: '/override', EXTRA: '1'}],
      ['spawn', {PATH: '/login/bin:/usr/bin', HOME: '/home/u'}],
    ]);
  });

  it('F-0604 AC-6 (c190-probe-fallback): a login shell that fails leaves the editor’s own environment, and native Windows is not probed', async () => {
    const failing = sceneOf({shell: () => exits('', 1, 'no shell')});
    const windows = sceneOf({platform: 'win32'});
    await failing.host.listPods(undefined, NEVER);
    await windows.host.listPods(undefined, NEVER);
    deepStrictEqual(
      [
        failing.kubectlCalls[0]?.environment?.PATH,
        windows.kubectlCalls[0]?.environment?.PATH,
        windows.shellCalls.length,
      ],
      ['/editor/bin', '/editor/bin', 0],
    );
  });

  it('F-0604 AC-6 (c190-probe-bound): a login shell that never answers is cut at its bound, and the editor’s environment is used', async () => {
    const scene = sceneOf({
      shell: (argv, options) => hangingUntilAborted(options),
      bounds: {listing: 1000, probe: 20},
    });
    await scene.host.listPods(undefined, NEVER);
    deepStrictEqual(scene.kubectlCalls[0]?.environment?.PATH, '/editor/bin');
  });

  it('F-0604 AC-16, AC-17 (c190-arguments): the namespace’s pods, or one pod in a namespace or in the current one', () => {
    deepStrictEqual(
      [
        listArguments(undefined),
        listArguments({name: 'web', namespace: 'shop'}),
        listArguments({name: 'web', namespace: undefined}),
      ],
      [
        ['get', 'pods', '-o', 'json'],
        ['get', 'pod', 'web', '--namespace', 'shop', '-o', 'json'],
        ['get', 'pod', 'web', '-o', 'json'],
      ],
    );
  });

  it('F-0604 AC-4 (c190-unreachable): a kubectl that fails names its command line and what it printed', async () => {
    const scene = sceneOf({
      kubectl: () => exits('', 1, 'Unable to connect to the server\n'),
    });
    deepStrictEqual(await scene.host.listPods(undefined, NEVER), {
      kind: 'failed',
      detail:
        'Command failed: kubectl get pods -o json\nUnable to connect to the server',
    });
  });

  it('F-0604 AC-4 (c190-unreadable): an answer that is no pod list fails the listing', async () => {
    const scene = sceneOf({kubectl: () => exits('<html>')});
    deepStrictEqual(await scene.host.listPods(undefined, NEVER), {
      kind: 'failed',
      detail:
        'Command failed: kubectl get pods -o json\nThe output is not a pod list.',
    });
  });

  it('F-0604 AC-23 (c190-missing): a kubectl that is not there fails with Node’s own message on Linux, macOS and WSL', async () => {
    const scene = sceneOf({
      kubectl: () =>
        Promise.resolve({kind: 'failed', detail: 'spawn kubectl ENOENT'}),
    });
    deepStrictEqual(await scene.host.listPods(undefined, NEVER), {
      kind: 'failed',
      detail: 'spawn kubectl ENOENT',
    });
  });

  it('F-0604 AC-24 (c190-missing-windows): on native Windows the detail is the reference’s sentence with the PATH, and another start failure keeps its message', async () => {
    const missing = sceneOf({
      platform: 'win32',
      kubectl: () =>
        Promise.resolve({kind: 'failed', detail: 'spawn kubectl ENOENT'}),
    });
    const refused = sceneOf({
      platform: 'win32',
      kubectl: () =>
        Promise.resolve({kind: 'failed', detail: 'spawn kubectl EACCES'}),
    });
    deepStrictEqual(
      [
        await missing.host.listPods(undefined, NEVER),
        await refused.host.listPods(undefined, NEVER),
      ],
      [
        {
          kind: 'failed',
          detail: "Exectuable 'kubectl' not found on PATH '/editor/bin'.",
        },
        {kind: 'failed', detail: 'spawn kubectl EACCES'},
      ],
    );
  });

  it('F-0604 AC-24 (c190-missing-windows-path): the sentence names a PATH written in the platform’s case, and an empty one when there is none', async () => {
    function missing(
      environment: Readonly<Record<string, string | undefined>>,
    ) {
      return sceneOf({
        platform: 'win32',
        environment,
        kubectl: () =>
          Promise.resolve({kind: 'failed', detail: 'spawn kubectl ENOENT'}),
      }).host.listPods(undefined, NEVER);
    }
    deepStrictEqual(
      [
        await missing({Path: 'C:\\Windows'}),
        await missing({Path: undefined}),
        await missing({}),
      ],
      [
        {
          kind: 'failed',
          detail: "Exectuable 'kubectl' not found on PATH 'C:\\Windows'.",
        },
        {kind: 'failed', detail: "Exectuable 'kubectl' not found on PATH ''."},
        {kind: 'failed', detail: "Exectuable 'kubectl' not found on PATH ''."},
      ],
    );
  });

  it('F-0604 AC-29 (c190-bound, ruling-2110-kubectl-bound): a kubectl that never answers ends the listing at the bound as the listing’s failure, which is 180 s', async () => {
    const scene = sceneOf({
      kubectl: (argv, options) => hangingUntilAborted(options),
      bounds: {listing: 20, probe: 1000},
    });
    deepStrictEqual(
      [await scene.host.listPods(undefined, NEVER), KUBECTL_BOUND_MILLISECONDS],
      [
        {
          kind: 'failed',
          detail:
            'Command failed: kubectl get pods -o json\nNo answer in 0.02 s.',
        },
        180_000,
      ],
    );
  });

  it('F-0604 AC-19, AC-29 (c190-cancel): a listing the user cancels ends as cancelled, not as a failure', async () => {
    const scene = sceneOf({
      kubectl: (argv, options) => hangingUntilAborted(options),
    });
    const user = new AbortController();
    const listing = scene.host.listPods(undefined, user.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    user.abort();
    deepStrictEqual(await listing, {kind: 'cancelled'});
  });

  it('F-0604 AC-19 (c190-cancelled-before): a listing asked for after the user cancelled ends as cancelled, and so does a context', async () => {
    const scene = sceneOf({
      kubectl: (argv, options) => hangingUntilAborted(options),
    });
    const user = new AbortController();
    user.abort();
    deepStrictEqual(
      [
        await scene.host.listPods(undefined, user.signal),
        await scene.host.currentContext(user.signal),
      ],
      [
        {kind: 'cancelled'},
        {
          kind: 'failed',
          detail: 'Command failed: kubectl config current-context\nCancelled.',
        },
      ],
    );
  });

  it('F-0604 AC-17 (c190-context-empty): a kubectl that prints no context fails the pick', async () => {
    const scene = sceneOf({kubectl: () => exits('\n')});
    deepStrictEqual(await scene.host.currentContext(NEVER), {
      kind: 'failed',
      detail:
        'Command failed: kubectl config current-context\nNo current context.',
    });
  });

  it('F-0604 AC-17 (c190-context): the current context is what kubectl prints, and a kubectl without one is a failure', async () => {
    const named = sceneOf({kubectl: () => exits('kind-lab\n')});
    const unset = sceneOf({
      kubectl: () => exits('', 1, 'error: current-context is not set\n'),
    });
    const missing = sceneOf({
      kubectl: () =>
        Promise.resolve({kind: 'failed', detail: 'spawn kubectl ENOENT'}),
    });
    deepStrictEqual(
      [
        await named.host.currentContext(NEVER),
        await unset.host.currentContext(NEVER),
        await missing.host.currentContext(NEVER),
        named.kubectlCalls[0]?.argv,
      ],
      [
        {kind: 'context', name: 'kind-lab'},
        {
          kind: 'failed',
          detail:
            'Command failed: kubectl config current-context\nerror: current-context is not set',
        },
        {kind: 'failed', detail: 'spawn kubectl ENOENT'},
        ['config', 'current-context'],
      ],
    );
  });
});
