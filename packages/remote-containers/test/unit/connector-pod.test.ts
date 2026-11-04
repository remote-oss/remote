import {deepStrictEqual} from 'node:assert';
import {k8sPayloadOf, type K8sTarget} from '../../src/attach/k8s-payload.ts';
import {inputOf, sceneOf} from './connector.fixture.ts';
import {fakeEngine, type ProcessScript} from './fake-engine.ts';

const TARGET: K8sTarget = {
  context: 'kind-lab',
  podname: 'web-1',
  namespace: 'default',
  name: 'app',
  image: 'nginx:1.27',
};
const PAYLOAD = k8sPayloadOf(TARGET);

/** Prints `text` and ends with `status` once its script has been read. */
function answers(text: string, status = 0): ProcessScript {
  return async process => {
    await process.stdinEnded;
    process.print(text);
    process.exit(status);
  };
}

/** A kubectl that tells its user first, runs every later script with no output, and shows the container running. */
function podEngine(user: string, status = 0) {
  const engine = fakeEngine(
    answers(`${user}\n`, status),
    ...Array<ProcessScript>(8).fill(answers('')),
  );
  engine.answer = {
    kind: 'ran',
    status: 0,
    stdout: JSON.stringify({
      status: {
        containerStatuses: [
          {name: 'app', state: {running: {startedAt: '2026-11-04T10:00:00Z'}}},
        ],
      },
    }),
    stderr: '',
  };
  return engine;
}

describe('the connect of a Kubernetes pod window (card containers-191, §4)', () => {
  it('F-0604 BR-21, BR-20: the user is told from the pod, the server goes in that user’s home with no root step, and the window is trusted', async () => {
    const kubectl = podEngine('webuser');
    const scene = sceneOf({}, {pods: kubectl});
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    const [request] = scene.serverRequests;
    deepStrictEqual(
      [
        'connectionToken' in result && result.trusted,
        request?.remoteUser,
        request?.volumeMounted,
        request?.rootChannel === request?.channel,
        kubectl.processes[0]?.argv.slice(0, 7),
      ],
      [
        true,
        'webuser',
        false,
        true,
        [
          'exec',
          '-i',
          '--context=kind-lab',
          '--namespace=default',
          'web-1',
          '--container=app',
          '--',
        ],
      ],
    );
  });

  it('F-0604 BR-12: the relay is opened through kubectl exec with the pod’s own address as its identity, and no Docker call is made', async () => {
    const scene = sceneOf({}, {pods: podEngine('webuser')});
    await scene.connector.connect(inputOf(PAYLOAD));
    const [relay] = scene.relayRequests;
    deepStrictEqual(
      [relay?.containerId, relay?.dialer !== undefined, scene.engineCalls],
      ['default/web-1/app', true, []],
    );
  });

  it('F-0604 BR-10, BR-20: nothing is prepared or set up for a pod: no lifecycle, no configuration read, no shutdown registration', async () => {
    const scene = sceneOf({}, {pods: podEngine('webuser')});
    await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [scene.prepared.length, scene.shutdownSent, scene.lifecycleRuns],
      [0, [], ['server files', 'server start']],
    );
  });

  it('F-0604 AC-34: a user the pod cannot tell is a setup failure before any server step', async () => {
    const scene = sceneOf({}, {pods: podEngine('', 1)});
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      ['connectionToken' in result, scene.serverRequests.length],
      [false, 0],
    );
  });

  it('F-0604 AC-36, BR-23: a held pod connection reads its state through kubectl get pod', async () => {
    const kubectl = podEngine('webuser');
    const scene = sceneOf({}, {pods: kubectl});
    await scene.connector.connect(inputOf(PAYLOAD));
    const held = scene.connector.heldConnection();
    deepStrictEqual(
      [held?.containerId, held?.hostPath, held?.configFile, kubectl.runs[0]],
      [
        'default/web-1/app',
        '',
        '',
        [
          'get',
          'pod',
          'web-1',
          '--context=kind-lab',
          '--namespace=default',
          '-o',
          'json',
        ],
      ],
    );
  });

  it('F-0604 AC-35: a member that fails its name rule is refused before any kubectl call', async () => {
    const kubectl = podEngine('webuser');
    const scene = sceneOf({}, {pods: kubectl});
    const bad = k8sPayloadOf({...TARGET, namespace: '--context=other'});
    const result = await scene.connector.connect(inputOf(bad));
    deepStrictEqual(
      [
        'connectionToken' in result ? 'connected' : result.kind,
        kubectl.processes.length,
        kubectl.runs.length,
      ],
      ['malformedAuthority', 0, 0],
    );
  });

  it('F-0604 BR-1: without the pods dependency a pod payload is no authority the connector reads', async () => {
    const scene = sceneOf();
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      ['connectionToken' in result ? 'connected' : result.kind],
      ['malformedAuthority'],
    );
  });
});
