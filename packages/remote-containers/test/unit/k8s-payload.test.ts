import {deepStrictEqual} from 'node:assert';
import {kubectlExecArguments} from '../../src/attach/k8s-exec.ts';
import {k8sLabelOf} from '../../src/attach/k8s-label.ts';
import {
  invalidMemberOf,
  k8sPayloadOf,
  k8sTargetOf,
  type K8sTarget,
} from '../../src/attach/k8s-payload.ts';

const TARGET: K8sTarget = {
  context: 'kind-lab',
  podname: 'web-1',
  namespace: 'default',
  name: 'app',
  image: 'nginx:1.27',
};

/** The hex of `text`. */
function hexOf(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex');
}

describe('the payload of a Kubernetes pod window (card containers-191)', () => {
  it('F-0501 AC-6: a target survives the round trip, and its text holds the members in the order context, podname, namespace, name, image', () => {
    deepStrictEqual(
      [
        k8sTargetOf(k8sPayloadOf(TARGET)),
        Buffer.from(k8sPayloadOf(TARGET), 'hex').toString('utf8'),
      ],
      [
        TARGET,
        '{"context":"kind-lab","podname":"web-1","namespace":"default","name":"app","image":"nginx:1.27"}',
      ],
    );
  });

  it('F-0604 AC-35: a payload that is not hex, not JSON or not a record of five texts is refused at the step that fails', () => {
    deepStrictEqual(
      [
        k8sTargetOf('zz'),
        k8sTargetOf(hexOf('not json')),
        k8sTargetOf(hexOf('[1]')),
        k8sTargetOf(hexOf('{"context":"kind-lab"}')),
        k8sTargetOf(hexOf(JSON.stringify({...TARGET, namespace: 5}))),
      ],
      [
        {malformed: 'hex'},
        {malformed: 'json'},
        {malformed: 'shape'},
        {malformed: 'shape'},
        {malformed: 'shape'},
      ],
    );
  });

  it('F-0604 AC-35: a member that fails its name rule is refused with the member named, before any kubectl call', () => {
    function refused(changes: Partial<K8sTarget>) {
      return k8sTargetOf(k8sPayloadOf({...TARGET, ...changes}));
    }
    deepStrictEqual(
      [
        refused({context: '-oops'}),
        refused({podname: 'Web'}),
        refused({namespace: 'a_b'}),
        refused({name: '-x'}),
        refused({image: ''}),
      ],
      [
        {malformed: 'invalid', member: 'context'},
        {malformed: 'invalid', member: 'podname'},
        {malformed: 'invalid', member: 'namespace'},
        {malformed: 'invalid', member: 'name'},
        {malformed: 'invalid', member: 'image'},
      ],
    );
  });

  it('F-0604 AC-35: a context may hold any character but a control one, and may not be empty or start with a dash', () => {
    deepStrictEqual(
      [
        'arn:aws:eks:eu-west-1:123456789012:cluster/prod',
        'gke_proj_zone_cluster',
        'user@host',
        '',
        '-a',
        'a\nb',
        'a\u0000b',
        'a\u007fb',
      ].map(context => invalidMemberOf({...TARGET, context})),
      [
        undefined,
        undefined,
        undefined,
        'context',
        'context',
        'context',
        'context',
        'context',
      ],
    );
  });

  it('F-0604 AC-35: a pod name is a DNS-1123 subdomain: dots between labels, at most 253 characters, no edge dash or dot', () => {
    deepStrictEqual(
      [
        'web',
        'web-1.pods.example',
        'a'.repeat(253),
        'a'.repeat(254),
        '',
        '-web',
        'web-',
        'web..one',
        '.web',
        'web.',
        'Web',
        'we_b',
        'we b',
      ].map(podname => invalidMemberOf({...TARGET, podname})),
      [
        undefined,
        undefined,
        undefined,
        'podname',
        'podname',
        'podname',
        'podname',
        'podname',
        'podname',
        'podname',
        'podname',
        'podname',
        'podname',
      ],
    );
  });

  it('F-0604 AC-35: a namespace and a container name are DNS-1123 labels: at most 63 characters, no dot, no edge dash', () => {
    const values = [
      'a',
      'kube-system',
      'a'.repeat(63),
      'a'.repeat(64),
      '',
      '-a',
      'a-',
      'a.b',
      'A',
      'a_b',
      '--context=other',
    ];
    function verdicts(member: 'namespace' | 'name') {
      return values.map(value => invalidMemberOf({...TARGET, [member]: value}));
    }
    deepStrictEqual(
      [verdicts('namespace'), verdicts('name')],
      [
        [
          undefined,
          undefined,
          undefined,
          ...Array<'namespace'>(8).fill('namespace'),
        ],
        [undefined, undefined, undefined, ...Array<'name'>(8).fill('name')],
      ],
    );
  });

  it('F-0604 AC-35: an image reference may not be empty or hold a control character', () => {
    deepStrictEqual(
      ['alpine:latest', 'ghcr.io/o/i@sha256:ab', '', 'a\nb'].map(image =>
        invalidMemberOf({...TARGET, image}),
      ),
      [undefined, undefined, 'image', 'image'],
    );
  });

  it('F-0604 BR-12: kubectl exec carries the pinned context and namespace in the --name=value form, the pod, the container and the command after --', () => {
    deepStrictEqual(kubectlExecArguments(TARGET, ['sh', '-c', 'echo hi']), [
      'exec',
      '-i',
      '--context=kind-lab',
      '--namespace=default',
      'web-1',
      '--container=app',
      '--',
      'sh',
      '-c',
      'echo hi',
    ]);
  });

  it('F-0604 AC-10, F-0504 AC-23: the label is the container, the pod and the image reference, with no namespace and no Dev Container wording', () => {
    deepStrictEqual(
      k8sLabelOf(TARGET, template => template),
      'app in web-1 (nginx:1.27)',
    );
  });
});
