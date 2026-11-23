/**
 * @fileoverview `kubectl` as the attach to a Kubernetes container sees it: one program host that is given argv and no
 * shell, reads `-o json`, runs in the environment a login shell gives, and bounds every wait of its own.
 */

import {
  probedEnvironmentOf,
  probeScriptOf,
} from '../connect/remote-environment.ts';
import {type K8sPod, podsOf} from '../attach/k8s-pods.ts';
import type {EngineHost} from './engine-host.ts';

/**
 * How long a pod listing may take before it ends as the listing's failure: above the 160 s `kubectl` itself took to
 * give up on a black hole, so a slow cluster is not cut (ruling-2110-kubectl-bound).
 */
export const KUBECTL_BOUND_MILLISECONDS = 180_000;

/** How long the login shell may take to print its environment before the editor's own is used. */
const PROBE_BOUND_MILLISECONDS = 15_000;

/** The pod to list instead of the namespace's pods, when a row of the Kubernetes explorer named one. */
export interface PodRequest {
  name: string;
  namespace: string | undefined;
}

/** What a listing ended with. */
export type PodListing =
  | {kind: 'listed'; pods: K8sPod[]}
  | {kind: 'failed'; detail: string}
  | {kind: 'cancelled'};

/** What the host needs of the machine. */
export interface KubectlPorts {
  /** `kubectl` as a program of the machine, given the environment of a run. */
  kubectl: EngineHost;
  /** A POSIX shell as a program of the machine, for the environment probe. */
  shell: EngineHost;
  /** `process.platform`. */
  platform: string;
  /** The editor's own environment. */
  environment: Readonly<Record<string, string | undefined>>;
  /** The bounds, in milliseconds; the rulings' constants unless a test gives smaller ones. */
  bounds?: {listing: number; probe: number};
}

/** The current context, or the failure's detail. */
export type ContextAnswer =
  {kind: 'context'; name: string} | {kind: 'failed'; detail: string};

/** The arguments that list the pods of the current namespace, or the one pod of `request`. */
export function listArguments(request: PodRequest | undefined): string[] {
  if (request === undefined) {
    return ['get', 'pods', '-o', 'json'];
  }
  return [
    'get',
    'pod',
    request.name,
    ...(request.namespace === undefined
      ? []
      : ['--namespace', request.namespace]),
    '-o',
    'json',
  ];
}

/** What a run of `kubectl` came to. */
type KubectlRun =
  | {kind: 'printed'; stdout: string}
  | {kind: 'failed'; detail: string}
  | {kind: 'cancelled'};

/** The detail of a command that failed, with the reason under its command line. */
function failureOf(argv: readonly string[], reason: string): string {
  return `Command failed: ${commandLineOf(argv)}\n${reason}`.trimEnd();
}

/** The command line as a failure names it. */
function commandLineOf(argv: readonly string[]): string {
  return `kubectl ${argv.join(' ')}`;
}

/** A bounded signal: it aborts with `cancellation`, or when `milliseconds` pass. */
function boundedSignal(
  cancellation: AbortSignal,
  milliseconds: number,
): {signal: AbortSignal; timedOut: () => boolean; release: () => void} {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, milliseconds);
  function forward(): void {
    controller.abort();
  }
  if (cancellation.aborted) {
    controller.abort();
  }
  cancellation.addEventListener('abort', forward, {once: true});
  return {
    signal: controller.signal,
    timedOut: () => expired,
    release: () => {
      clearTimeout(timer);
      cancellation.removeEventListener('abort', forward);
    },
  };
}

/** The PATH of `environment`, under the name the platform gives it. */
function pathOf(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const name = Object.keys(environment).find(
    key => key.toLowerCase() === 'path',
  );
  return name === undefined ? '' : (environment[name] ?? '');
}

/** The detail of a program that could not start: Node's message, or the sentence the Kubernetes explorer shows for a missing program on native Windows. */
function startFailureOf(
  detail: string,
  ports: KubectlPorts,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return ports.platform === 'win32' && detail.includes('ENOENT')
    ? `Exectuable 'kubectl' not found on PATH '${pathOf(environment)}'.`
    : detail;
}

/** The entries of `environment` that have a value. */
function definedEntries(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** The kubectl host of one window: its environment is probed once, and its listings are bounded. */
export function kubectlHostOf(ports: KubectlPorts): {
  listPods: (
    request: PodRequest | undefined,
    cancellation: AbortSignal,
  ) => Promise<PodListing>;
  /** The kubeconfig's current context, or why `kubectl` doesn't give one. */
  currentContext: (cancellation: AbortSignal) => Promise<ContextAnswer>;
  /** `kubectl` as an engine whose every run and spawn has the login shell's environment, probed once. */
  engine: EngineHost;
} {
  const bounds = ports.bounds ?? {
    listing: KUBECTL_BOUND_MILLISECONDS,
    probe: PROBE_BOUND_MILLISECONDS,
  };
  let probed: Promise<Readonly<Record<string, string | undefined>>> | undefined;

  /** The login shell's environment over the editor's own; the editor's alone where the shell gives none. */
  async function probeEnvironment(): Promise<
    Readonly<Record<string, string | undefined>>
  > {
    if (ports.platform === 'win32') {
      return ports.environment;
    }
    const bound = boundedSignal(new AbortController().signal, bounds.probe);
    try {
      const outcome = await ports.shell.run(
        ['-c', probeScriptOf('loginInteractiveShell')],
        {kind: 'none'},
        {cancellation: bound.signal},
      );
      const environment =
        outcome.kind === 'ran' && outcome.status === 0
          ? probedEnvironmentOf(outcome.stdout)
          : undefined;
      return {...ports.environment, ...environment};
    } finally {
      bound.release();
    }
  }

  function environmentOf(): Promise<
    Readonly<Record<string, string | undefined>>
  > {
    probed ??= probeEnvironment();
    return probed;
  }

  /** Runs `kubectl` with `argv` within the listing's bound: what it printed, or why there is nothing to read. */
  async function runKubectl(
    argv: readonly string[],
    cancellation: AbortSignal,
  ): Promise<KubectlRun> {
    const environment = await environmentOf();
    const bound = boundedSignal(cancellation, bounds.listing);
    try {
      const outcome = await ports.kubectl.run(
        argv,
        {kind: 'none'},
        {
          environment: definedEntries(environment),
          cancellation: bound.signal,
        },
      );
      if (cancellation.aborted) {
        return {kind: 'cancelled'};
      }
      if (bound.timedOut()) {
        return {
          kind: 'failed',
          detail: `Command failed: ${commandLineOf(argv)}\nNo answer in ${String(bounds.listing / 1000)} s.`,
        };
      }
      if (outcome.kind === 'failed') {
        return {
          kind: 'failed',
          detail: startFailureOf(outcome.detail, ports, environment),
        };
      }
      return outcome.status === 0
        ? {kind: 'printed', stdout: outcome.stdout}
        : {
            kind: 'failed',
            detail: failureOf(argv, outcome.stderr.trim()),
          };
    } finally {
      bound.release();
    }
  }

  async function listPods(
    request: PodRequest | undefined,
    cancellation: AbortSignal,
  ): Promise<PodListing> {
    const argv = listArguments(request);
    const outcome = await runKubectl(argv, cancellation);
    if (outcome.kind !== 'printed') {
      return outcome;
    }
    const pods = podsOf(outcome.stdout);
    return pods === undefined
      ? {
          kind: 'failed',
          detail: failureOf(argv, 'The output is not a pod list.'),
        }
      : {kind: 'listed', pods};
  }

  async function currentContext(
    cancellation: AbortSignal,
  ): Promise<ContextAnswer> {
    const argv = ['config', 'current-context'];
    const outcome = await runKubectl(argv, cancellation);
    if (outcome.kind === 'cancelled') {
      return {kind: 'failed', detail: failureOf(argv, 'Cancelled.')};
    }
    if (outcome.kind === 'failed') {
      return outcome;
    }
    const name = outcome.stdout.trim();
    return name === ''
      ? {kind: 'failed', detail: failureOf(argv, 'No current context.')}
      : {kind: 'context', name};
  }

  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: async (argv, input, options) =>
      ports.kubectl.run(argv, input, {
        ...options,
        environment: {
          ...definedEntries(await environmentOf()),
          ...options.environment,
        },
      }),
    spawn: async (argv, options) =>
      ports.kubectl.spawn(argv, {
        ...options,
        environment: {
          ...definedEntries(await environmentOf()),
          ...options.environment,
        },
      }),
  };
  return {listPods, currentContext, engine};
}
