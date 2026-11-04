import {deepStrictEqual} from 'node:assert';
import {podArgumentOf, podsOf} from '../../src/attach/k8s-pods.ts';

function listOf(...items: unknown[]): string {
  return JSON.stringify({kind: 'List', items});
}

function podJson(
  name: string,
  namespace: string,
  containers: Array<[string, string]>,
  initContainers: Array<[string, string]> = [],
): unknown {
  return {
    kind: 'Pod',
    metadata: {name, namespace},
    spec: {
      initContainers: initContainers.map(([each, image]) => ({
        name: each,
        image,
      })),
      containers: containers.map(([each, image]) => ({name: each, image})),
    },
  };
}

describe('the pods of a kubectl answer (card containers-190, #2116)', () => {
  it('F-0604 AC-6 (c190-sort): the pods are ordered by name, each with its namespace', () => {
    const pods = podsOf(
      listOf(
        podJson('web', 'shop', [['app', 'nginx']]),
        podJson('api', 'shop', [['app', 'node']]),
        podJson('db', 'shop', [['app', 'postgres']]),
      ),
    );
    deepStrictEqual(
      pods?.map(pod => [pod.name, pod.namespace]),
      [
        ['api', 'shop'],
        ['db', 'shop'],
        ['web', 'shop'],
      ],
    );
  });

  it('F-0604 AC-8, AC-28 (c190-container-order): the containers keep the pod spec order and the init containers are left out', () => {
    const pods = podsOf(
      listOf(
        podJson(
          'multi',
          'default',
          [
            ['zeta', 'img:1'],
            ['alpha', 'img:2'],
            ['mid', 'img:3'],
          ],
          [['setup', 'busybox']],
        ),
      ),
    );
    deepStrictEqual(pods?.[0]?.containers, [
      {name: 'zeta', image: 'img:1'},
      {name: 'alpha', image: 'img:2'},
      {name: 'mid', image: 'img:3'},
    ]);
  });

  it('F-0604 AC-27 (c190-no-phase-filter): a pod in any phase is listed like a running one', () => {
    const pending = {
      ...(podJson('waiting', 'default', [['app', 'img']]) as object),
      status: {phase: 'Pending'},
    };
    const done = {
      ...(podJson('finished', 'default', [['app', 'img']]) as object),
      status: {phase: 'Succeeded'},
    };
    deepStrictEqual(
      podsOf(listOf(pending, done))?.map(pod => pod.name),
      ['finished', 'waiting'],
    );
  });

  it('F-0604 AC-17 (c190-one-pod): the answer for one pod is a list of that pod, and an item without a name is left out', () => {
    deepStrictEqual(
      [
        podsOf(JSON.stringify(podJson('solo', 'ns', [['app', 'img']])))?.map(
          pod => pod.name,
        ),
        podsOf(
          listOf(
            {metadata: {}},
            'text',
            null,
            {metadata: 'x'},
            podJson('kept', 'ns', []),
          ),
        )?.map(pod => pod.name),
      ],
      [['solo'], ['kept']],
    );
  });

  it('F-0604 AC-4 (c190-unreadable): an answer that is not JSON, or holds no pods, is no listing', () => {
    deepStrictEqual(
      ['not json', '{"kind": "Status"}', '3', 'null'].map(podsOf),
      [undefined, undefined, undefined, undefined],
    );
  });

  it('F-0604 AC-17 (c190-container-fields): a container without an image keeps an empty one, and a pod with a spec that is not an object has no containers', () => {
    deepStrictEqual(
      podsOf(
        listOf(
          {metadata: {name: 'a'}, spec: {containers: [{name: 'c'}, 3]}},
          {metadata: {name: 'b'}, spec: 'x'},
        ),
      )?.map(pod => [pod.name, pod.namespace, pod.containers]),
      [
        ['a', '', [{name: 'c', image: ''}]],
        ['b', '', []],
      ],
    );
  });

  it('F-0604 AC-22 (c190-argument): a row names a pod by its members or its metadata, and anything that is not a Kubernetes name is no pod', () => {
    deepStrictEqual(
      [
        {name: 'api-1', namespace: 'shop'},
        {metadata: {name: 'api-2', namespace: 'shop'}},
        {name: 'api-3'},
        {name: 'Api'},
        {name: 'x; rm -rf'},
        {name: '--context=evil'},
        {name: 'ok', namespace: 'Bad_Namespace'},
        {name: 'a'.repeat(254)},
        {},
        'text',
        undefined,
        null,
      ].map(podArgumentOf),
      [
        {name: 'api-1', namespace: 'shop'},
        {name: 'api-2', namespace: 'shop'},
        {name: 'api-3', namespace: undefined},
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    );
  });
});
