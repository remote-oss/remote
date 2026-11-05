import {deepStrictEqual} from 'node:assert';
import {
  type ConnectPhase,
  type Connected,
  type DecodedTarget,
  encodeAuthority,
  type Failed,
  type ResourceLabelFormatter,
} from 'lib-authority';
import {recordingResolverEditor} from 'lib-authority/testing/recording-resolver-editor';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {k8sPayloadOf} from '../../src/attach/k8s-payload.ts';
import {k8sPickKeyOf} from '../../src/attach/k8s-pick-record.ts';
import {attachedPayloadOf} from '../../src/attach/payload.ts';
import {attachPickKeyOf} from '../../src/attach/pick-record.ts';
import type {ContainerConnector} from '../../src/connect/connector.ts';
import {
  attachedNotFound,
  attachedNotRunning,
  attachFailed,
} from '../../src/connect/failures.ts';
import {
  type AttachedFamily,
  attachedContainerFamilyOf,
  type ConnectorRegistrationHost,
  k8sContainerFamilyOf,
  registerAttachedResolver,
} from '../../src/connect/register-connector.ts';
import {CONTAINERS_DOCUMENTATION} from '../../src/surfaces/recovery-presenter.ts';
import {inertRecoveryPorts} from './inert-recovery-ports.ts';

const TARGET = {containerName: '/web', context: 'remote'};
const PAYLOAD = attachedPayloadOf(TARGET);
const PICK_KEY = attachPickKeyOf(TARGET);
const POD_TARGET = {
  context: 'kind-lab',
  podname: 'web-1',
  namespace: 'default',
  name: 'app',
  image: 'nginx',
};
const POD_PAYLOAD = k8sPayloadOf(POD_TARGET);
const POD_KEY = k8sPickKeyOf(POD_TARGET);

const CONNECTED: Connected = {
  address: {host: '127.0.0.1', port: 4321},
  connectionToken: 'token',
  extensionHostEnv: {},
  environmentTunnels: [],
  trusted: true,
};

/** A family that names its targets by their payload and labels a disconnected window `Pod <payload>`. */
const POD_FAMILY: AttachedFamily = {
  family: 'k8s-container',
  pickKeyOf: payload => (payload === 'none' ? undefined : `pod ${payload}`),
  disconnectedSuffixOf: decoded =>
    decoded !== undefined &&
    'payload' in decoded.target &&
    decoded.target.payload !== 'none'
      ? `Pod ${decoded.target.payload}`
      : undefined,
};

/** A connector whose every member does nothing and answers nothing, for a row to put its own members on. */
function quietConnector(): Record<string, () => unknown> {
  const members: Record<string, () => unknown> = {};
  for (const name of [
    'cancel',
    'revealDetails',
    'announceShutdown',
    'heldConnection',
    'failedContainer',
    'heldIdentity',
    'attemptIdentity',
    'heldPorts',
  ]) {
    members[name] = () => undefined;
  }
  for (const name of [
    'onHeldChanged',
    'onTransportLost',
    'onTransportClosed',
  ]) {
    members[name] = () => () => undefined;
  }
  for (const name of ['leaveShutdown', 'canonicalPathOf']) {
    members[name] = () => Promise.resolve(undefined);
  }
  return members;
}

/** A registration of the attached families over fakes; `family` and the picks are the test's. */
async function registeredWith(
  options: {
    picks?: string[];
    confirm?: boolean;
    answer?: Connected | Failed;
    button?: string;
    /** What the quick picks of More Actions... answer in turn. */
    pickAnswers?: string[];
    family?: (connector: ContainerConnector) => AttachedFamily;
    container?: {image: string; name: string};
  } = {},
) {
  const events: string[] = [];
  const picks = new Set(options.picks ?? []);
  const pickAnswers = [...(options.pickAnswers ?? [])];
  const formatters: ResourceLabelFormatter[] = [];
  const connects: string[] = [];
  const recording = recordingResolverEditor(events);
  const listeners: Array<(phase: ConnectPhase) => void> = [];
  const connector = Object.assign(quietConnector(), {
    connect: () => {
      for (const listener of listeners) {
        listener({name: 'installing'});
      }
      connects.push('connect');
      recording.fireTimers();
      return Promise.resolve(options.answer ?? CONNECTED);
    },
    attachedContainer: () =>
      options.container === undefined
        ? undefined
        : {...options.container, id: 'a'.repeat(64)},
    startAttachedContainer: () => {
      events.push('startContainer');
      return Promise.resolve(false);
    },
    onPhase: (listener: (phase: ConnectPhase) => void) => {
      listeners.push(listener);
      return () => undefined;
    },
  }) as unknown as ContainerConnector;
  const host = {
    resolverEditor: recording.editor,
    labels: {
      registerResourceLabelFormatter: (formatter: ResourceLabelFormatter) => {
        formatters.push(formatter);
        return {dispose: () => undefined};
      },
    },
    presenter: inertRecoveryPorts({
      showError: () => Promise.resolve(options.button),
      pick: () => Promise.resolve(pickAnswers.shift()),
      later: task => {
        task();
      },
      closeRemote: () => {
        events.push('closeRemote');
        return Promise.resolve();
      },
      reloadWindow: () => {
        events.push('reload');
        return Promise.resolve();
      },
      openRecent: () => {
        events.push('openRecent');
        return Promise.resolve();
      },
      openExternal: address => {
        events.push(`open ${address}`);
        return Promise.resolve();
      },
    }),
    translate: (template: string) => template,
  } as unknown as ConnectorRegistrationHost;
  const questions: string[] = [];
  const result = await registerAttachedResolver(
    host,
    connector,
    {
      resolversGranted: true,
      revealLog: () => undefined,
      logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    },
    {
      chooseContainer: () => {
        events.push('chooseContainer');
        return Promise.resolve();
      },
      picked: key => picks.has(key),
      record: key => {
        picks.add(key);
        events.push(`record ${key}`);
        return Promise.resolve();
      },
      confirm: () => {
        questions.push('warning');
        return Promise.resolve(options.confirm ?? true);
      },
    },
    options.family?.(connector) ?? attachedContainerFamilyOf(connector, t => t),
  );
  /** Resolves the authority as the editor does; a refusal or a failure is the resolver's error, which the rows don't read. */
  async function resolve(authority: string, resolveAttempt: number) {
    try {
      await recording.registered()?.resolve(authority, {resolveAttempt});
    } catch {
      events.push('refused');
    }
  }
  return {
    result,
    events,
    connects,
    questions,
    formatters,
    picks,
    recording,
    resolve,
    /** Lets the quick pick that a dialog queued run to its end. */
    settle: () => new Promise(resolve => setImmediate(resolve)),
    dispose: () => {
      result.dispose();
    },
  };
}

function authorityOf(
  family: 'attached-container' | 'k8s-container',
  payload: string,
): string {
  return encodeAuthority({
    family,
    target: {payload},
    rawHostString: payload,
  });
}

/** Resolves the authority twice and gives the questions asked, the connects made and the picks recorded. */
async function resolvedTwice(
  seen: Awaited<ReturnType<typeof registeredWith>>,
  authority: string,
): Promise<[string[], string[], string[]]> {
  await seen.resolve(authority, 1);
  await seen.resolve(authority, 2);
  return [seen.questions, seen.connects, [...seen.picks]];
}

describe('the registration of the attached families (card containers-163, ruling-2186-attach-gate)', () => {
  it('F-0601 AC-1 (c163-gate-unpicked): a target the user never picked shows the warning first, and nothing connects before the answer', async () => {
    const seen = await registeredWith({confirm: false});
    await seen.resolve(authorityOf('attached-container', PAYLOAD), 1);
    deepStrictEqual(
      [seen.questions, seen.connects, seen.picks.size],
      [['warning'], [], 0],
    );
  });

  it('F-0601 AC-1 (c163-gate-confirm): confirming connects and records the target, and a second resolve asks nothing', async () => {
    const seen = await registeredWith({confirm: true});
    deepStrictEqual(
      await resolvedTwice(seen, authorityOf('attached-container', PAYLOAD)),
      [['warning'], ['connect', 'connect'], [PICK_KEY]],
    );
  });

  it('F-0601 AC-1 (c163-gate-picked): a target the command recorded connects with no question', async () => {
    const seen = await registeredWith({picks: [PICK_KEY]});
    await seen.resolve(authorityOf('attached-container', PAYLOAD), 1);
    deepStrictEqual([seen.questions, seen.connects], [[], ['connect']]);
  });

  it('F-0601 AC-1 (c163-gate-key): the pick is the container’s name and its engine, whatever the working folder, and a payload of another shape is malformed here: refused with no question, and the connector is never reached', async () => {
    const walked = attachedPayloadOf({...TARGET, cwd: '//wsl$/distro'});
    const seen = await registeredWith({picks: [PICK_KEY]});
    await seen.resolve(authorityOf('attached-container', walked), 1);
    await seen.resolve(authorityOf('attached-container', 'zz'), 2);
    deepStrictEqual([seen.questions, seen.connects], [[], ['connect']]);
  });

  it('F-0604 AC-1 (c163-family): another family registers its own authority, names its picks and labels its disconnected window by its own rules', async () => {
    const seen = await registeredWith({
      family: () => POD_FAMILY,
      answer: attachFailed(),
      button: 'More Actions...',
    });
    await seen.resolve(authorityOf('k8s-container', 'abc'), 1);
    await seen.resolve(authorityOf('k8s-container', 'abc'), 2);
    await seen.resolve(authorityOf('k8s-container', 'none'), 3);
    deepStrictEqual(
      [
        seen.events.filter(line => line.startsWith('register ')),
        seen.questions,
        [...seen.picks],
        seen.formatters.length > 0,
      ],
      [['register k8s-container'], ['warning'], ['pod abc'], true],
    );
  });

  it('F-0601 AC-33 (c163-disconnected-label): a failure that leaves an attached window disconnected labels it with the container the attempt found, and with nothing when the payload names none', async () => {
    const found = await registeredWith({
      picks: [PICK_KEY],
      answer: attachFailed(),
      button: 'More Actions...',
      container: {image: 'nginx:1', name: 'web'},
    });
    await found.resolve(authorityOf('attached-container', PAYLOAD), 1);
    const absent = await registeredWith({
      picks: [PICK_KEY],
      answer: attachFailed(),
      button: 'More Actions...',
    });
    await absent.resolve(authorityOf('attached-container', PAYLOAD), 1);
    deepStrictEqual(
      [
        found.formatters.map(each => JSON.stringify(each).includes('nginx:1')),
        absent.formatters.length,
      ],
      [[true], 1],
    );
  });

  it('F-0601 AC-32, AC-33, AC-35 (c163-presenter): the shared presenter acts through the host: Start Container, Choose Container, Close Remote, and the quick pick of More Actions... with Reload Window, Open Recent and Open Documentation', async () => {
    const calls: string[] = [];
    const cases: Array<[Failed, string, string[]]> = [
      [attachedNotRunning('nginx:1', 'web', ''), 'Start Container', []],
      [attachedNotFound('/web'), 'Choose Container', []],
      [attachFailed(), 'Close Remote', []],
      [attachFailed(), 'More Actions...', ['Reload Window']],
      [attachFailed(), 'More Actions...', ['Open Recent...']],
      [
        attachFailed(),
        'More Actions...',
        ['Open Documentation', 'Open Documentation'],
      ],
    ];
    for (const [answer, button, pickAnswers] of cases) {
      const seen = await registeredWith({
        picks: [PICK_KEY],
        answer,
        button,
        pickAnswers,
      });
      await seen.resolve(authorityOf('attached-container', PAYLOAD), 1);
      await seen.settle();
      seen.dispose();
      calls.push(
        seen.events
          .filter(
            line =>
              !/^(register|unregister|progress|phase|timer|notAvailable|temporarilyNotAvailable|refused)/.test(
                line,
              ),
          )
          .join(', '),
      );
    }
    deepStrictEqual(calls, [
      'startContainer, reload',
      'chooseContainer',
      'closeRemote',
      'reload',
      'openRecent',
      `open ${CONTAINERS_DOCUMENTATION}, open ${CONTAINERS_DOCUMENTATION}`,
    ]);
  });

  it('F-0601 AC-1 (c163-family-container): the attached container family names no pick for a payload that is no target, and no label for a target that is no payload', () => {
    const family = attachedContainerFamilyOf(
      {
        attachedContainer: () => undefined,
      } as unknown as ContainerConnector,
      template => template,
    );
    deepStrictEqual(
      [
        family.pickKeyOf('zz'),
        family.pickKeyOf(PAYLOAD),
        family.disconnectedSuffixOf({
          family: 'attached-container',
          target: {},
          rawHostString: 'x',
        } as unknown as DecodedTarget),
        family.disconnectedSuffixOf({
          family: 'attached-container',
          target: {payload: 'zz'},
          rawHostString: 'zz',
        }),
        family.disconnectedSuffixOf(undefined),
      ],
      [undefined, PICK_KEY, undefined, undefined, undefined],
    );
  });

  it('F-0604 AC-35 (c191-pod-gate-unpicked): a pod the user never picked shows the warning first, and nothing connects when it is declined', async () => {
    const seen = await registeredWith({
      confirm: false,
      family: () => k8sContainerFamilyOf(t => t),
    });
    await seen.resolve(authorityOf('k8s-container', POD_PAYLOAD), 1);
    deepStrictEqual(
      [seen.questions, seen.connects, seen.picks.size],
      [['warning'], [], 0],
    );
  });

  it('F-0604 AC-35 (c191-pod-gate-confirm): confirming connects and records the pod by context, namespace, pod and container, and a second resolve asks nothing', async () => {
    const seen = await registeredWith({
      family: () => k8sContainerFamilyOf(t => t),
    });
    deepStrictEqual(
      await resolvedTwice(seen, authorityOf('k8s-container', POD_PAYLOAD)),
      [['warning'], ['connect', 'connect'], [POD_KEY]],
    );
  });

  it('F-0604 AC-35 (c191-pod-gate-picked): a pod the command recorded connects with no question', async () => {
    const seen = await registeredWith({
      picks: [POD_KEY],
      family: () => k8sContainerFamilyOf(t => t),
    });
    await seen.resolve(authorityOf('k8s-container', POD_PAYLOAD), 1);
    deepStrictEqual([seen.questions, seen.connects], [[], ['connect']]);
  });

  it('F-0604 AC-35 (c191-pod-shapes): the pod authority decodes only a pod payload: an attached payload, a pod with a bad member and a payload that is no hex are refused with no question and the connector is never reached', async () => {
    const seen = await registeredWith({
      family: () => k8sContainerFamilyOf(t => t),
    });
    await seen.resolve(authorityOf('k8s-container', PAYLOAD), 1);
    await seen.resolve(
      authorityOf(
        'k8s-container',
        k8sPayloadOf({...POD_TARGET, namespace: '-x'}),
      ),
      2,
    );
    await seen.resolve(authorityOf('k8s-container', 'zz'), 3);
    deepStrictEqual([seen.questions, seen.connects], [[], []]);
  });

  it('F-0604 AC-35 (c191-pod-on-attached): a pod payload on the attached authority is malformed: refused with no question, and the connector is never reached', async () => {
    const seen = await registeredWith({});
    await seen.resolve(authorityOf('attached-container', POD_PAYLOAD), 1);
    deepStrictEqual([seen.questions, seen.connects], [[], []]);
  });

  it('F-0604 AC-35 (c191-pod-family): the pod family names a pick for a pod and none for another payload, and labels a disconnected window with the container, the pod and the image', () => {
    const family = k8sContainerFamilyOf(template => template);
    deepStrictEqual(
      [
        family.pickKeyOf(POD_PAYLOAD),
        family.pickKeyOf('zz'),
        family.disconnectedSuffixOf({
          family: 'k8s-container',
          target: {payload: POD_PAYLOAD},
          rawHostString: POD_PAYLOAD,
        }),
        family.disconnectedSuffixOf({
          family: 'k8s-container',
          target: {payload: 'zz'},
          rawHostString: 'zz',
        }),
        family.disconnectedSuffixOf({
          family: 'k8s-container',
          target: {},
          rawHostString: 'x',
        } as unknown as DecodedTarget),
        family.disconnectedSuffixOf(undefined),
      ],
      [
        POD_KEY,
        undefined,
        'app in web-1 (nginx)',
        undefined,
        undefined,
        undefined,
      ],
    );
  });
});
