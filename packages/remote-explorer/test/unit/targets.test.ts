import {deepStrictEqual} from 'node:assert';
import {
  type ActiveRemote,
  type CallOutcome,
  type CompanionDetector,
  createProtocol,
  type FoldersHistory,
  type Hostnames,
  type Timers,
} from 'lib-companion';
import {createRecordingFake} from 'lib-companion/testing/recording-fake';
import {
  companionCallsOf,
  type CompanionCalls,
} from '../../src/view/companion-calls.ts';
import {
  createTargets,
  type FolderSettings,
  type HostNode,
  type TargetNode,
} from '../../src/view/targets.ts';

const VERSION = {major: 1, minor: 0};

function pullOf(connected: boolean, hostKey?: string): ActiveRemote {
  return {
    interfaceVersion: VERSION,
    connected,
    ...(hostKey === undefined ? {} : {hostKey}),
  };
}

function hostsOf(...hostnames: string[]): Hostnames {
  return {interfaceVersion: VERSION, hostnames};
}

/** The open history of the hosts, each key with its paths, as the companion sends it. */
function historyOf(
  ...hosts: Array<readonly [string, ...string[]]>
): FoldersHistory {
  return {
    interfaceVersion: VERSION,
    hosts: hosts.map(([hostKey, ...paths]) => ({
      hostKey,
      entries: paths.map(path => ({
        path,
        kind: path.endsWith('.code-workspace') ? 'workspace' : 'folder',
      })),
    })),
  };
}

function answered<Value>(value: Value): CallOutcome<Value> {
  return {status: 'answered', value};
}

const UNAVAILABLE: CallOutcome<never> = {
  status: 'unavailable',
  cause: 'rejected',
};

/** A call the test settles when it likes. */
interface Held<Value> {
  promise: Promise<CallOutcome<Value>>;
  settle(outcome: CallOutcome<Value>): void;
}

function held<Value>(): Held<Value> {
  const resolvers: Array<(outcome: CallOutcome<Value>) => void> = [];
  const promise = new Promise<CallOutcome<Value>>(resolve => {
    resolvers.push(resolve);
  });
  return {
    promise,
    settle: outcome => {
      resolvers[0]?.(outcome);
    },
  };
}

/** The calls of a build, in the order they were made, each settled by the test. */
interface FakeCalls extends CompanionCalls {
  order: string[];
  pulls: Array<Held<ActiveRemote>>;
  hosts: Array<Held<Hostnames>>;
  /** What the next history calls answer; nothing recorded by default. */
  historyAnswer: CallOutcome<FoldersHistory>;
}

function fakeCalls(): FakeCalls {
  const calls: FakeCalls = {
    order: [],
    pulls: [],
    hosts: [],
    historyAnswer: answered(historyOf()),
    activeRemote: () => {
      calls.order.push('activeRemote');
      const call = held<ActiveRemote>();
      calls.pulls.push(call);
      return call.promise;
    },
    hostnames: () => {
      calls.order.push('hostnames');
      const call = held<Hostnames>();
      calls.hosts.push(call);
      return call.promise;
    },
    history: () => {
      calls.order.push('history');
      return Promise.resolve(calls.historyAnswer);
    },
    deleteFolder: () => {
      throw new Error('the targets never delete a folder');
    },
    open: () => {
      throw new Error('the targets never open a host');
    },
  };
  return calls;
}

/** The detector whose presence and arrivals the test decides. */
interface FakeDetector extends Pick<
  CompanionDetector,
  'isPresent' | 'onPresenceChanged'
> {
  present: boolean;
  arrive(companionId: string): void;
}

function fakeDetector(present: boolean): FakeDetector {
  const listeners = new Set<(companionId: never) => void>();
  const detector: FakeDetector = {
    present,
    isPresent: () => (detector.present ? 'present' : 'absent'),
    onPresenceChanged: listener => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    arrive: companionId => {
      for (const listener of listeners) {
        listener(companionId as never);
      }
    },
  };
  return detector;
}

interface Setup {
  settings: FolderSettings;
  calls: FakeCalls;
  detector: FakeDetector;
  targets: ReturnType<typeof createTargets>;
  changes: number[];
  configChanged(): void;
  settleAll(
    pull: CallOutcome<ActiveRemote>,
    hosts: CallOutcome<Hostnames>,
    index?: number,
  ): Promise<void>;
  hosts(): Promise<HostNode[]>;
  names(): Promise<string[]>;
}

function setup(present = true): Setup {
  const calls = fakeCalls();
  const detector = fakeDetector(present);
  const settings: FolderSettings = {sortOrder: undefined, collapse: undefined};
  let configListener: (() => void) | undefined;
  const targets = createTargets({
    calls,
    detector,
    configFileChanges: listener => {
      configListener = listener;
      return {
        dispose: () => {
          configListener = undefined;
        },
      };
    },
    connectedText: 'connected',
    folderSettings: () => ({...settings}),
    clientPlatform: 'other',
  });
  const changes: number[] = [];
  targets.onDidChange(() => changes.push(changes.length));
  async function hostNodes(): Promise<HostNode[]> {
    const [first] = await targets.children(undefined);
    return first === undefined
      ? []
      : ((await targets.children(first)) as HostNode[]);
  }
  return {
    settings,
    calls,
    detector,
    targets,
    changes,
    configChanged: () => {
      configListener?.();
    },
    settleAll: async (pull, hosts, index = 0) => {
      calls.pulls[index]?.settle(pull);
      calls.hosts[index]?.settle(hosts);
      await targets.children(undefined);
    },
    hosts: hostNodes,
    names: async () => (await hostNodes()).map(node => node.hostRow.alias),
  };
}

describe('the targets of the Remotes view (card explorer-04)', () => {
  it('F-5101.BR-2: the group is absent without the companion and the same object once it is present', async () => {
    const scenario = setup(false);
    const before = await scenario.targets.children(undefined);
    scenario.detector.present = true;
    const [first] = await scenario.targets.children(undefined);
    const [second] = await scenario.targets.children(undefined);
    deepStrictEqual(
      [before, first === second, first?.kind],
      [[], true, 'sshGroup'],
    );
  });

  it('F-5102.3.3: the group is the SSH row, expanded, with no other property', async () => {
    const scenario = setup();
    const [group] = await scenario.targets.children(undefined);
    deepStrictEqual(
      group === undefined ? undefined : scenario.targets.itemOf(group),
      {
        id: 'ssh-group',
        label: 'SSH',
        tooltip: 'SSH',
        contextValue: 'remote-explorer.sshGroup',
        collapsibleState: 'expanded',
      },
    );
  });

  it('F-5902.5.order: a full build asks the pull and the hosts in one turn, before either answers, and changes once both did', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    const asked = [...scenario.calls.order];
    const before = scenario.changes.length;
    await scenario.settleAll(answered(pullOf(false)), answered(hostsOf('a')));
    deepStrictEqual(
      [asked, before, scenario.changes.length],
      [['activeRemote', 'history', 'hostnames'], 0, 1],
    );
  });

  it('F-5103.AC-33: F-5902.5.order: the hosts answering first change nothing, and the first render waits for the pull', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    scenario.calls.hosts[0]?.settle(answered(hostsOf('a')));
    await Promise.resolve();
    const before = scenario.changes.length;
    const waiting = scenario.names();
    scenario.calls.pulls[0]?.settle(answered(pullOf(false)));
    deepStrictEqual(
      [before, await waiting, scenario.changes.length],
      [0, ['a'], 1],
    );
  });

  it('F-5102.AC-33, F-5103.AC-25: F-5102.BR-7: the hosts are listed in the order given, each with its own row item', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    await scenario.settleAll(
      answered(pullOf(false)),
      answered(hostsOf('zeta', 'Alpha', 'mid')),
    );
    const nodes = await scenario.hosts();
    deepStrictEqual(
      [
        nodes.map(node => node.hostRow.alias),
        nodes[0] === undefined ? undefined : scenario.targets.itemOf(nodes[0]),
      ],
      [
        ['zeta', 'Alpha', 'mid'],
        {
          id: 'ssh-host:zeta',
          label: 'zeta',
          tooltip: 'zeta',
          iconId: 'vm',
          contextValue: 'remote-explorer.sshRemoteTarget',
          collapsibleState: 'none',
        },
      ],
    );
  });

  it('F-5103.AC-30: two blocks with one alias give one row', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    await scenario.settleAll(
      answered(pullOf(false)),
      answered(hostsOf('a', 'b', 'a')),
    );
    deepStrictEqual(await scenario.names(), ['a', 'b']);
  });

  it('F-5103.BR-6: the host the window is connected to is marked with the description and the active icon, and no other', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    await scenario.settleAll(
      answered(pullOf(true, 'Alpha')),
      answered(hostsOf('zeta', 'Alpha', 'mid')),
    );
    const nodes = await scenario.hosts();
    deepStrictEqual(
      nodes.map(node => [
        node.connected,
        scenario.targets.itemOf(node).description,
        scenario.targets.itemOf(node).iconId,
      ]),
      [
        [false, undefined, 'vm'],
        [true, 'connected', 'vm-active'],
        [false, undefined, 'vm'],
      ],
    );
  });

  for (const [name, pull] of [
    ['a host key no row has', pullOf(true, 'nomatch')],
    ['a host key whose case differs', pullOf(true, 'alpha')],
    ['a window that is not connected', pullOf(false)],
  ] as const) {
    it(`F-5103.AC-28: ${name} marks no host`, async () => {
      const scenario = setup();
      void scenario.targets.rebuild();
      await scenario.settleAll(answered(pull), answered(hostsOf('Alpha')));
      const nodes = await scenario.hosts();
      deepStrictEqual(
        nodes.map(node => node.connected),
        [false],
      );
    });
  }

  it('F-5902.AC-5: a pull that fails leaves the hosts listed and none marked', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    await scenario.settleAll(UNAVAILABLE, answered(hostsOf('a')));
    const nodes = await scenario.hosts();
    deepStrictEqual(
      nodes.map(node => [node.hostRow.alias, node.connected]),
      [['a', false]],
    );
  });

  it('F-5101.AC-14, F-5902.AC-5: a host list that fails leaves the group with no host rows', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    await scenario.settleAll(answered(pullOf(true, 'a')), UNAVAILABLE);
    const [group] = await scenario.targets.children(undefined);
    deepStrictEqual(
      [
        group?.kind,
        group === undefined
          ? undefined
          : await scenario.targets.children(group),
      ],
      ['sshGroup', []],
    );
  });

  it('F-5101.AC-35: F-5101.BR-6: an older build that answers last changes nothing', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    void scenario.targets.rebuild();
    await scenario.settleAll(
      answered(pullOf(false)),
      answered(hostsOf('new')),
      1,
    );
    scenario.calls.pulls[0]?.settle(answered(pullOf(true, 'old')));
    scenario.calls.hosts[0]?.settle(answered(hostsOf('old')));
    await Promise.resolve();
    await Promise.resolve();
    deepStrictEqual(
      [await scenario.names(), scenario.changes.length],
      [['new'], 1],
    );
  });

  it('F-5101.AC-34, AC-35: F-5101.BR-6: through the protocol, the build started last decides the hosts and the marker, whichever answers last', async () => {
    const fake = createRecordingFake();
    const releases: Array<() => void> = [];
    const answersOf: Array<{pull: unknown; hosts: unknown}> = [
      {pull: pullOf(true, 'first'), hosts: hostsOf('first', 'shared')},
      {pull: pullOf(true, 'second'), hosts: hostsOf('second', 'shared')},
    ];
    const seen = {pull: 0, hosts: 0};
    for (const [commandId, key] of [
      ['remote-internal.getActiveSshRemote', 'pull'],
      ['remote-internal.getConfiguredHostnames', 'hosts'],
    ] as const) {
      fake.registerCommand(commandId, () => {
        const index = seen[key];
        seen[key] += 1;
        return new Promise(resolve => {
          releases[index * 2 + (key === 'pull' ? 0 : 1)] = () => {
            resolve(answersOf[index]?.[key]);
          };
        });
      });
    }
    const timers: Timers = {setTimer: () => 0, clearTimer: () => undefined};
    const targets = createTargets({
      calls: companionCallsOf(
        createProtocol({
          // eslint-disable-next-line id-length -- the protocol's option is named bus
          bus: fake,
          timers,
        }),
      ),
      detector: fakeDetector(true),
      configFileChanges: () => ({dispose: () => undefined}),
      connectedText: 'connected',
      folderSettings: () => ({sortOrder: undefined, collapse: undefined}),
      clientPlatform: 'other',
    });
    const changes: number[] = [];
    targets.onDidChange(() => changes.push(1));
    const firstBuild = targets.rebuild();
    const secondBuild = targets.rebuild();
    releases[2]?.();
    releases[3]?.();
    await secondBuild;
    releases[0]?.();
    releases[1]?.();
    await firstBuild;
    const [group] = await targets.children(undefined);
    const nodes =
      group === undefined
        ? []
        : ((await targets.children(group)) as HostNode[]);
    deepStrictEqual(
      [nodes.map(node => [node.hostRow.alias, node.connected]), changes.length],
      [
        [
          ['second', true],
          ['shared', false],
        ],
        1,
      ],
    );
  });

  it('F-5101.AC-16, F-5102.AC-17: F-5101.6.5: a change of the configuration file asks the hosts alone, and the marker stays', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    await scenario.settleAll(
      answered(pullOf(true, 'Alpha')),
      answered(hostsOf('Alpha')),
    );
    scenario.configChanged();
    scenario.calls.hosts[1]?.settle(answered(hostsOf('Alpha', 'beta')));
    await scenario.targets.children(undefined);
    const nodes = await scenario.hosts();
    deepStrictEqual(
      [
        scenario.calls.order,
        nodes.map(node => [node.hostRow.alias, node.connected]),
      ],
      [
        ['activeRemote', 'history', 'hostnames', 'hostnames'],
        [
          ['Alpha', true],
          ['beta', false],
        ],
      ],
    );
  });

  it('F-5101.BR-6: a host build started after a full build decides the hosts, and the full build decides the marker', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    scenario.configChanged();
    scenario.calls.hosts[1]?.settle(answered(hostsOf('x')));
    await Promise.resolve();
    scenario.calls.pulls[0]?.settle(answered(pullOf(true, 'x')));
    scenario.calls.hosts[0]?.settle(answered(hostsOf('y')));
    await scenario.targets.children(undefined);
    const nodes = await scenario.hosts();
    deepStrictEqual(
      nodes.map(node => [node.hostRow.alias, node.connected]),
      [['x', true]],
    );
  });

  it('F-5103.AC-20: F-5101.7.E1: without the companion a build makes no call and changes nothing', async () => {
    const scenario = setup(false);
    await scenario.targets.rebuild();
    await scenario.targets.rebuildHosts();
    deepStrictEqual([scenario.calls.order, scenario.changes.length], [[], 0]);
  });

  it('F-5101.AC-26, AC-34: F-5101.6.6: the arrival of the companion starts a full build, after which the group has its hosts', async () => {
    const scenario = setup(false);
    scenario.detector.present = true;
    scenario.detector.arrive('remote-oss.remote-ssh');
    const asked = [...scenario.calls.order];
    await scenario.settleAll(answered(pullOf(false)), answered(hostsOf('a')));
    deepStrictEqual(
      [asked, await scenario.names()],
      [['activeRemote', 'history', 'hostnames'], ['a']],
    );
  });

  it('F-5103.BR-6: the hosts of a group are given only after the build in progress settles', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    const [group] = await scenario.targets.children(undefined);
    let resolved = false;
    const waiting = (
      group === undefined
        ? Promise.resolve([])
        : scenario.targets.children(group)
    ).then(nodes => {
      resolved = true;
      return nodes;
    });
    await Promise.resolve();
    const early = resolved;
    scenario.calls.pulls[0]?.settle(answered(pullOf(false)));
    scenario.calls.hosts[0]?.settle(answered(hostsOf('a')));
    deepStrictEqual([early, (await waiting).length], [false, 1]);
  });

  it('F-5002.19: hostOf gives the node itself when it is a node of the current list, and nothing for any other value', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    await scenario.settleAll(answered(pullOf(false)), answered(hostsOf('a')));
    const current = await scenario.hosts();
    void scenario.targets.rebuild();
    await scenario.settleAll(
      answered(pullOf(false)),
      answered(hostsOf('a')),
      1,
    );
    const renewed = await scenario.hosts();
    const [group] = await scenario.targets.children(undefined);
    const first = current[0];
    const lookAlike: TargetNode | undefined =
      renewed[0] === undefined ? undefined : {...renewed[0]};
    deepStrictEqual(
      [
        scenario.targets.hostOf(renewed[0]) === renewed[0],
        scenario.targets.hostOf(first),
        scenario.targets.hostOf(group),
        scenario.targets.hostOf(lookAlike),
        scenario.targets.hostOf('x'),
        scenario.targets.hostOf(undefined),
      ],
      [true, undefined, undefined, undefined, undefined, undefined],
    );
  });

  it('F-5101.BR-8: after dispose neither the detector nor the configuration starts a call', () => {
    const scenario = setup(true);
    scenario.targets.dispose();
    scenario.detector.arrive('remote-oss.remote-ssh');
    scenario.configChanged();
    deepStrictEqual(scenario.calls.order, []);
  });

  it('F-5102.3.3: a host row is a leaf', async () => {
    const scenario = setup();
    void scenario.targets.rebuild();
    await scenario.settleAll(answered(pullOf(false)), answered(hostsOf('a')));
    const nodes = await scenario.hosts();
    deepStrictEqual(
      nodes[0] === undefined
        ? undefined
        : await scenario.targets.children(nodes[0]),
      [],
    );
  });

  /** A full build over `history` and the aliases, settled; the host nodes it gives. */
  async function hostsFor(
    scenario: Setup,
    history: FoldersHistory,
    ...aliases: string[]
  ): Promise<HostNode[]> {
    scenario.calls.historyAnswer = answered(history);
    void scenario.targets.rebuild();
    const built = scenario.calls.pulls.length - 1;
    await scenario.settleAll(
      answered(pullOf(false)),
      answered(hostsOf(...aliases)),
      built,
    );
    return scenario.hosts();
  }

  it('F-5104.BR-1, BR-2: each host gets the folders recorded under its exact alias, and a key that matches no alias, or only by case, shows nowhere', async () => {
    const scenario = setup();
    const nodes = await hostsFor(
      scenario,
      historyOf(
        ['devbox', '/w/a', '/w/b'],
        ['DEVBOX', '/w/upper'],
        ['gone', '/w/gone'],
        ['other', '/w/c'],
      ),
      'devbox',
      'other',
      'empty',
    );
    deepStrictEqual(
      nodes.map(node => [
        node.hostRow.alias,
        node.folders.map(folder => folder.folderRow.path),
      ]),
      [
        ['devbox', ['/w/a', '/w/b']],
        ['other', ['/w/c']],
        ['empty', []],
      ],
    );
  });

  it('F-5104.AC-27: a folder row shows its label, its path and its tooltip, has no icon, is a leaf and has no children', async () => {
    const scenario = setup();
    const [host] = await hostsFor(
      scenario,
      historyOf(['devbox', '/w/bravo']),
      'devbox',
    );
    const folder = host?.folders[0];
    deepStrictEqual(
      [
        folder === undefined ? undefined : scenario.targets.itemOf(folder),
        folder === undefined
          ? undefined
          : await scenario.targets.children(folder),
      ],
      [
        {
          id: 'ssh-folder:0:devbox',
          label: 'bravo',
          description: '/w/bravo',
          tooltip: "'/w/bravo' on devbox",
          contextValue: 'remote-explorer.remoteFolder',
          collapsibleState: 'none',
        },
        [],
      ],
    );
  });

  it('F-5104.BR-3: the children of a host are its folder nodes, repeats kept', async () => {
    const scenario = setup();
    const [host] = await hostsFor(
      scenario,
      historyOf(['devbox', '/w/a', '/w/a']),
      'devbox',
    );
    deepStrictEqual(
      host === undefined
        ? undefined
        : (await scenario.targets.children(host)).map(node =>
            node.kind === 'sshFolder' ? node.folderRow.rowId : node.kind,
          ),
      ['ssh-folder:0:devbox', 'ssh-folder:1:devbox'],
    );
  });

  it('F-5902.5.order, F-5104.BR-10: the first render waits for the history too, and a full build changes once after all three answered', async () => {
    const scenario = setup();
    const pending = held<FoldersHistory>();
    scenario.calls.history = () => {
      scenario.calls.order.push('history');
      return pending.promise;
    };
    void scenario.targets.rebuild();
    await scenario.settleAll(answered(pullOf(false)), answered(hostsOf('a')));
    const before = scenario.changes.length;
    pending.settle(answered(historyOf(['a', '/w/x'])));
    await scenario.hosts();
    deepStrictEqual([before, scenario.changes.length], [0, 1]);
  });

  it('F-5902.AC-16: a history that fails shows the host rows as leaves', async () => {
    const scenario = setup();
    scenario.calls.historyAnswer = UNAVAILABLE;
    void scenario.targets.rebuild();
    await scenario.settleAll(answered(pullOf(false)), answered(hostsOf('a')));
    const [host] = await scenario.hosts();
    deepStrictEqual(
      [
        host?.folders,
        host === undefined
          ? undefined
          : scenario.targets.itemOf(host).collapsibleState,
      ],
      [[], 'none'],
    );
  });

  it('F-5104.BR-10: a hosts-only build keeps the history of the last full build', async () => {
    const scenario = setup();
    await hostsFor(scenario, historyOf(['a', '/w/x']), 'a');
    scenario.configChanged();
    scenario.calls.hosts[1]?.settle(answered(hostsOf('a', 'b')));
    await scenario.targets.children(undefined);
    const nodes = await scenario.hosts();
    deepStrictEqual(
      [
        nodes.map(node => [node.hostRow.alias, node.folders.length]),
        scenario.calls.order,
      ],
      [
        [
          ['a', 1],
          ['b', 0],
        ],
        ['activeRemote', 'history', 'hostnames', 'hostnames'],
      ],
    );
  });

  it('F-5104.BR-7: a host with history starts expanded, one without a leaf, and with the collapse setting on every host starts collapsed', async () => {
    const scenario = setup();
    const history = historyOf(['with', '/w/x']);
    async function states(): Promise<string[]> {
      return (await scenario.hosts()).map(
        node => scenario.targets.itemOf(node).collapsibleState,
      );
    }
    await hostsFor(scenario, history, 'with', 'without');
    const collapseOff = await states();
    scenario.settings.collapse = true;
    await hostsFor(scenario, history, 'with', 'without');
    deepStrictEqual(
      [collapseOff, await states()],
      [
        ['expanded', 'none'],
        ['collapsed', 'collapsed'],
      ],
    );
  });

  for (const [value, collapsed] of [
    ['true', true],
    ['false', true],
    [1, true],
    [0, false],
    ['', false],
    [undefined, false],
    [null, false],
  ] as const) {
    it(`F-5104.BR-7: the collapse setting ${JSON.stringify(value)} is read by truthiness`, async () => {
      const scenario = setup();
      scenario.settings.collapse = value;
      const [host] = await hostsFor(scenario, historyOf(['a', '/w/x']), 'a');
      deepStrictEqual(
        host === undefined
          ? undefined
          : scenario.targets.itemOf(host).collapsibleState === 'collapsed',
        collapsed,
      );
    });
  }

  it('F-5104.BR-5: the alphabetical setting orders the rows of a host by the recorded string, and any other value keeps the recorded order', async () => {
    const scenario = setup();
    const history = historyOf(['a', '/w/b', '/w/A', '/w/a']);
    async function order(): Promise<string[]> {
      const [host] = await hostsFor(scenario, history, 'a');
      return host?.folders.map(folder => folder.folderRow.path) ?? [];
    }
    const recorded = await order();
    scenario.settings.sortOrder = 'alphabetical';
    const sorted = await order();
    scenario.settings.sortOrder = 'Alphabetical';
    deepStrictEqual(
      [recorded, sorted, await order()],
      [
        ['/w/b', '/w/A', '/w/a'],
        ['/w/A', '/w/a', '/w/b'],
        ['/w/b', '/w/A', '/w/a'],
      ],
    );
  });

  it('F-5104.BR-10: a setting change rebuilds nothing by itself, and the next full build reads it', async () => {
    const scenario = setup();
    await hostsFor(scenario, historyOf(['a', '/w/x']), 'a');
    const before = [scenario.calls.order.length, scenario.changes.length];
    scenario.settings.collapse = true;
    const [host] = await scenario.hosts();
    const unchanged = [
      scenario.calls.order.length,
      scenario.changes.length,
      host === undefined
        ? undefined
        : scenario.targets.itemOf(host).collapsibleState,
    ];
    const [after] = await hostsFor(scenario, historyOf(['a', '/w/x']), 'a');
    deepStrictEqual(
      [
        unchanged,
        after === undefined
          ? undefined
          : scenario.targets.itemOf(after).collapsibleState,
      ],
      [[before[0], before[1], 'expanded'], 'collapsed'],
    );
  });

  it('F-5104.BR-9: the ids of the rows stay the same across a Refresh, so a manual expansion is kept', async () => {
    const scenario = setup();
    async function idsOf(): Promise<string[]> {
      return (await scenario.hosts()).flatMap(node => [
        scenario.targets.itemOf(node).id,
        ...node.folders.map(folder => scenario.targets.itemOf(folder).id),
      ]);
    }
    await hostsFor(scenario, historyOf(['a', '/w/x', '/w/y']), 'a', 'b');
    const first = await idsOf();
    await hostsFor(scenario, historyOf(['a', '/w/x', '/w/y']), 'a', 'b');
    deepStrictEqual(await idsOf(), first);
  });

  it('F-5104.BR-13: dropFolder removes every row of the path under the host at once, with one change and no new call, and leaves the other hosts alone', async () => {
    const scenario = setup();
    await hostsFor(
      scenario,
      historyOf(['a', '/w/x', '/w/y', '/w/x'], ['b', '/w/x']),
      'a',
      'b',
    );
    const calls = scenario.calls.order.length;
    const changes = scenario.changes.length;
    scenario.targets.dropFolder('a', '/w/x');
    const nodes = await scenario.hosts();
    deepStrictEqual(
      [
        nodes.map(node => node.folders.map(folder => folder.folderRow.path)),
        scenario.calls.order.length - calls,
        scenario.changes.length - changes,
      ],
      [[['/w/y'], ['/w/x']], 0, 1],
    );
  });

  it('F-5104.BR-13: dropping the last folder of a host leaves a leaf, and after dispose nothing changes', async () => {
    const scenario = setup();
    const [host] = await hostsFor(scenario, historyOf(['a', '/w/x']), 'a');
    scenario.targets.dropFolder('a', '/w/x');
    const [dropped] = await scenario.hosts();
    scenario.targets.dispose();
    const changes = scenario.changes.length;
    scenario.targets.dropFolder('a', '/w/y');
    deepStrictEqual(
      [
        host === undefined
          ? undefined
          : scenario.targets.itemOf(host).collapsibleState,
        dropped === undefined
          ? undefined
          : scenario.targets.itemOf(dropped).collapsibleState,
        scenario.changes.length - changes,
      ],
      ['expanded', 'none', 0],
    );
  });

  it('F-5104.BR-13: dropping a path under a host the history does not hold changes the rows of no host', async () => {
    const scenario = setup();
    await hostsFor(scenario, historyOf(['a', '/w/x']), 'a');
    scenario.targets.dropFolder('unknown', '/w/x');
    deepStrictEqual(
      (await scenario.hosts()).map(node =>
        node.folders.map(folder => folder.folderRow.path),
      ),
      [['/w/x']],
    );
  });

  it('F-5002.19: folderOf gives the node itself when it is a folder node of the current list, and nothing for any other value', async () => {
    const scenario = setup();
    const [host] = await hostsFor(scenario, historyOf(['a', '/w/x']), 'a');
    const folder = host?.folders[0];
    const [renewed] = await hostsFor(scenario, historyOf(['a', '/w/x']), 'a');
    deepStrictEqual(
      [
        scenario.targets.folderOf(renewed?.folders[0]) === renewed?.folders[0],
        scenario.targets.folderOf(folder),
        scenario.targets.folderOf(host),
        scenario.targets.folderOf({...renewed?.folders[0]}),
        scenario.targets.folderOf('x'),
      ],
      [true, undefined, undefined, undefined, undefined],
    );
  });
});
