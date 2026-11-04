import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  k8sAttachCommandsOf,
  type K8sAttachPorts,
  type K8sPickItem,
  type K8sSelection,
} from '../../src/attach/k8s-command.ts';
import type {K8sPod} from '../../src/attach/k8s-pods.ts';
import type {
  ContextAnswer,
  PodListing,
  PodRequest,
} from '../../src/engine/kubectl-host.ts';

const WEB_POD: K8sPod = {
  name: 'web',
  namespace: 'shop',
  containers: [{name: 'app', image: 'nginx:1'}],
};

const MULTI: K8sPod = {
  name: 'multi',
  namespace: 'shop',
  containers: [
    {name: 'zeta', image: 'img:z'},
    {name: 'alpha', image: 'img:a'},
  ],
};

interface PickerRecord {
  placeholder: string;
  items: Array<K8sPickItem<unknown>> | undefined;
  closed: boolean;
  reveals: number;
  /** Picks `index` among the filled items, or dismisses for none. */
  settle(index: number | undefined): void;
}

interface Scene {
  ports: K8sAttachPorts;
  events: string[];
  pickers: PickerRecord[];
  selections: K8sSelection[];
  listed: Array<PodRequest | undefined>;
  /** Settles the listing that is pending. */
  answerListing(listing: PodListing): void;
  aborted(): boolean[];
}

function sceneOf(
  options: {
    warning?: boolean;
    warningGate?: Promise<boolean>;
    listing?: PodListing;
    context?: ContextAnswer;
    information?: string | undefined;
  } = {},
): Scene {
  const events: string[] = [];
  const pickers: PickerRecord[] = [];
  const selections: K8sSelection[] = [];
  const listed: Array<PodRequest | undefined> = [];
  const signals: AbortSignal[] = [];
  let answer: ((listing: PodListing) => void) | undefined;
  const ports: K8sAttachPorts = {
    warning: () => {
      events.push('warning');
      return options.warningGate ?? Promise.resolve(options.warning ?? true);
    },
    listPods: (request, cancellation) => {
      listed.push(request);
      signals.push(cancellation);
      if (options.listing !== undefined) {
        return Promise.resolve(options.listing);
      }
      return new Promise(resolve => {
        answer = resolve;
        cancellation.addEventListener('abort', () => {
          resolve({kind: 'cancelled'});
        });
      });
    },
    currentContext: () =>
      Promise.resolve(options.context ?? {kind: 'context', name: 'kind-lab'}),
    openPicker: <Value>(placeholder: string) => {
      const gate: {settle: (value: Value | undefined) => void} = {
        settle: () => undefined,
      };
      const chosen = new Promise<Value | undefined>(resolve => {
        gate.settle = resolve;
      });
      const record: PickerRecord = {
        placeholder,
        items: undefined,
        closed: false,
        reveals: 0,
        settle: index => {
          gate.settle(
            index === undefined
              ? undefined
              : (record.items?.[index]?.value as Value),
          );
        },
      };
      pickers.push(record);
      return {
        fill: items => {
          record.items = [...items];
        },
        chosen,
        reveal: () => {
          record.reveals += 1;
        },
        close: () => {
          record.closed = true;
          gate.settle(undefined);
        },
      };
    },
    showError: (message, detail, button) => {
      events.push(`error ${message} | ${detail} | ${button}`);
      return Promise.resolve(button);
    },
    showInformation: (detail, buttons) => {
      events.push(`information ${detail} | ${buttons.join(', ')}`);
      return Promise.resolve(options.information);
    },
    revealLog: () => {
      events.push('log');
    },
    attach: selection => {
      selections.push(selection);
      return Promise.resolve();
    },
    translate: text => text,
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
  };
  return {
    ports,
    events,
    pickers,
    selections,
    listed,
    answerListing: listing => answer?.(listing),
    aborted: () => signals.map(signal => signal.aborted),
  };
}

/** Lets the promises that are ready run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

describe('Attach to Running Kubernetes Container (card containers-190, #2116)', () => {
  it('F-0604 AC-2, AC-18 (c190-warning): a warning that is not accepted ends the command before any picker or listing', async () => {
    const scene = sceneOf({warning: false});
    await k8sAttachCommandsOf(scene.ports).fromPalette();
    deepStrictEqual(
      [scene.events, scene.pickers.length, scene.listed],
      [['warning'], 0, []],
    );
  });

  it('F-0604 AC-6, AC-7 (c190-one-container): the pod picker opens busy with its placeholder, fills with label and namespace, and a pod with one container is attached at once', async () => {
    const scene = sceneOf({listing: {kind: 'listed', pods: [WEB_POD, MULTI]}});
    const done = k8sAttachCommandsOf(scene.ports).fromPalette();
    await settle();
    const picker = scene.pickers[0];
    const shown = picker?.items?.map(item => [item.label, item.description]);
    picker?.settle(0);
    await done;
    deepStrictEqual(
      {
        placeholder: picker?.placeholder,
        shown,
        pickers: scene.pickers.length,
        selections: scene.selections,
      },
      {
        placeholder: 'Select pod',
        shown: [
          ['web', 'shop'],
          ['multi', 'shop'],
        ],
        pickers: 1,
        selections: [
          {
            context: 'kind-lab',
            namespace: 'shop',
            podName: 'web',
            container: {name: 'app', image: 'nginx:1'},
          },
        ],
      },
    );
  });

  it('F-0604 AC-8 (c190-container-pick): a pod with two containers asks "Select container" with the spec order and each image', async () => {
    const scene = sceneOf({listing: {kind: 'listed', pods: [MULTI]}});
    const done = k8sAttachCommandsOf(scene.ports).fromPalette();
    await settle();
    scene.pickers[0]?.settle(0);
    await settle();
    const second = scene.pickers[1];
    const shown = second?.items?.map(item => [item.label, item.description]);
    second?.settle(1);
    await done;
    deepStrictEqual(
      [
        second?.placeholder,
        shown,
        scene.selections.map(each => each.container.name),
      ],
      [
        'Select container',
        [
          ['zeta', 'img:z'],
          ['alpha', 'img:a'],
        ],
        ['alpha'],
      ],
    );
  });

  it('F-0604 AC-19 (c190-escape): dismissing the pod picker or the container picker ends the command with nothing attached', async () => {
    const podPicker = sceneOf({listing: {kind: 'listed', pods: [MULTI]}});
    const first = k8sAttachCommandsOf(podPicker.ports).fromPalette();
    await settle();
    podPicker.pickers[0]?.settle(undefined);
    await first;
    const container = sceneOf({listing: {kind: 'listed', pods: [MULTI]}});
    const second = k8sAttachCommandsOf(container.ports).fromPalette();
    await settle();
    container.pickers[0]?.settle(0);
    await settle();
    container.pickers[1]?.settle(undefined);
    await second;
    deepStrictEqual(
      [
        podPicker.selections,
        container.selections,
        podPicker.events,
        container.events,
      ],
      [[], [], ['warning'], ['warning']],
    );
  });

  it('F-0604 AC-4, AC-23 (c190-failed): a listing that fails closes the picker, shows S173 with the detail and one OK, then reveals the log', async () => {
    const scene = sceneOf({
      listing: {kind: 'failed', detail: 'spawn kubectl ENOENT'},
    });
    await k8sAttachCommandsOf(scene.ports).fromPalette();
    deepStrictEqual(
      [scene.events, scene.pickers[0]?.closed, scene.selections],
      [
        [
          'warning',
          'error Error while attaching to Kubernetes container. | spawn kubectl ENOENT | OK',
          'log',
        ],
        true,
        [],
      ],
    );
  });

  it('F-0604 AC-5 (c190-no-pods): no pods shows the information with Cancel and Show Log, and Show Log reveals the log', async () => {
    const shown = sceneOf({
      listing: {kind: 'listed', pods: []},
      information: 'Show Log',
    });
    const cancelled = sceneOf({
      listing: {kind: 'listed', pods: []},
      information: undefined,
    });
    await k8sAttachCommandsOf(shown.ports).fromPalette();
    await k8sAttachCommandsOf(cancelled.ports).fromPalette();
    deepStrictEqual(
      [shown.events, shown.pickers[0]?.closed, cancelled.events],
      [
        ['warning', 'information No pods found. | Cancel, Show Log', 'log'],
        true,
        ['warning', 'information No pods found. | Cancel, Show Log'],
      ],
    );
  });

  it('F-0604 AC-29, AC-19 (c190-wait): the picker is open before kubectl answers, Escape cancels the listing, and nothing is shown after', async () => {
    const scene = sceneOf();
    const done = k8sAttachCommandsOf(scene.ports).fromPalette();
    await settle();
    const before = [scene.pickers.length, scene.pickers[0]?.items];
    scene.pickers[0]?.settle(undefined);
    await done;
    deepStrictEqual(
      [before, scene.aborted(), scene.events, scene.selections],
      [[1, undefined], [true], ['warning'], []],
    );
  });

  it('F-0604 AC-30 (c190-second-invocation): a second invocation while one is pending shows the same picker, lists once and attaches once', async () => {
    const scene = sceneOf();
    const commands = k8sAttachCommandsOf(scene.ports);
    const first = commands.fromPalette();
    await settle();
    const second = commands.fromPalette();
    await settle();
    scene.answerListing({kind: 'listed', pods: [WEB_POD]});
    await settle();
    scene.pickers[0]?.settle(0);
    await Promise.all([first, second]);
    deepStrictEqual(
      {
        pickers: scene.pickers.length,
        reveals: scene.pickers[0]?.reveals,
        listings: scene.listed.length,
        warnings: scene.events.filter(each => each === 'warning').length,
        attached: scene.selections.length,
      },
      {pickers: 1, reveals: 1, listings: 1, warnings: 1, attached: 1},
    );
  });

  it('F-0604 AC-30 (c190-second-during-warning): a second invocation while the warning is still showing waits for the same run and shows no second warning', async () => {
    const gate: {accept: (answer: boolean) => void} = {
      accept: () => undefined,
    };
    const scene = sceneOf({
      warningGate: new Promise<boolean>(resolve => {
        gate.accept = resolve;
      }),
      listing: {kind: 'listed', pods: [WEB_POD]},
    });
    const commands = k8sAttachCommandsOf(scene.ports);
    const first = commands.fromPalette();
    const second = commands.fromPalette();
    await settle();
    gate.accept(true);
    await settle();
    scene.pickers[0]?.settle(0);
    await Promise.all([first, second]);
    deepStrictEqual(
      [
        scene.events.filter(each => each === 'warning').length,
        scene.pickers.length,
        scene.selections.length,
      ],
      [1, 1, 1],
    );
  });

  it('F-0604 AC-30 (c190-after-pending): once a run has ended the next one starts afresh', async () => {
    const scene = sceneOf({listing: {kind: 'failed', detail: 'x'}});
    const commands = k8sAttachCommandsOf(scene.ports);
    await commands.fromPalette();
    await commands.fromPalette();
    deepStrictEqual(scene.listed.length, 2);
  });

  it('F-0604 AC-17 (c190-viewlet): a row that names a pod skips the pod picker, lists that pod alone and attaches its only container', async () => {
    const scene = sceneOf({listing: {kind: 'listed', pods: [WEB_POD]}});
    await k8sAttachCommandsOf(scene.ports).fromViewlet({
      name: 'web',
      namespace: 'shop',
    });
    deepStrictEqual(
      [
        scene.listed,
        scene.pickers.length,
        scene.selections.map(each => each.podName),
      ],
      [[{name: 'web', namespace: 'shop'}], 0, ['web']],
    );
  });

  it('F-0604 AC-22 (c190-viewlet-container): from a row, the container pick says "Choose Container"', async () => {
    const scene = sceneOf({listing: {kind: 'listed', pods: [MULTI]}});
    const done = k8sAttachCommandsOf(scene.ports).fromViewlet({name: 'multi'});
    await settle();
    scene.pickers[0]?.settle(0);
    await done;
    deepStrictEqual(
      [
        scene.pickers[0]?.placeholder,
        scene.selections.map(each => each.container.name),
      ],
      ['Choose Container', ['zeta']],
    );
  });

  it('F-0604 AC-22 (c190-viewlet-fallback): without a usable row the palette’s two pickers are used, and an invalid name never reaches kubectl', async () => {
    const none = sceneOf({listing: {kind: 'listed', pods: [WEB_POD]}});
    const invalid = sceneOf({listing: {kind: 'listed', pods: [WEB_POD]}});
    const first = k8sAttachCommandsOf(none.ports).fromViewlet(undefined);
    await settle();
    none.pickers[0]?.settle(0);
    await first;
    const second = k8sAttachCommandsOf(invalid.ports).fromViewlet({
      name: '--context=evil',
    });
    await settle();
    invalid.pickers[0]?.settle(undefined);
    await second;
    deepStrictEqual(
      [none.pickers[0]?.placeholder, none.listed, invalid.listed],
      ['Select pod', [undefined], [undefined]],
    );
  });

  it('F-0604 AC-4 (c190-viewlet-failed): a pod that kubectl can’t give is the listing’s failure, and a context that is not set fails the pick the same way', async () => {
    const failed = sceneOf({listing: {kind: 'failed', detail: 'gone'}});
    await k8sAttachCommandsOf(failed.ports).fromViewlet({name: 'web'});
    const noContext = sceneOf({
      listing: {kind: 'listed', pods: [WEB_POD]},
      context: {kind: 'failed', detail: 'no context'},
    });
    await k8sAttachCommandsOf(noContext.ports).fromViewlet({name: 'web'});
    deepStrictEqual(
      [failed.events.slice(1), noContext.events.slice(1), noContext.selections],
      [
        [
          'error Error while attaching to Kubernetes container. | gone | OK',
          'log',
        ],
        [
          'error Error while attaching to Kubernetes container. | no context | OK',
          'log',
        ],
        [],
      ],
    );
  });

  it('F-0604 AC-27 (c190-no-containers): a pod that lists no container ends with nothing attached', async () => {
    const scene = sceneOf({
      listing: {
        kind: 'listed',
        pods: [{name: 'empty', namespace: 'shop', containers: []}],
      },
    });
    const done = k8sAttachCommandsOf(scene.ports).fromPalette();
    await settle();
    scene.pickers[0]?.settle(0);
    await done;
    deepStrictEqual(scene.selections, []);
  });

  it('F-0604 AC-17 (c190-viewlet-gone): a row whose pod the listing no longer holds ends with nothing attached', async () => {
    const scene = sceneOf({listing: {kind: 'cancelled'}});
    await k8sAttachCommandsOf(scene.ports).fromViewlet({name: 'web'});
    deepStrictEqual(scene.selections, []);
  });
});
