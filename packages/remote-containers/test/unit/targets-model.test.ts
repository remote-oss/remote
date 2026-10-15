import {deepStrictEqual} from 'node:assert';
import type {ListedContainer} from '../../src/explorer/listed-containers.ts';
import {
  type RowIcon,
  type TargetGroup,
  targetsTreeOf,
  type TargetRow,
  type TargetsInput,
  type WelcomeKey,
} from '../../src/explorer/targets-model.ts';

const FIXED_NOW = Date.parse('2026-10-15T12:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const ONE_DAY = 24 * HOUR;
const DEV_LABELS = {'devcontainer.local_folder': '/home/u/proj'};

let counter = 0;

/** A container with `changes` over a running one that never exited; every call gets its own id. */
function container(changes: Partial<ListedContainer> = {}): ListedContainer {
  counter += 1;
  return {
    id: `id${String(counter).padStart(4, '0')}`,
    name: `name${String(counter)}`,
    image: 'alpine:latest',
    state: 'running',
    createdAt: FIXED_NOW - 10 * ONE_DAY,
    startedAt: FIXED_NOW - 5 * MINUTE,
    finishedAt: undefined,
    labels: {},
    ...changes,
  };
}

/** The input for `containers`, with `changes` over a window that holds no connection and no folder. */
function inputOf(
  containers: TargetsInput['containers'],
  changes: Partial<TargetsInput> = {},
): TargetsInput {
  return {
    containers,
    window: {folderOpen: false, connection: undefined},
    withConfiguration: new Set(),
    now: FIXED_NOW,
    translate: template => template,
    ...changes,
  };
}

/** The one row of the tree of one container. */
function rowOf(
  single: ListedContainer,
  changes: Partial<TargetsInput> = {},
): TargetRow {
  const entry = targetsTreeOf(inputOf([single], changes)).groups[0]?.rows[0];
  if (entry === undefined) {
    throw new Error('no entry');
  }
  return entry;
}

/** The labels of the rows of every group, in order. */
function labelsOf(containers: ListedContainer[]): string[][] {
  return targetsTreeOf(inputOf(containers)).groups.map(group =>
    group.rows.map(entry => entry.label),
  );
}

/** The welcome key of the tree of `containers` in a window with no folder. */
function welcomeOf(
  containers: TargetsInput['containers'],
): WelcomeKey | undefined {
  return targetsTreeOf(inputOf(containers)).welcome;
}

/** The first group of the tree of `containers`. */
function firstGroupOf(containers: ListedContainer[]): TargetGroup | undefined {
  return targetsTreeOf(inputOf(containers)).groups[0];
}

/** The icons of the rows of `containers`, one container each. */
function iconsOf(containers: ListedContainer[]): RowIcon[] {
  return containers.map(single => rowOf(single).icon);
}

/** What a tooltip says after its label and name. */
function statusOf(
  container: ListedContainer,
  changes: Partial<TargetsInput> = {},
): string {
  return rowOf(container, changes).tooltip.split(') ')[1] ?? '';
}

/** The icon, the tooltip without its label and name, and the `viewItem` of each container's row. */
function summariesOf(containers: ListedContainer[]): string[][] {
  return containers.map(single => {
    const entry = rowOf(single);
    return [
      entry.icon,
      entry.tooltip.replace(/^\S+ \(\S+\) /, ''),
      entry.viewItem,
    ];
  });
}

const CONNECTION = {
  containerId: 'own',
  hostPath: '/home/u/proj',
  remoteWorkspaceFolder: '/workspaces/proj',
};

describe('the targets model (card containers-29)', () => {
  it('F-0901 AC-1, AC-2, AC-16: the three welcome keys, and an unreachable engine gives no groups', () => {
    deepStrictEqual(
      [
        targetsTreeOf(inputOf('unreachable', {containers: 'unreachable'})),
        targetsTreeOf(inputOf([])),
        targetsTreeOf(
          inputOf([], {window: {folderOpen: true, connection: undefined}}),
        ),
        welcomeOf([container()]),
      ],
      [
        {welcome: 'needsDockerStartOrInstall', groups: []},
        {welcome: 'noContainersWithoutFolder', groups: []},
        {welcome: 'noContainersWithFolder', groups: []},
        undefined,
      ],
    );
  });

  it('F-0901 AC-4: the own dev container is one merged row: label, description, vmActive, Connected, and its tokens', () => {
    const own = container({
      id: 'own',
      name: 'happy_dev',
      labels: DEV_LABELS,
    });
    const tree = targetsTreeOf(
      inputOf([own], {
        window: {folderOpen: true, connection: CONNECTION},
        withConfiguration: new Set(['own']),
      }),
    );
    deepStrictEqual(tree, {
      welcome: undefined,
      groups: [
        {
          id: 'devContainers',
          label: 'Dev Containers',
          rows: [
            {
              id: 'own',
              label: 'proj',
              description: 'happy_dev',
              tooltip: 'proj (happy_dev) Connected',
              icon: 'vmActive',
              viewItem: 'container dev running own activeFolder configuration',
              children: [],
            },
          ],
        },
      ],
    });
  });

  it('F-0901 AC-4: the own row of a window with no folder open has no activeFolder token', () => {
    const own = container({id: 'own', labels: DEV_LABELS});
    deepStrictEqual(
      rowOf(own, {window: {folderOpen: false, connection: CONNECTION}})
        .viewItem,
      'container dev running own',
    );
  });

  it('F-0901 AC-6: the same container from an unconnected window is vmRunning, Running, with no own token', () => {
    const single = container({
      id: 'own',
      name: 'happy_dev',
      labels: DEV_LABELS,
    });
    const entry = rowOf(single, {withConfiguration: new Set(['own'])});
    deepStrictEqual(
      [entry.icon, entry.tooltip, entry.viewItem],
      [
        'vmRunning',
        'proj (happy_dev) Running',
        'container dev running configuration',
      ],
    );
  });

  it('F-0901 AC-7, AC-21: the headers come in order, each only while it has rows, and Other Containers rows are labelled by image', () => {
    const devContainer = container({labels: DEV_LABELS});
    const plain = container({image: 'nginx:1'});
    deepStrictEqual(
      [
        targetsTreeOf(inputOf([plain, devContainer])).groups.map(group => [
          group.id,
          group.label,
          group.rows.map(entry => entry.label),
        ]),
        targetsTreeOf(inputOf([plain])).groups.map(group => group.id),
        targetsTreeOf(inputOf([devContainer])).groups.map(group => group.id),
      ],
      [
        [
          ['devContainers', 'Dev Containers', ['proj']],
          ['otherContainers', 'Other Containers', ['nginx:1']],
        ],
        ['otherContainers'],
        ['devContainers'],
      ],
    );
  });

  it('F-0901 AC-7: the headers’ texts go through translate', () => {
    const tree = targetsTreeOf(
      inputOf([container({labels: DEV_LABELS}), container()], {
        translate: template => `«${template}»`,
      }),
    );
    deepStrictEqual(
      tree.groups.map(group => group.label),
      ['«Dev Containers»', '«Other Containers»'],
    );
  });

  it('F-0901 AC-8, AC-9, AC-10: Created, Paused and Restarting, with their icons, tooltips and tokens', () => {
    deepStrictEqual(
      summariesOf([
        container({state: 'created', startedAt: undefined}),
        container({state: 'paused'}),
        container({
          state: 'restarting',
          startedAt: FIXED_NOW - 20 * MINUTE,
          finishedAt: FIXED_NOW - 8 * SECOND,
        }),
      ]),
      [
        ['vm', 'Created', 'container other created'],
        ['vmOutline', 'Paused', 'container other paused'],
        ['vmOutline', 'Restarting 8 seconds', 'container other restarting'],
      ],
    );
  });

  it('F-0901 AC-8: Exited uses the vm icon, and the two kinds of exit', () => {
    deepStrictEqual(
      summariesOf([
        container({
          state: 'exited',
          finishedAt: FIXED_NOW - 5 * HOUR - 21 * MINUTE,
        }),
        container({state: 'exited', finishedAt: undefined}),
      ]),
      [
        ['vm', 'Exited 5 hours ago', 'container other exited'],
        ['vm', 'Exited', 'container other exited'],
      ],
    );
  });

  it('F-0901 AC-11, AC-36, AC-54: Exited tooltips at the table’s elapsed times', () => {
    const elapsed = [
      0,
      MINUTE,
      28 * SECOND,
      33 * SECOND,
      95 * SECOND,
      30 * MINUTE + 15 * SECOND,
      66 * MINUTE,
      12 * HOUR + 18 * MINUTE,
      4 * ONE_DAY + 17 * HOUR + 39 * MINUTE,
    ];
    deepStrictEqual(
      elapsed.map(
        time =>
          rowOf(
            container({state: 'exited', finishedAt: FIXED_NOW - time}),
          ).tooltip.split(') ')[1],
      ),
      [
        'Exited 0 seconds ago',
        'Exited 1 minute ago',
        'Exited 28 seconds ago',
        'Exited 1 minute ago',
        'Exited 2 minutes ago',
        'Exited 1 hour ago',
        'Exited 1 hour ago',
        'Exited 1 day ago',
        'Exited 5 days ago',
      ],
    );
  });

  it('F-0901 AC-35, AC-39 (6.18): a container that exited before and runs again reads Running with no ago, counted from its start', () => {
    function restarted(since: number): string {
      return statusOf(
        container({
          startedAt: FIXED_NOW - since,
          finishedAt: FIXED_NOW - since - HOUR,
        }),
      );
    }
    deepStrictEqual(
      [restarted(0), restarted(45 * SECOND), restarted(7 * HOUR + 49 * MINUTE)],
      ['Running 0 seconds', 'Running 1 minute', 'Running 8 hours'],
    );
  });

  it('F-0901 AC-35, AC-39: a container that never exited is bare Running until it has run a day, and Running 1 day at 29 hours', () => {
    function running(since: number): string {
      return statusOf(container({startedAt: FIXED_NOW - since}));
    }
    deepStrictEqual(
      [
        running(2 * MINUTE),
        running(70 * MINUTE),
        running(7 * HOUR + 25 * MINUTE),
        running(29 * HOUR),
        running(2 * ONE_DAY),
      ],
      ['Running', 'Running', 'Running', 'Running 1 day', 'Running 2 days'],
    );
  });

  it('F-0901 AC-39: a paused container that exited before reads Paused with ago from its latest start; one that never did is bare', () => {
    deepStrictEqual(
      [
        rowOf(
          container({
            state: 'paused',
            startedAt: FIXED_NOW - 83 * SECOND,
            finishedAt: FIXED_NOW - HOUR,
          }),
        ).tooltip.split(') ')[1],
        statusOf(container({state: 'paused'})),
      ],
      ['Paused 1 minute ago', 'Paused'],
    );
  });

  it('F-0901 BR-5: a state with no time to count from has no clause', () => {
    deepStrictEqual(
      [
        container({state: 'running', startedAt: undefined}),
        container({
          state: 'running',
          startedAt: undefined,
          finishedAt: FIXED_NOW - HOUR,
        }),
        container({
          state: 'paused',
          startedAt: undefined,
          finishedAt: FIXED_NOW,
        }),
        container({state: 'restarting', startedAt: undefined}),
      ].map(single => rowOf(single).tooltip.split(') ')[1]),
      ['Running', 'Running', 'Paused', 'Restarting'],
    );
  });

  it('F-0901 BR-5: Restarting counts from its start when it has no exit', () => {
    deepStrictEqual(
      rowOf(
        container({state: 'restarting', startedAt: FIXED_NOW - 59 * SECOND}),
      ).tooltip.split(') ')[1],
      'Restarting 1 minute',
    );
  });

  it('F-0901 BR-5: the words of the clause go through translate', () => {
    const entry = rowOf(
      container({state: 'exited', finishedAt: FIXED_NOW - 2 * HOUR}),
      {
        translate: template =>
          ({'{0} ago': 'il y a {0}', '{0} hours': '{0} heures'})[template] ??
          template,
      },
    );
    deepStrictEqual(entry.tooltip.split(') ')[1], 'Exited il y a 2 heures');
  });

  it('F-0901 AC-24, AC-55: image references are labels as they were written', () => {
    const references = [
      `repo@sha256:${'a'.repeat(64)}`,
      `sha256:${'b'.repeat(64)}`,
      'c0ffee123456',
      'x:1',
      'alpine:latest',
    ];
    deepStrictEqual(
      references.map(image => {
        const entry = rowOf(container({image}));
        return [entry.label, entry.tooltip.startsWith(`${image} (`)];
      }),
      references.map(image => [image, true]),
    );
  });

  it('F-0901 AC-25: identical labels are broken by creation time, most recent first', () => {
    deepStrictEqual(
      firstGroupOf([
        container({
          id: 'old',
          image: 'same',
          createdAt: FIXED_NOW - 3 * ONE_DAY,
        }),
        container({id: 'new', image: 'same', createdAt: FIXED_NOW - ONE_DAY}),
        container({
          id: 'mid',
          image: 'same',
          createdAt: FIXED_NOW - 2 * ONE_DAY,
        }),
      ])?.rows.map(entry => entry.id),
      ['new', 'mid', 'old'],
    );
  });

  it('F-0901 AC-25: with the same time as well, the id keeps the order the same on every call', () => {
    function orderOf(order: string[]): string[] | undefined {
      return targetsTreeOf(
        inputOf(
          order.map(identity =>
            container({id: identity, image: 'same', createdAt: 1}),
          ),
        ),
      ).groups[0]?.rows.map(entry => entry.id);
    }
    deepStrictEqual(
      [orderOf(['b', 'a', 'c']), orderOf(['c', 'b', 'a'])],
      [
        ['a', 'b', 'c'],
        ['a', 'b', 'c'],
      ],
    );
  });

  it('F-0901 AC-48: the order of labels is the collation of an English display language', () => {
    const names = [
      'Zulu',
      'apple',
      'Banana',
      'folder10',
      'folder9',
      '_under',
      'éclair',
      'eclair',
      'fig',
      'APPLE',
      'a-b',
      'ab',
      'Ápple',
    ];
    deepStrictEqual(
      labelsOf(
        names.map(name =>
          container({labels: {'devcontainer.local_folder': `/w/${name}`}}),
        ),
      ),
      [
        [
          '_under',
          'a-b',
          'ab',
          'apple',
          'APPLE',
          'Ápple',
          'Banana',
          'eclair',
          'éclair',
          'fig',
          'folder10',
          'folder9',
          'Zulu',
        ],
      ],
    );
  });

  it('F-0901 AC-30, AC-31, AC-32, AC-42, AC-43: label families decide the group, and the configuration token comes from the input', () => {
    const current = container({id: 'c', labels: DEV_LABELS});
    const legacy = container({
      id: 'l',
      labels: {'vsch.local.folder': '/w/old'},
    });
    const repository = container({
      id: 'r',
      labels: {'vsch.local.repository': 'https://example.test/repo.git'},
    });
    const volume = container({
      id: 'v',
      labels: {'vsch.local.volume': 'volume'},
    });
    const tree = targetsTreeOf(
      inputOf([current, legacy, repository, volume], {
        withConfiguration: new Set(['c', 'v']),
      }),
    );
    deepStrictEqual(
      tree.groups.map(group => [
        group.id,
        group.rows.map(entry => [entry.id, entry.viewItem]),
      ]),
      [
        [
          'devContainers',
          [
            ['l', 'container dev running'],
            ['c', 'container dev running configuration'],
            ['r', 'container dev running'],
          ],
        ],
        ['otherContainers', [['v', 'container other running']]],
      ],
    );
  });

  it('F-0901 6.20: a container in a state the view has no token for keeps the others', () => {
    deepStrictEqual(
      [
        rowOf(container({state: 'dead'})).viewItem,
        statusOf(container({state: 'removing'})),
        iconsOf([container({state: 'dead'})])[0],
      ],
      ['container other', 'Removing', 'vm'],
    );
  });

  it('F-0901 AC-49: the folder labels of a Linux UI', () => {
    const values = [
      '/tmp/proj/',
      'c:/Users/u/fwd',
      'c:\\Users\\u\\win',
      '\\\\wsl.localhost\\Ubuntu\\home\\u\\unc',
      '/tmp/a\\b',
      '/',
      '///',
    ];
    deepStrictEqual(
      values.map(value => {
        const entry = rowOf(
          container({labels: {'devcontainer.local_folder': value}}),
        );
        return [entry.label, entry.tooltip.startsWith(`${entry.label} (`)];
      }),
      [
        ['proj', true],
        ['fwd', true],
        ['c:\\Users\\u\\win', true],
        ['\\\\wsl.localhost\\Ubuntu\\home\\u\\unc', true],
        ['a\\b', true],
        ['/', true],
        ['///', true],
      ],
    );
  });

  it('F-0901 BR-13: the headers have fixed ids, the rows are their containers’ ids, and two calls agree', () => {
    const containers = [
      container({id: 'first', labels: DEV_LABELS}),
      container({id: 'second'}),
    ];
    const first = targetsTreeOf(inputOf(containers));
    const second = targetsTreeOf(inputOf(containers));
    deepStrictEqual(
      [
        first.groups.map(group => [
          group.id,
          group.rows.map(entry => entry.id),
        ]),
        second,
      ],
      [
        [
          ['devContainers', ['first']],
          ['otherContainers', ['second']],
        ],
        first,
      ],
    );
  });

  it('F-0901 6.20: the own row of an Other Containers container stays in its group, with the active icon', () => {
    const entry = rowOf(container({id: 'own'}), {
      window: {folderOpen: true, connection: CONNECTION},
    });
    deepStrictEqual(
      [entry.icon, entry.tooltip.split(') ')[1], entry.viewItem],
      ['vmActive', 'Connected', 'container other running own'],
    );
  });
});
