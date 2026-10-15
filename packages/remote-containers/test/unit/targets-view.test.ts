import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {HeldConnection} from '../../src/connect/connector.ts';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  REGISTRATION_POLL_MILLISECONDS,
  REGISTRATION_POLLS,
  showTargets,
  showTargetsWhenRegistered,
  specOf,
  type TargetsNode,
  type TargetsProvider,
  type TargetsView,
  type TargetsViewPorts,
} from '../../src/explorer/targets-view.ts';
import {views} from '../../src/identifiers.generated.ts';
import type {TargetRow} from '../../src/explorer/targets-model.ts';
import {fakeEngine, type FakeEngine} from './fake-engine.ts';
import {pendingOf, settled} from './pending.ts';

const CLOCK = Date.parse('2026-10-14T12:00:00Z');
const FOLDER = '/w/proj';
const OWN_ID = 'a1a1a1a1a1a1';
const OTHER = 'b2b2b2b2b2b2';
const THIRD = 'c3c3c3c3c3c3';

/** A container the fake `docker inspect` reports. */
interface FakeContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  labels: Record<string, string> | null;
}

function containerOf(
  containerId: string,
  labels: Record<string, string> | null = null,
  state = 'running',
): FakeContainer {
  return {
    id: containerId,
    name: `name-${containerId}`,
    image: `image-${containerId}`,
    state,
    labels,
  };
}

/** What the fake `docker inspect` prints for the containers. */
function inspectJson(containers: readonly FakeContainer[]): string {
  return JSON.stringify(
    containers.map(each => ({
      ['Id']: each.id,
      Name: `/${each.name}`,
      Created: '2026-10-14T10:00:00.000000000Z',
      Config: {Image: each.image, Labels: each.labels},
      State: {
        Status: each.state,
        StartedAt: '2026-10-14T10:00:05.000000000Z',
        FinishedAt: '0001-01-01T00:00:00Z',
      },
    })),
  );
}

/** What a row steers, and what the fakes recorded. */
interface Scene {
  commands: string[];
  /** What the view asked the clock for, and how many of those waits were stopped. */
  timers: Array<{milliseconds: number; callback: () => void}>;
  stopped: number;
  commandFailure: Error | undefined;
  containers: FakeContainer[];
  /** What `docker ps` and `docker inspect` answer; a function when a row holds or changes the answer. */
  listing: (() => EngineRunOutcome | Promise<EngineRunOutcome>) | undefined;
  inspecting: (() => EngineRunOutcome | Promise<EngineRunOutcome>) | undefined;
  held: HeldConnection | undefined;
  dockerPath: unknown;
  folders: string[];
  existing: Set<string>;
  contextFailure: Error | undefined;
  /** Each run: the engine that made it, its first argument and whether its signal had aborted when it ended. */
  runs: string[];
  signals: AbortSignal[];
  engineFiles: string[];
  contexts: Array<[string, boolean]>;
  created: Array<{viewId: string; provider: TargetsProvider}>;
  visibility: Array<(visible: boolean) => void>;
  changes: number;
  disposed: string[];
  /** The fake `docker` of each engine, by its name, for the events process. */
  docker: Record<string, FakeEngine>;
  pathListeners: Array<() => void>;
  pathSubscriptions: number;
  sink: MemorySink;
}

function sceneOf(): Scene {
  return {
    commands: [`${views.targetsContainers}.focus`],
    timers: [],
    stopped: 0,
    commandFailure: undefined,
    containers: [],
    listing: undefined,
    inspecting: undefined,
    held: undefined,
    dockerPath: 'docker',
    folders: [FOLDER],
    existing: new Set(),
    contextFailure: undefined,
    runs: [],
    signals: [],
    engineFiles: [],
    contexts: [],
    created: [],
    visibility: [],
    changes: 0,
    disposed: [],
    docker: {},
    pathListeners: [],
    pathSubscriptions: 0,
    sink: new MemorySink(),
  };
}

/** A fake `docker` that records its runs under `name`. */
function engineOf(scene: Scene, name: string): EngineHost {
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (argv, input, options) => {
      scene.runs.push(`${name} ${String(argv[0])}`);
      scene.signals.push(options.cancellation);
      if (argv[0] === 'ps') {
        return Promise.resolve(
          scene.listing?.() ?? {
            kind: 'ran',
            status: 0,
            stdout: scene.containers.map(each => `${each.id}\n`).join(''),
            stderr: '',
          },
        );
      }
      return Promise.resolve(
        scene.inspecting?.() ?? {
          kind: 'ran',
          status: 0,
          stdout: inspectJson(scene.containers),
          stderr: '',
        },
      );
    },
    spawn: (argv, options) =>
      (scene.docker[name] ??= fakeEngine()).spawn(argv, options),
  };
}

function portsOf(scene: Scene): TargetsViewPorts {
  return {
    editor: {
      commandIds: () =>
        scene.commandFailure === undefined
          ? Promise.resolve(scene.commands)
          : Promise.reject(scene.commandFailure),
      setContext: (key, value) => {
        scene.contexts.push([key, value]);
        return scene.contextFailure === undefined
          ? Promise.resolve(undefined)
          : Promise.reject(scene.contextFailure);
      },
      createTreeView: (viewId, provider) => {
        scene.created.push({viewId, provider});
        const subscription = provider.onDidChangeTreeData(() => {
          scene.changes += 1;
        });
        return {
          onDidChangeVisibility: listener => {
            scene.visibility.push(listener);
            return {
              dispose: () => {
                scene.disposed.push('visibility');
              },
            };
          },
          dispose: () => {
            scene.disposed.push('view');
            subscription.dispose();
          },
        };
      },
    },
    held: () => scene.held,
    dockerPath: () => scene.dockerPath,
    folders: () => scene.folders,
    engineFor: file => {
      scene.engineFiles.push(file);
      return engineOf(scene, 'setting');
    },
    exists: file => Promise.resolve(scene.existing.has(file)),
    now: () => CLOCK,
    onDockerPathChange: listener => {
      scene.pathListeners.push(listener);
      scene.pathSubscriptions += 1;
      return {
        dispose: () => {
          scene.pathSubscriptions -= 1;
        },
      };
    },
    setTimer: (milliseconds, callback) => {
      scene.timers.push({milliseconds, callback});
      return () => {
        scene.stopped += 1;
      };
    },
    translate: template => template,
    logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
  };
}

/** The view shown over the scene; it fails when the editor had no view to make. */
async function shown(
  scene: Scene,
): Promise<{view: TargetsView; provider: TargetsProvider}> {
  const view = await showTargets(portsOf(scene));
  const provider = scene.created[0]?.provider;
  if (view === undefined || provider === undefined) {
    throw new Error('no view was shown');
  }
  return {view, provider};
}

/** The ids of the nodes. */
function idsOf(nodes: readonly TargetsNode[]): string[] {
  return nodes.map(node => node.id);
}

/** The rows of every group of the tree the provider shows. */
async function rowsOf(provider: TargetsProvider): Promise<TargetRow[]> {
  const groups = await provider.getChildren(undefined);
  const rows = await Promise.all(
    groups.map(group => provider.getChildren(group)),
  );
  return rows.flat() as TargetRow[];
}

/** The tokens of a row's `viewItem`. */
function tokensOf(target: TargetRow | undefined): string[] {
  return (target?.viewItem ?? '').split(' ').filter(token => token !== '');
}

function connectionOf(scene: Scene, containerId: string): HeldConnection {
  return {
    containerId,
    hostPath: FOLDER,
    remoteWorkspaceFolder: '/workspaces/proj',
    engine: engineOf(scene, 'held'),
  };
}

function lines(scene: Scene): string[] {
  return scene.sink.lines.map(line => `${line.level}: ${line.message}`);
}

function groupOf(label: string): TargetsNode {
  return {id: 'devContainers', label, rows: []};
}

function rowOf(overrides: Partial<TargetRow>): TargetRow {
  return {
    id: 'row',
    label: 'Label',
    description: 'name',
    tooltip: 'Label (name) Running',
    icon: 'vmRunning',
    viewItem: 'container dev running',
    children: [],
    ...overrides,
  };
}

/** The view over a scene with one container, shown once and read once. */
async function populated(scene: Scene) {
  scene.containers = [containerOf(OTHER)];
  const {view, provider} = await shown(scene);
  await provider.getChildren(undefined);
  return {view, provider};
}

/** The same view, made visible, so that its events process runs. */
async function populatedAndVisible(scene: Scene) {
  const {view, provider} = await populated(scene);
  scene.visibility[0]?.(true);
  await settled();
  return {view, provider};
}

/** The view over a scene with one container, shown once, and then with its next listing held until the row settles it. */
async function populatedThenHeld(scene: Scene) {
  scene.containers = [containerOf(OTHER)];
  const {view, provider} = await shown(scene);
  await provider.getChildren(undefined);
  const hold = pendingOf<EngineRunOutcome>();
  scene.listing = () => hold.promise;
  return {view, provider, hold};
}

describe('the Dev Containers view (card containers-30)', () => {
  it('F-0906 7.E1: a view that core registers after the package activated is shown on the next look, once, and then no look is made', async () => {
    const scene = sceneOf();
    scene.commands = [];
    const view = showTargetsWhenRegistered(portsOf(scene));
    await settled();
    const first = [
      scene.created.length,
      scene.timers.map(each => each.milliseconds),
    ];
    scene.commands = [`${views.targetsContainers}.focus`];
    scene.timers[0]?.callback();
    await settled();
    await view.refresh();
    deepStrictEqual(
      [first, scene.created.length, scene.timers.length, lines(scene)],
      [[0, [REGISTRATION_POLL_MILLISECONDS]], 1, 1, []],
    );
  });

  it('F-0906 AC-16: a view that is never registered is looked for at each poll, then given up with one log line', async () => {
    const scene = sceneOf();
    scene.commands = [];
    showTargetsWhenRegistered(portsOf(scene));
    for (let poll = 0; poll < REGISTRATION_POLLS; poll += 1) {
      await settled();
      scene.timers.at(-1)?.callback();
    }
    await settled();
    deepStrictEqual(
      [scene.timers.length, scene.created.length, lines(scene)],
      [
        REGISTRATION_POLLS,
        0,
        ['info: the Dev Containers view is not registered, so it is not shown'],
      ],
    );
  });

  it('F-0906 7.E1: disposing while the view is awaited stops the wait, and nothing is shown after', async () => {
    const scene = sceneOf();
    scene.commands = [];
    const view = showTargetsWhenRegistered(portsOf(scene));
    await settled();
    view.dispose();
    scene.commands = [`${views.targetsContainers}.focus`];
    scene.timers[0]?.callback();
    await settled();
    deepStrictEqual([scene.stopped, scene.created.length], [1, 0]);
  });

  it('F-0906 7.E1: disposing while a look is in flight leaves the view it finds disposed', async () => {
    const scene = sceneOf();
    const view = showTargetsWhenRegistered(portsOf(scene));
    view.dispose();
    await settled();
    deepStrictEqual(scene.disposed, ['visibility', 'view']);
  });

  it('F-0906 7.E1: a view that is registered at once is shown with no wait, refreshed through the handle, and disposed with it', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OTHER)];
    const view = showTargetsWhenRegistered(portsOf(scene));
    await settled();
    await view.refresh();
    view.dispose();
    deepStrictEqual(
      [scene.timers.length, scene.runs, scene.disposed],
      [0, ['setting ps', 'setting inspect'], ['visibility', 'view']],
    );
  });

  it('F-0906 7.E1: disposing after the view is shown disposes it, and a Refresh before it is shown does nothing', async () => {
    const scene = sceneOf();
    scene.commands = [];
    const view = showTargetsWhenRegistered(portsOf(scene));
    await settled();
    await view.refresh();
    scene.commands = [`${views.targetsContainers}.focus`];
    scene.timers[0]?.callback();
    await settled();
    view.dispose();
    deepStrictEqual([scene.runs, scene.disposed], [[], ['visibility', 'view']]);
  });

  it('F-0906 7.E1: a look that fails is logged at error, and the first look too', async () => {
    const scene = sceneOf();
    scene.commandFailure = new Error('no commands');
    showTargetsWhenRegistered(portsOf(scene));
    await settled();
    deepStrictEqual(lines(scene), [
      'error: the Dev Containers view could not be shown: no commands',
    ]);
  });

  it('F-0906 7.E1: a later look that fails is logged by its text when it is not an error', async () => {
    const scene = sceneOf();
    scene.commands = [];
    showTargetsWhenRegistered(portsOf(scene));
    await settled();
    scene.commandFailure = 'plain' as unknown as Error;
    scene.timers[0]?.callback();
    await settled();
    deepStrictEqual(lines(scene), [
      'error: the Dev Containers view could not be shown: plain',
    ]);
  });

  it('F-0901 §16, 6.7: the events process runs only while the view is visible: started on visible, ended on hidden, and ended on dispose', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OTHER)];
    const {view, provider} = await shown(scene);
    await provider.getChildren(undefined);
    const hidden = scene.docker.setting?.processes.length ?? 0;
    scene.visibility[0]?.(true);
    await settled();
    const started = scene.docker.setting?.processes.map(each => each.argv[0]);
    scene.visibility[0]?.(false);
    await settled();
    const ended = scene.docker.setting?.processes.map(each => each.killed);
    scene.visibility[0]?.(true);
    await settled();
    view.dispose();
    await settled();
    deepStrictEqual(
      [
        hidden,
        started,
        ended,
        scene.docker.setting?.processes.map(each => each.killed),
      ],
      [0, ['events'], [true], [true, true]],
    );
  });

  it('F-0901 §16, AC-56: a Docker event rebuilds the tree once, after the quiet moment, with one change and no Refresh', async () => {
    const scene = sceneOf();
    const {provider} = await populatedAndVisible(scene);
    scene.containers = [containerOf(OTHER), containerOf(THIRD)];
    scene.docker.setting?.processes[0]?.print(
      '{"Type":"container","Action":"start"}\n',
    );
    await settled();
    const before = idsOf(await rowsOf(provider)).sort();
    scene.timers.at(-1)?.callback();
    await settled();
    deepStrictEqual(
      [before, idsOf(await rowsOf(provider)).sort(), scene.changes],
      [[OTHER], [OTHER, THIRD], 2],
    );
  });

  it('F-0901 AC-40: with the view shown and visible nothing asks the clock for a rebuild: no timer is set without an event', async () => {
    const scene = sceneOf();
    await populatedAndVisible(scene);
    deepStrictEqual(scene.timers.length, 0);
  });

  it('F-0901 §16: a program that is not named gives no events process while the view is visible', async () => {
    const scene = sceneOf();
    scene.dockerPath = 'bin/docker';
    scene.folders = [];
    const {provider} = await shown(scene);
    scene.visibility[0]?.(true);
    await provider.getChildren(undefined);
    await settled();
    deepStrictEqual(Object.keys(scene.docker), []);
  });

  it('F-0901 6.21, AC-44: in a local window a dockerPath change ends the events process and rebuilds with the new program, which gives the Docker welcome when it is missing, and no process', async () => {
    const scene = sceneOf();
    const {provider} = await populatedAndVisible(scene);
    scene.dockerPath = 'bin/docker';
    scene.folders = [];
    scene.pathListeners[0]?.();
    await settled();
    deepStrictEqual(
      [
        scene.docker.setting?.processes.map(each => each.killed),
        await provider.getChildren(undefined),
        scene.contexts.slice(-3),
      ],
      [
        [true],
        [],
        [
          ['remote-containers:needsDockerStartOrInstall', true],
          ['remote-containers:noContainersWithFolder', false],
          ['remote-containers:noContainersWithoutFolder', false],
        ],
      ],
    );
  });

  it('F-0901 6.21: in a local window a dockerPath change to a program that starts restarts the events process on the new engine', async () => {
    const scene = sceneOf();
    await populatedAndVisible(scene);
    scene.dockerPath = '/other/docker';
    scene.pathListeners[0]?.();
    await settled();
    deepStrictEqual(
      [
        [...new Set(scene.engineFiles)],
        scene.docker.setting?.processes.length,
        scene.docker.setting?.processes.map(each => each.killed),
      ],
      [['docker', '/other/docker'], 2, [true, false]],
    );
  });

  it('F-0901 6.21: a dockerPath change while the view is hidden rebuilds and starts no process', async () => {
    const scene = sceneOf();
    await populated(scene);
    scene.runs.length = 0;
    scene.pathListeners[0]?.();
    await settled();
    deepStrictEqual(
      [scene.runs, Object.keys(scene.docker)],
      [['setting ps', 'setting inspect'], []],
    );
  });

  it('F-0901 6.21: a dockerPath change while a read runs waits for it and then reads again with the new program', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OTHER)];
    const {view, hold, provider} = await populatedThenHeld(scene);
    const refreshing = view.refresh();
    await settled();
    scene.runs.length = 0;
    scene.dockerPath = '/other/docker';
    scene.pathListeners[0]?.();
    await settled();
    const during = [...scene.runs];
    scene.listing = undefined;
    hold.resolve({kind: 'ran', status: 0, stdout: `${OTHER}\n`, stderr: ''});
    await refreshing;
    await settled();
    deepStrictEqual(
      [during, scene.runs, idsOf(await rowsOf(provider))],
      [[], ['setting inspect', 'setting ps', 'setting inspect'], [OTHER]],
    );
  });

  it('F-0901 6.21 step 4, AC-45: in a dev container window a dockerPath change changes nothing: no rebuild, the events process stays on the held engine, and a container created afterwards still appears', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OWN_ID)];
    scene.held = connectionOf(scene, OWN_ID);
    const {provider} = await shown(scene);
    await provider.getChildren(undefined);
    scene.visibility[0]?.(true);
    await settled();
    scene.runs.length = 0;
    scene.dockerPath = '/changed/docker';
    scene.pathListeners[0]?.();
    await settled();
    const unchanged = [
      [...scene.runs],
      scene.docker.held?.processes.map(each => each.killed),
    ];
    scene.containers = [containerOf(OWN_ID), containerOf(OTHER)];
    scene.docker.held?.processes[0]?.print('{"Type":"container"}\n');
    await settled();
    scene.timers.at(-1)?.callback();
    await settled();
    deepStrictEqual(
      [
        unchanged,
        scene.docker.held?.processes.length,
        scene.runs,
        scene.engineFiles,
        idsOf(await rowsOf(provider)).sort(),
      ],
      [
        [[], [false]],
        1,
        ['held ps', 'held inspect'],
        [],
        [OWN_ID, OTHER].sort(),
      ],
    );
  });

  it('F-0901 6.21: the dockerPath subscription ends with the view', async () => {
    const scene = sceneOf();
    const {view} = await shown(scene);
    const subscribed = scene.pathSubscriptions;
    view.dispose();
    deepStrictEqual([subscribed, scene.pathSubscriptions], [1, 0]);
  });

  it('F-0901 3.3, BR-13: a header is expanded and bare, and a row carries its id, texts and token string, and is expanded only with children under it', () => {
    const child = rowOf({id: 'child'});
    deepStrictEqual(
      [
        specOf(groupOf('Group x')),
        specOf(rowOf({})),
        specOf(rowOf({children: [child]})).expanded,
      ],
      [
        {
          id: 'devContainers',
          label: 'Group x',
          description: undefined,
          tooltip: undefined,
          contextValue: undefined,
          expanded: true,
          icon: undefined,
        },
        {
          id: 'row',
          label: 'Label',
          description: 'name',
          tooltip: 'Label (name) Running',
          contextValue: 'container dev running',
          expanded: false,
          icon: {kind: 'theme', id: 'vm-running'},
        },
        true,
      ],
    );
  });

  it('F-0901 BR-4: the window own row has the package icon vm-active, and the other states have the codicons vm-running, vm and vm-outline', () => {
    deepStrictEqual(
      (['vmActive', 'vmRunning', 'vm', 'vmOutline'] as const).map(
        icon => specOf(rowOf({icon})).icon,
      ),
      [
        {kind: 'resource', file: 'vm-active.svg'},
        {kind: 'theme', id: 'vm-running'},
        {kind: 'theme', id: 'vm'},
        {kind: 'theme', id: 'vm-outline'},
      ],
    );
  });

  it('F-0906 AC-16, 7.E1: without the focus command no tree view is made and nothing is read', async () => {
    const scene = sceneOf();
    scene.commands = ['workbench.action.reloadWindow'];
    const view = await showTargets(portsOf(scene));
    deepStrictEqual(
      [view, scene.created, scene.runs, scene.contexts, lines(scene)],
      [undefined, [], [], [], []],
    );
  });

  it('F-0901 BR-13: the tree view is made for targetsContainers; the first request reads the engine once, and the groups and rows come from the model with their ids', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OTHER), containerOf(THIRD)];
    const {provider} = await shown(scene);
    const first = await provider.getChildren(undefined);
    const second = await provider.getChildren(undefined);
    deepStrictEqual(
      [
        scene.created.map(each => each.viewId),
        scene.runs,
        idsOf(first),
        idsOf(second),
        idsOf(await rowsOf(provider)).sort(),
      ],
      [
        ['targetsContainers'],
        ['setting ps', 'setting inspect'],
        ['otherContainers'],
        ['otherContainers'],
        [OTHER, THIRD],
      ],
    );
  });

  it('F-0901 6.1: a row has nothing under it in 0.4', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OTHER)];
    const {provider} = await shown(scene);
    const [target] = await rowsOf(provider);
    deepStrictEqual(await provider.getChildren(target), []);
  });

  it('F-0901 BR-12, AC-56: a Refresh builds the next tree and fires one change; the first population fires none', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OTHER)];
    const {view, provider} = await shown(scene);
    await provider.getChildren(undefined);
    const afterFirst = scene.changes;
    scene.containers = [containerOf(OTHER), containerOf(THIRD)];
    await view.refresh();
    deepStrictEqual(
      [afterFirst, scene.changes, idsOf(await rowsOf(provider)).sort()],
      [0, 1, [OTHER, THIRD]],
    );
  });

  it('F-0901 BR-12: while a read runs, the previous tree is what a request gets, never an empty one, and the new tree replaces it when the read ends', async () => {
    const scene = sceneOf();
    const {view, provider, hold} = await populatedThenHeld(scene);
    const refreshing = view.refresh();
    await settled();
    const during = idsOf(await rowsOf(provider));
    hold.resolve({kind: 'ran', status: 0, stdout: `${THIRD}\n`, stderr: ''});
    scene.containers = [containerOf(THIRD)];
    scene.listing = undefined;
    await refreshing;
    deepStrictEqual(
      [during, idsOf(await rowsOf(provider))],
      [[OTHER], [THIRD]],
    );
  });

  it('F-0901 BR-12: two Refreshes during one read make one read', async () => {
    const scene = sceneOf();
    const {view, hold} = await populatedThenHeld(scene);
    scene.runs.length = 0;
    const refreshes = Promise.all([view.refresh(), view.refresh()]);
    await settled();
    hold.resolve({kind: 'ran', status: 0, stdout: `${OTHER}\n`, stderr: ''});
    await refreshes;
    deepStrictEqual(scene.runs, ['setting ps', 'setting inspect']);
  });

  it('F-0901 7.E1: each welcome key is set for its welcome, and no key for a tree with containers', async () => {
    const seen: unknown[] = [];
    const cases: Array<(scene: Scene) => void> = [
      scene => {
        scene.listing = () => ({kind: 'failed', detail: 'spawn docker ENOENT'});
      },
      scene => {
        scene.containers = [];
      },
      scene => {
        scene.containers = [];
        scene.folders = [];
      },
      scene => {
        scene.containers = [containerOf(OTHER)];
      },
    ];
    for (const steer of cases) {
      const scene = sceneOf();
      steer(scene);
      const {provider} = await shown(scene);
      await provider.getChildren(undefined);
      seen.push(scene.contexts);
    }
    deepStrictEqual(seen, [
      [
        ['remote-containers:needsDockerStartOrInstall', true],
        ['remote-containers:noContainersWithFolder', false],
        ['remote-containers:noContainersWithoutFolder', false],
      ],
      [
        ['remote-containers:needsDockerStartOrInstall', false],
        ['remote-containers:noContainersWithFolder', true],
        ['remote-containers:noContainersWithoutFolder', false],
      ],
      [
        ['remote-containers:needsDockerStartOrInstall', false],
        ['remote-containers:noContainersWithFolder', false],
        ['remote-containers:noContainersWithoutFolder', true],
      ],
      [
        ['remote-containers:needsDockerStartOrInstall', false],
        ['remote-containers:noContainersWithFolder', false],
        ['remote-containers:noContainersWithoutFolder', false],
      ],
    ]);
  });

  it('F-0901 7.E1: an engine that cannot be listed, in each way, shows no group and sets the Docker welcome, with the reason in the log', async () => {
    const outcomes: Array<(scene: Scene) => void> = [
      scene => {
        scene.listing = () => ({kind: 'failed', detail: 'spawn docker ENOENT'});
      },
      scene => {
        scene.listing = () => ({
          kind: 'ran',
          status: 1,
          stdout: '',
          stderr: 'Cannot connect',
        });
      },
      scene => {
        scene.containers = [containerOf(OTHER)];
        scene.inspecting = () => ({kind: 'failed', detail: 'killed'});
      },
      scene => {
        scene.containers = [containerOf(OTHER)];
        scene.inspecting = () => ({
          kind: 'ran',
          status: 0,
          stdout: 'not json',
          stderr: '',
        });
      },
      scene => {
        scene.dockerPath = 'bin/docker';
        scene.folders = [];
      },
    ];
    const seen: unknown[] = [];
    for (const steer of outcomes) {
      const scene = sceneOf();
      steer(scene);
      const {provider} = await shown(scene);
      seen.push([
        await provider.getChildren(undefined),
        scene.contexts[0],
        lines(scene),
      ]);
    }
    deepStrictEqual(seen, [
      [
        [],
        ['remote-containers:needsDockerStartOrInstall', true],
        ['info: the containers could not be listed: spawn docker ENOENT'],
      ],
      [
        [],
        ['remote-containers:needsDockerStartOrInstall', true],
        ['info: the containers could not be listed: exit status 1'],
      ],
      [
        [],
        ['remote-containers:needsDockerStartOrInstall', true],
        ['info: the containers could not be listed: killed'],
      ],
      [
        [],
        ['remote-containers:needsDockerStartOrInstall', true],
        [
          'info: the containers could not be listed: the engine answered with something that is not a list',
        ],
      ],
      [
        [],
        ['remote-containers:needsDockerStartOrInstall', true],
        [
          'info: the containers could not be listed: no Docker program is named',
        ],
      ],
    ]);
  });

  it('F-0901 BR-12: a container that went between the list and the inspect leaves the others listed, since docker inspect still prints them', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OTHER)];
    scene.inspecting = () => ({
      kind: 'ran',
      status: 1,
      stdout: inspectJson([containerOf(OTHER)]),
      stderr: 'Error: No such container: gone',
    });
    const {provider} = await shown(scene);
    deepStrictEqual(idsOf(await rowsOf(provider)), [OTHER]);
  });

  it('F-0901 6.21: the engine is the one the setting names now, made for the program, with a relative path against the first folder', async () => {
    const scene = sceneOf();
    scene.dockerPath = 'bin/docker';
    const {provider} = await shown(scene);
    await provider.getChildren(undefined);
    deepStrictEqual(scene.engineFiles, ['/w/proj/bin/docker']);
  });

  it('F-0901 6.21 step 4, AC-45: in a dev container window the held connection engine reads the list, also after dockerPath names another program', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OWN_ID)];
    scene.held = connectionOf(scene, OWN_ID);
    scene.dockerPath = '/changed/docker';
    const {provider} = await shown(scene);
    await provider.getChildren(undefined);
    deepStrictEqual(
      [scene.runs, scene.engineFiles],
      [['held ps', 'held inspect'], []],
    );
  });

  it('F-0901 AC-4: the window own container is the row of the held connection, with the vm-active icon', async () => {
    const scene = sceneOf();
    scene.containers = [containerOf(OWN_ID), containerOf(OTHER)];
    scene.held = connectionOf(scene, OWN_ID);
    const {provider} = await shown(scene);
    const rows = await rowsOf(provider);
    const own = rows.find(entry => entry.id === OWN_ID);
    const other = rows.find(entry => entry.id === OTHER);
    deepStrictEqual(
      [
        tokensOf(own).includes('own'),
        tokensOf(other).includes('own'),
        own === undefined ? undefined : specOf(own).icon,
      ],
      [true, false, {kind: 'resource', file: 'vm-active.svg'}],
    );
  });

  it('F-0901 AC-30, AC-31, AC-42, AC-43, BR-11: the configuration token of a dev container follows the file the label names, else the default files of its folder, and a repository one has no file to miss', async () => {
    const scene = sceneOf();
    scene.containers = [
      containerOf('d1', {'devcontainer.local_folder': '/f/none'}),
      containerOf('d2', {'devcontainer.local_folder': '/f/root'}),
      containerOf('d3', {
        'devcontainer.local_folder': '/f/named',
        'devcontainer.config_file': '/f/named/.devcontainer/other.json',
      }),
      containerOf('d4', {
        'devcontainer.local_folder': '/f/missing',
        'devcontainer.config_file': '/f/missing/.devcontainer/gone.json',
      }),
      containerOf('d5', {'devcontainer.local_folder': '/f/main'}),
      containerOf('d6', {'vsch.local.repository': 'https://example.test/r'}),
      containerOf('d7'),
    ];
    scene.existing = new Set([
      '/f/root/.devcontainer.json',
      '/f/named/.devcontainer/other.json',
      '/f/missing/.devcontainer/devcontainer.json',
      '/f/main/.devcontainer/devcontainer.json',
    ]);
    const {provider} = await shown(scene);
    const rows = await rowsOf(provider);
    deepStrictEqual(
      rows
        .filter(entry => tokensOf(entry).includes('configuration'))
        .map(entry => entry.id)
        .sort(),
      ['d2', 'd3', 'd5', 'd6'],
    );
  });

  it('F-0901 6.7: becoming visible rebuilds the tree, hiding does not', async () => {
    const scene = sceneOf();
    await populated(scene);
    scene.runs.length = 0;
    scene.visibility[0]?.(false);
    await settled();
    const hidden = [...scene.runs];
    scene.visibility[0]?.(true);
    await settled();
    deepStrictEqual(
      [hidden, scene.runs, scene.changes],
      [[], ['setting ps', 'setting inspect'], 1],
    );
  });

  it('F-0901 6.7: a rebuild that fails when the view becomes visible is logged at error, and is not unhandled', async () => {
    const scene = sceneOf();
    const {provider} = await shown(scene);
    await provider.getChildren(undefined);
    scene.contextFailure = new Error('no context');
    scene.visibility[0]?.(true);
    await settled();
    deepStrictEqual(
      lines(scene).filter(line => line.startsWith('error')),
      ['error: the Dev Containers view could not be rebuilt: no context'],
    );
  });

  it('F-0901 6.7: a rejection that is not an error is logged by its text', async () => {
    const scene = sceneOf();
    const {provider} = await shown(scene);
    await provider.getChildren(undefined);
    const failing = pendingOf<EngineRunOutcome>();
    scene.listing = () => failing.promise;
    scene.visibility[0]?.(true);
    failing.reject('plain');
    await settled();
    deepStrictEqual(
      lines(scene).filter(line => line.startsWith('error')),
      ['error: the Dev Containers view could not be rebuilt: plain'],
    );
  });

  it('F-0906 7.E1: disposing ends the visibility subscription and the tree view once, aborts a read that runs, and sets no key afterwards', async () => {
    const scene = sceneOf();
    const {view, hold} = await populatedThenHeld(scene);
    scene.contexts.length = 0;
    const refreshing = view.refresh();
    await settled();
    view.dispose();
    view.dispose();
    hold.resolve({kind: 'failed', detail: 'aborted'});
    await refreshing;
    deepStrictEqual(
      [
        scene.disposed,
        scene.signals.at(-1)?.aborted,
        scene.contexts,
        scene.changes,
      ],
      [['visibility', 'view'], true, [], 0],
    );
  });
});
