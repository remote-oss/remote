import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {HeldConnection} from '../../src/connect/connector.ts';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import type {DetailsRow} from '../../src/explorer/details-model.ts';
import {
  type DetailsProvider,
  type DetailsView,
  type DetailsViewPorts,
  detailsSpecOf,
  showDetails,
  showDetailsWhenRegistered,
} from '../../src/explorer/details-view.ts';
import {sharedContainerEvents} from '../../src/explorer/targets-events.ts';
import {contextKeys, views} from '../../src/identifiers.generated.ts';
import {fakeEngine, type FakeEngine} from './fake-engine.ts';
import {pendingOf, settled} from './pending.ts';

const RECORDED = readFileSync(
  path.join(
    import.meta.dirname,
    '..',
    'fixtures',
    'docker-inspect-details.json',
  ),
  'utf8',
);

const SHOW_KEY = contextKeys.remoteContainersShowDetails.id;
const CONTAINER = 'a1a1a1a1a1a1';

/** What a row steers, and what the fakes recorded. */
interface Scene {
  commands: string[];
  held: HeldConnection | undefined;
  /** What `docker inspect` answers; a function when a row holds the answer. */
  answer: () => EngineRunOutcome | Promise<EngineRunOutcome>;
  contextFailure: Error | undefined;
  runs: string[][];
  signals: AbortSignal[];
  contexts: Array<[string, boolean]>;
  titles: Array<string | undefined>;
  created: Array<{viewId: string; provider: DetailsProvider}>;
  visibility: Array<(visible: boolean) => void>;
  heldListeners: Set<() => void>;
  changes: number;
  timers: Array<{milliseconds: number; callback: () => void}>;
  disposed: string[];
  /** The fake `docker` whose spawns are the events processes. */
  docker: FakeEngine;
  sink: MemorySink;
}

function sceneOf(): Scene {
  return {
    commands: [`${views.detailsContainers}.focus`],
    held: undefined,
    answer: () => ({kind: 'ran', status: 0, stdout: RECORDED, stderr: ''}),
    contextFailure: undefined,
    runs: [],
    signals: [],
    contexts: [],
    titles: [],
    created: [],
    visibility: [],
    heldListeners: new Set(),
    changes: 0,
    timers: [],
    disposed: [],
    docker: fakeEngine(),
    sink: new MemorySink(),
  };
}

function engineOf(scene: Scene): EngineHost {
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (argv, input, options) => {
      scene.runs.push([...argv]);
      scene.signals.push(options.cancellation);
      return Promise.resolve(scene.answer());
    },
    spawn: (argv, options) => scene.docker.spawn(argv, options),
  };
}

function connectionOf(scene: Scene): HeldConnection {
  return {
    containerId: CONTAINER,
    hostPath: '/tmp/c33w',
    remoteWorkspaceFolder: '/workspaces/c33w',
    engine: engineOf(scene),
  };
}

/** Makes the connection of the scene known to the view, as the connector does. */
function connect(scene: Scene, held: HeldConnection | undefined): void {
  scene.held = held;
  for (const listener of [...scene.heldListeners]) {
    listener();
  }
}

/** The tree view the fake editor makes: it records what the view does to it. */
function treeViewOver(scene: Scene, viewId: string, provider: DetailsProvider) {
  scene.created.push({viewId, provider});
  const changes = provider.onDidChangeTreeData(() => {
    scene.changes += 1;
  });
  return {
    setTitle: (title: string | undefined) => scene.titles.push(title),
    onDidChangeVisibility: (listener: (visible: boolean) => void) => {
      scene.visibility.push(listener);
      return {dispose: () => scene.disposed.push('visibility')};
    },
    dispose: () => {
      scene.disposed.push('view');
      changes.dispose();
    },
  };
}

/** What the fake editor does when a context key is set: it records the key, and fails when the scene says so. */
function contextSetOn(
  scene: Scene,
  key: string,
  value: boolean,
): Promise<void> {
  scene.contexts.push([key, value]);
  const failure = scene.contextFailure;
  return failure === undefined ? Promise.resolve() : Promise.reject(failure);
}

function portsOf(scene: Scene): DetailsViewPorts {
  return {
    editor: {
      commandIds: () => Promise.resolve(scene.commands),
      setContext: (key, value) => contextSetOn(scene, key, value),
      createTreeView: (viewId, provider) =>
        treeViewOver(scene, viewId, provider),
    },
    held: () => scene.held,
    events: sharedContainerEvents({
      engine: () => scene.held?.engine,
      setTimer: (milliseconds, callback) => {
        scene.timers.push({milliseconds, callback});
        return () => {
          scene.timers.pop();
        };
      },
      logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
    }),
    setTimer: (milliseconds, callback) => {
      scene.timers.push({milliseconds, callback});
      return () => {
        scene.timers.pop();
      };
    },
    onHeldChanged: listener => {
      scene.heldListeners.add(listener);
      return () => {
        scene.heldListeners.delete(listener);
        scene.disposed.push('held');
      };
    },
    translate: template => template,
    logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
  };
}

/** The view shown over the scene; it fails when the editor had no view to make. */
async function shown(
  scene: Scene,
): Promise<{view: DetailsView; provider: DetailsProvider}> {
  const view = await showDetails(portsOf(scene));
  const provider = scene.created[0]?.provider;
  if (view === undefined || provider === undefined) {
    throw new Error('no view was shown');
  }
  await settled();
  return {view, provider};
}

/** The labels of the sections and of the rows under them. */
async function labelsOf(provider: DetailsProvider): Promise<string[]> {
  const sections = await provider.getChildren(undefined);
  const rows = await Promise.all(
    sections.map(section => provider.getChildren(section)),
  );
  return [
    ...sections.map(section => section.label),
    ...rows.flat().map(node => node.label),
  ];
}

function lines(scene: Scene): string[] {
  return scene.sink.lines.map(line => `${line.level}: ${line.message}`);
}

/** The view shown over a scene with a connection, and the next read held until the row settles it. */
async function shownThenHeld(scene: Scene) {
  scene.held = connectionOf(scene);
  const shownView = await shown(scene);
  const hold = pendingOf<EngineRunOutcome>();
  scene.answer = () => hold.promise;
  return {...shownView, hold};
}

describe('the Details view (card containers-33)', () => {
  it('F-0903 §16: without the view’s focus command the view is not made', async () => {
    const scene = sceneOf();
    scene.commands = [];
    deepStrictEqual(
      [await showDetails(portsOf(scene)), scene.created.length],
      [undefined, 0],
    );
  });

  it('#995: the view is made when core registers it, looked for again every second until then', async () => {
    const scene = sceneOf();
    scene.commands = [];
    const view = showDetailsWhenRegistered(portsOf(scene));
    await settled();
    const waiting = [
      scene.timers.map(timer => timer.milliseconds),
      scene.created.length,
    ];
    scene.commands = [`${views.detailsContainers}.focus`];
    scene.timers[0]?.callback();
    await settled();
    view.dispose();
    deepStrictEqual([waiting, scene.created.length], [[[1000], 0], 1]);
  });

  it('F-0903 AC-1, 6.4: with a connection the key is true, the container is read once by its id with nothing else, and the title and the rows are its', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    const {provider} = await shown(scene);
    deepStrictEqual(
      [
        scene.created[0]?.viewId,
        scene.contexts,
        scene.runs,
        scene.titles,
        await labelsOf(provider),
      ],
      [
        views.detailsContainers,
        [[SHOW_KEY, true]],
        [['inspect', '--type', 'container', CONTAINER]],
        ['c33w'],
        [
          'Attributes',
          'Mounts',
          'Name',
          'Image',
          'Configuration',
          'Volume mount',
          'Volume mount',
          'Bind mount',
        ],
      ],
    );
  });

  it('F-0903 BR-6: with no connection the key is false, the title is the registered name and there is nothing to show', async () => {
    const scene = sceneOf();
    const {provider} = await shown(scene);
    deepStrictEqual(
      [scene.contexts, scene.runs, scene.titles, await labelsOf(provider)],
      [[[SHOW_KEY, false]], [], [undefined], []],
    );
  });

  it('F-0903 AC-29, 7.E1: a container that is gone shows no rows, gives back the registered title, keeps the key and says nothing but in the log', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    const {view, provider} = await shown(scene);
    scene.answer = () => ({kind: 'ran', status: 1, stdout: '[]', stderr: ''});
    await view.refresh();
    deepStrictEqual(
      [
        scene.titles,
        await labelsOf(provider),
        scene.contexts.at(-1),
        lines(scene),
      ],
      [
        ['c33w', undefined],
        [],
        [SHOW_KEY, true],
        ['info: the container could not be read: exit status 1'],
      ],
    );
  });

  it('F-0903 7.E2: an engine that cannot be run shows no rows and says why in the log', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    scene.answer = () => ({kind: 'failed', detail: 'no docker'});
    const {provider} = await shown(scene);
    deepStrictEqual(
      [await labelsOf(provider), lines(scene)],
      [[], ['info: the container could not be read: no docker']],
    );
  });

  it('F-0903 AC-35, 7.E8: Refresh only reads, one inspect of the shown id, and replaces the tree in one change', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    const {view} = await shown(scene);
    const before = scene.changes;
    await view.refresh();
    deepStrictEqual(
      [scene.runs.map(argv => argv[0]), scene.changes - before],
      [['inspect', 'inspect'], 1],
    );
  });

  it('F-0903 AC-8: a connection made, replaced or given back reads again, and the key follows', async () => {
    const scene = sceneOf();
    const {provider} = await shown(scene);
    connect(scene, connectionOf(scene));
    await settled();
    const shownLabels = await labelsOf(provider);
    connect(scene, undefined);
    await settled();
    deepStrictEqual(
      [
        shownLabels.length > 0,
        await labelsOf(provider),
        scene.contexts,
        scene.titles,
      ],
      [
        true,
        [],
        [
          [SHOW_KEY, false],
          [SHOW_KEY, true],
          [SHOW_KEY, false],
        ],
        [undefined, 'c33w', undefined],
      ],
    );
  });

  it('F-0903 BR-6: becoming visible reads, and becoming hidden does not', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    await shown(scene);
    const before = scene.runs.length;
    scene.visibility[0]?.(false);
    await settled();
    const hidden = scene.runs.length - before;
    scene.visibility[0]?.(true);
    await settled();
    deepStrictEqual([hidden, scene.runs.length - before], [0, 1]);
  });

  it('F-0903: a read that is running is joined, so two refreshes make one inspect', async () => {
    const scene = sceneOf();
    const {view, hold} = await shownThenHeld(scene);
    const before = scene.runs.length;
    const first = view.refresh();
    const second = view.refresh();
    hold.resolve({kind: 'ran', status: 0, stdout: RECORDED, stderr: ''});
    await Promise.all([first, second]);
    deepStrictEqual(scene.runs.length - before, 1);
  });

  it('F-0903 BR-6: the tree that was shown stays until the next one is ready', async () => {
    const scene = sceneOf();
    const {view, provider, hold} = await shownThenHeld(scene);
    const reading = view.refresh();
    await settled();
    const during = await labelsOf(provider);
    hold.resolve({kind: 'ran', status: 1, stdout: '', stderr: ''});
    await reading;
    deepStrictEqual([during.length > 0, await labelsOf(provider)], [true, []]);
  });

  it('F-0903: a context key that cannot be set is logged, and the view goes on', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    scene.contextFailure = new Error('no context');
    await shown(scene);
    deepStrictEqual(lines(scene), [
      'error: the Details view could not be updated: no context',
    ]);
  });

  it('F-0903: a failure that is not an error is logged as text', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the row feeds a rejection that is not an Error
    scene.answer = () => Promise.reject('plain');
    await shown(scene);
    deepStrictEqual(lines(scene), [
      'error: the Details view could not be updated: plain',
    ]);
  });

  it('F-0903: disposing stops the reads, gives back the view and the listeners, and aborts a read that is running', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    const {view} = await shown(scene);
    view.dispose();
    view.dispose();
    const before = scene.runs.length;
    for (const listener of [...scene.heldListeners]) {
      listener();
    }
    deepStrictEqual(
      [
        scene.disposed,
        scene.runs.length - before,
        scene.signals.every(signal => signal.aborted),
      ],
      [['held', 'visibility', 'view'], 0, true],
    );
  });

  it('F-0903: a read that ends after the view was disposed changes nothing', async () => {
    const scene = sceneOf();
    const {view, hold} = await shownThenHeld(scene);
    const reading = view.refresh();
    await settled();
    view.dispose();
    hold.resolve({kind: 'ran', status: 0, stdout: RECORDED, stderr: ''});
    await reading;
    deepStrictEqual([scene.titles, scene.changes], [['c33w'], 1]);
  });

  it('#1001: the view starts the shared events process while it is visible, an event reads the container again, and hiding the view ends the process', async () => {
    const scene = sceneOf();
    scene.held = connectionOf(scene);
    await shown(scene);
    scene.visibility[0]?.(true);
    await settled();
    const started = scene.docker.processes.length;
    const before = scene.runs.length;
    scene.docker.processes[0]?.print('{"Type":"container","Action":"die"}\n');
    await settled();
    scene.timers.at(-1)?.callback();
    await settled();
    const reread = scene.runs.length - before;
    scene.visibility[0]?.(false);
    deepStrictEqual(
      [started, reread, scene.docker.processes[0]?.killed],
      [1, 1, true],
    );
  });

  it('F-0903 3.3: a row’s item has its id, its text, its viewItem, and expands when it has rows under it', () => {
    const leaf: DetailsRow = {
      id: 'attributes/image',
      label: 'Image',
      description: 'debian:12',
      viewItem: 'image',
      children: [],
    };
    const section: DetailsRow = {
      id: 'attributes',
      label: 'Attributes',
      description: '',
      viewItem: undefined,
      children: [leaf],
    };
    deepStrictEqual(
      [detailsSpecOf(leaf), detailsSpecOf(section)],
      [
        {
          id: 'attributes/image',
          label: 'Image',
          description: 'debian:12',
          tooltip: undefined,
          contextValue: 'image',
          expanded: false,
          icon: undefined,
        },
        {
          id: 'attributes',
          label: 'Attributes',
          description: undefined,
          tooltip: undefined,
          contextValue: undefined,
          expanded: true,
          icon: undefined,
        },
      ],
    );
  });
});
