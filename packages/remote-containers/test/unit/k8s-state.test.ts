import {deepStrictEqual} from 'node:assert';
import {
  containerStateOf,
  inspectedPod,
  podGetArguments,
} from '../../src/attach/k8s-state.ts';
import type {K8sTarget} from '../../src/attach/k8s-payload.ts';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';

const TARGET: K8sTarget = {
  context: 'kind-lab',
  podname: 'web-1',
  namespace: 'default',
  name: 'app',
  image: 'nginx:1.27',
};
const NEVER = new AbortController().signal;

/** A run that ended with `status` and printed `stdout`. */
function exits(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}

function podJson(statuses: unknown): string {
  return JSON.stringify({status: {containerStatuses: statuses}});
}

/** An engine that answers every run with `answer`, and records the arguments. */
function engineAnswering(answer: EngineRunOutcome) {
  const seen: string[][] = [];
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      seen.push([...argv]);
      return Promise.resolve(answer);
    },
    spawn: () => Promise.reject(new Error('never spawned')),
  };
  return {engine, seen};
}

describe('the state of a pod window’s container (card containers-191, BR-23)', () => {
  it('F-0604 BR-23: the pod is read with the pinned context and namespace, as json', () => {
    deepStrictEqual(podGetArguments(TARGET), [
      'get',
      'pod',
      'web-1',
      '--context=kind-lab',
      '--namespace=default',
      '-o',
      'json',
    ]);
  });

  it('F-0604 BR-23: a running container is running since its start time, a terminated one is exited, and one that waits is not running', () => {
    deepStrictEqual(
      [
        podJson([{name: 'app', state: {running: {startedAt: 't1'}}}]),
        podJson([{name: 'app', state: {terminated: {startedAt: 't0'}}}]),
        podJson([{name: 'app', state: {waiting: {reason: 'Pending'}}}]),
      ].map(text => containerStateOf(text, 'app')),
      [
        {status: 'running', startedAt: 't1'},
        {status: 'exited', startedAt: 't0'},
        {status: 'created', startedAt: ''},
      ],
    );
  });

  it('F-0604 BR-23: only the container the window is attached to counts, among several, and a pod with no status yet is not running', () => {
    deepStrictEqual(
      [
        containerStateOf(
          podJson([
            {name: 'side', state: {running: {startedAt: 'x'}}},
            {name: 'app', state: {terminated: {}}},
          ]),
          'app',
        ),
        containerStateOf(podJson([{name: 'side', state: {}}]), 'app'),
        containerStateOf('{"status":{}}', 'app'),
        containerStateOf(podJson([{name: 'app', state: {running: {}}}]), 'app'),
      ],
      [
        {status: 'exited', startedAt: ''},
        {status: 'created', startedAt: ''},
        {status: 'created', startedAt: ''},
        {status: 'running', startedAt: ''},
      ],
    );
  });

  it('F-0604 BR-23: text that is no JSON is no pod', () => {
    deepStrictEqual(containerStateOf('not json', 'app'), undefined);
  });

  it('F-0604 BR-23: a pod the cluster does not know is missing, a cluster that does not answer or a failing kubectl is unreachable, and an answer that is no pod is unreachable too', async () => {
    const states = [];
    for (const answer of [
      exits(1, ''),
      {
        kind: 'ran' as const,
        status: 1,
        stdout: '',
        stderr: 'Error from server (NotFound): pods "web-1" not found',
      },
      {
        kind: 'ran' as const,
        status: 1,
        stdout: '',
        stderr: 'Unable to connect to the server',
      },
      {kind: 'failed' as const, detail: 'spawn kubectl ENOENT'},
      exits(0, 'not json'),
      exits(0, podJson([{name: 'app', state: {running: {startedAt: 't'}}}])),
    ]) {
      states.push(
        await inspectedPod(engineAnswering(answer).engine, TARGET, NEVER),
      );
    }
    deepStrictEqual(states, [
      'unreachable',
      'missing',
      'unreachable',
      'unreachable',
      'unreachable',
      {status: 'running', startedAt: 't'},
    ]);
  });
});
