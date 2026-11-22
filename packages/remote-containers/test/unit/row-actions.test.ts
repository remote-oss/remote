import {deepStrictEqual} from 'node:assert';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  type Confirmation,
  containerRowOf,
  rowActionsOf,
} from '../../src/explorer/row-actions.ts';
import type {ListedContainer} from '../../src/explorer/listed-containers.ts';
import type {ListedVolume} from '../../src/explorer/listed-volumes.ts';
import type {TargetRow} from '../../src/explorer/targets-model.ts';

/** What a scripted Docker answers to an argument list. */
type Script = (argv: readonly string[]) => EngineRunOutcome;

/** A row of the view with the `viewItem` tokens given. */
function rowWith(viewItem: string, label = 'proj'): TargetRow {
  return {
    id: 'target',
    label,
    description: 'name',
    tooltip: '',
    icon: 'vm',
    viewItem,
    children: [],
  };
}

const EXITED = rowWith('container dev exited start remove details inspect log');

const RUNNING = rowWith(
  'container dev running stop remove details inspect log',
);

function finished(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}

/** The inspect output of containers with these `Mounts`. */
function inspectOf(...mounts: unknown[][]): string {
  return JSON.stringify(mounts.map(each => ({Mounts: each})));
}

const NAMED = {Type: 'volume', Name: 'data'};

/** Everything the actions touched, in order. */
interface Scene {
  events: string[];
  confirmations: Confirmation[];
  errors: string[];
}

/** The actions over a scripted Docker, with `confirmed` as the answer of every dialog. */
function sceneOf(
  script: Script,
  options: {
    confirmed?: boolean | boolean[];
    engine?: boolean;
    program?: string;
    containers?: ListedContainer[];
    volumes?: ListedVolume[];
    listFails?: boolean;
  } = {},
) {
  const scene: Scene = {events: [], confirmations: [], errors: []};
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      scene.events.push(argv.join(' '));
      return Promise.resolve(script(argv));
    },
    spawn: () => Promise.resolve({kind: 'failed', detail: 'no spawn'}),
  };
  const actions = rowActionsOf({
    engine: () => (options.engine === false ? undefined : engine),
    program: () => options.program ?? 'docker',
    confirm: confirmation => {
      scene.confirmations.push(confirmation);
      scene.events.push('dialog');
      const answers = options.confirmed ?? true;
      return Promise.resolve(
        typeof answers === 'boolean'
          ? answers
          : (answers[scene.confirmations.length - 1] ?? true),
      );
    },
    listed: () => ({
      containers: () =>
        options.listFails === true
          ? Promise.reject(new Error('no list'))
          : Promise.resolve(options.containers ?? []),
      volumes: () => Promise.resolve(options.volumes ?? []),
    }),
    showError: text => {
      scene.events.push(`error: ${text}`);
      scene.errors.push(text);
    },
    refresh: () => {
      scene.events.push('refresh');
      return Promise.resolve();
    },
    translate: template => template,
    cancellation: new AbortController().signal,
  });
  return {scene, actions};
}

/** A Docker that answers every query with nothing and every action with success. */
function quiet(): EngineRunOutcome {
  return finished(0);
}

describe('the row actions of the Dev Containers view (card containers-102)', () => {
  it('F-0902 AC-56: only a container row of the view is a row; a group, a value of another kind and nothing are not', () => {
    deepStrictEqual(
      [
        containerRowOf(EXITED),
        containerRowOf(undefined),
        containerRowOf('target'),
        containerRowOf({id: 'x', label: 'y', rows: []}),
        containerRowOf({...EXITED, viewItem: 'group'}),
        containerRowOf({...EXITED, viewItem: 'dev exited'}),
        containerRowOf({...EXITED, viewItem: 'container other exited'})?.id,
        containerRowOf({...EXITED, id: 3}),
      ],
      [
        EXITED,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'target',
        undefined,
      ],
    );
  });

  it('F-0902 AC-56: each command called with no row does nothing: no engine call, dialog, notification or refresh', async () => {
    const {scene, actions} = sceneOf(quiet);
    for (const argument of [undefined, 'target', {}, 42]) {
      await actions.start(argument);
      await actions.stop(argument);
      await actions.remove(argument);
    }
    deepStrictEqual(scene.events, []);
  });

  it('F-0902 AC-5, BR-12: Start runs docker start on the row’s container with no dialog and no notice', async () => {
    const {scene, actions} = sceneOf(quiet);
    await actions.start(EXITED);
    deepStrictEqual(scene.events, ['start target']);
  });

  it('F-0902 AC-25: a Start that exits with a status, or cannot run, or has no engine, is the error S170 naming the command', async () => {
    const results: string[][] = [];
    for (const [script, options] of [
      [() => finished(125), {}],
      [() => ({kind: 'failed', detail: 'gone'}) as const, {}],
      [quiet, {engine: false}],
      [() => finished(1), {program: 'podman'}],
    ] as const) {
      const {scene, actions} = sceneOf(script, options);
      await actions.start(EXITED);
      results.push(scene.errors);
    }
    deepStrictEqual(results, [
      ['Error starting container: Command failed: docker start target'],
      ['Error starting container: Command failed: docker start target'],
      ['Error starting container: Command failed: docker start target'],
      ['Error starting container: Command failed: podman start target'],
    ]);
  });

  it('F-0902 AC-3: Stop shows only a detail naming the row’s label, with the Stop Container button, and Cancel stops nothing', async () => {
    const {scene, actions} = sceneOf(quiet, {confirmed: false});
    await actions.stop(rowWith(RUNNING.viewItem, 'alpine:latest'));
    deepStrictEqual(
      [scene.confirmations, scene.events],
      [
        [
          {
            message: '',
            detail: 'Stop alpine:latest?',
            accept: 'Stop Container',
          },
        ],
        ['dialog'],
      ],
    );
  });

  it('F-0902 AC-3: a confirmed Stop runs docker stop with no other call', async () => {
    const {scene, actions} = sceneOf(quiet);
    await actions.stop(RUNNING);
    deepStrictEqual(scene.events, ['dialog', 'stop target']);
  });

  it('F-0902 AC-36: a Stop that fails is the error S171 naming the command, and the dialog came first', async () => {
    const {scene, actions} = sceneOf(() => finished(1));
    await actions.stop(RUNNING);
    deepStrictEqual(scene.events, [
      'dialog',
      'stop target',
      'error: Error stopping container: Command failed: docker stop target',
    ]);
  });

  it('F-0902 AC-1: Remove asks with the message S291, the detail S369 and the button Remove; Cancel runs nothing after the queries', async () => {
    const {scene, actions} = sceneOf(quiet, {confirmed: false});
    await actions.remove(EXITED);
    deepStrictEqual(
      [
        scene.confirmations,
        scene.events.filter(
          each => !each.startsWith('inspect') && each !== 'dialog',
        ),
      ],
      [
        [
          {
            message: 'Remove this container?',
            detail:
              'This action is not reversible and deletes the container permanently.',
            accept: 'Remove',
          },
        ],
        [],
      ],
    );
  });

  it('F-0902 AC-1: a confirmed Remove of an exited container runs docker rm and never rm -f or stop', async () => {
    const {scene, actions} = sceneOf(quiet);
    await actions.remove(EXITED);
    deepStrictEqual(
      scene.events.filter(
        each => each.startsWith('rm') || each.startsWith('stop'),
      ),
      ['rm target'],
    );
  });

  it('F-0902 AC-2: a confirmed Remove of a running container stops it first, waits for the stop, then removes it', async () => {
    const {scene, actions} = sceneOf(quiet);
    await actions.remove(RUNNING);
    deepStrictEqual(
      scene.events.filter(
        each => each.startsWith('rm') || each.startsWith('stop'),
      ),
      ['stop target', 'rm target'],
    );
  });

  it('F-0902 AC-37: a Remove whose rm fails is the error S168 naming rm, and the view is read again', async () => {
    const {scene, actions} = sceneOf(argv =>
      argv[0] === 'rm' ? finished(1) : finished(0),
    );
    await actions.remove(EXITED);
    deepStrictEqual(scene.events.slice(-3), [
      'rm target',
      'error: Error removing container: Command failed: docker rm target',
      'refresh',
    ]);
  });

  it('F-0902 AC-37: a Remove of a running container whose stop fails gives S171 and then S168 with the stop command, and no rm', async () => {
    const {scene, actions} = sceneOf(argv =>
      argv[0] === 'stop' ? finished(1) : finished(0),
    );
    await actions.remove(RUNNING);
    deepStrictEqual(
      [scene.errors, scene.events.some(each => each.startsWith('rm'))],
      [
        [
          'Error stopping container: Command failed: docker stop target',
          'Error removing container: Command failed: docker stop target',
        ],
        false,
      ],
    );
  });

  it('F-0902 AC-51: a Remove of a container another window removed is S168 with the rm command, and the stale row goes', async () => {
    const {scene, actions} = sceneOf(argv =>
      argv[0] === 'rm'
        ? {kind: 'ran', status: 1, stdout: '', stderr: 'No such container'}
        : finished(0),
    );
    await actions.remove(EXITED);
    deepStrictEqual(
      [scene.errors, scene.events.at(-1)],
      [
        ['Error removing container: Command failed: docker rm target'],
        'refresh',
      ],
    );
  });

  /** A Docker that has `own` for the target’s mounts and `others` for the other containers’. */
  function mountsScript(own: unknown[], ...others: unknown[][]): Script {
    return argv => {
      if (argv[0] === 'ps') {
        return finished(
          0,
          [
            'target',
            ...[...others.keys()].map(index => `other${String(index)}`),
          ].join('\n'),
        );
      }
      if (argv[0] === 'inspect') {
        return argv.includes('target')
          ? finished(0, inspectOf(own))
          : finished(0, inspectOf(...others));
      }
      return finished(0);
    };
  }

  /** The detail of the Remove dialog of the target over `script`. */
  async function detailOf(script: Script): Promise<string | undefined> {
    const {scene, actions} = sceneOf(script, {confirmed: false});
    await actions.remove(EXITED);
    return scene.confirmations[0]?.detail;
  }

  const WORDS =
    'This action is not reversible and deletes the container permanently.';

  it('F-0902 AC-24: a volume and a folder no other container uses each add the line S373, in mount order', async () => {
    deepStrictEqual(
      await detailOf(
        mountsScript([NAMED, {Type: 'bind', Source: '/home/u/proj'}]),
      ),
      `${WORDS}\nThis is the last container using 'data'.\nThis is the last container using '/home/u/proj'.`,
    );
  });

  it('F-0902 AC-24: the lines come in the order of the paths the mounts are mounted at, whatever order the engine lists them in', async () => {
    const volume = {Type: 'volume', Name: 'data', Destination: '/data'};
    const folder = {Type: 'bind', Source: '/home/u/proj', Destination: '/mnt'};
    deepStrictEqual(
      [
        await detailOf(mountsScript([volume, folder])),
        await detailOf(mountsScript([folder, volume])),
      ],
      [
        `${WORDS}\nThis is the last container using 'data'.\nThis is the last container using '/home/u/proj'.`,
        `${WORDS}\nThis is the last container using 'data'.\nThis is the last container using '/home/u/proj'.`,
      ],
    );
  });

  it('F-0902 AC-24: a mount another container uses adds no line, and the other mount still does', async () => {
    deepStrictEqual(
      await detailOf(
        mountsScript([NAMED, {Type: 'bind', Source: '/home/u/proj'}], [NAMED]),
      ),
      `${WORDS}\nThis is the last container using '/home/u/proj'.`,
    );
  });

  it('F-0902 AC-24: the vscode volume, an anonymous volume, a mount of another kind and a container with no mounts add no line', async () => {
    deepStrictEqual(
      [
        await detailOf(
          mountsScript([
            {Type: 'volume', Name: 'vscode'},
            {Type: 'volume', Name: 'a'.repeat(64)},
            {Type: 'tmpfs', Destination: '/tmp'},
            {Type: 'volume'},
            {Type: 'bind'},
          ]),
        ),
        await detailOf(mountsScript([])),
      ],
      [WORDS, WORDS],
    );
  });

  it('F-0902 AC-24: a volume and a folder of the same text are told apart, and with no other container no second query is made', async () => {
    const {scene, actions} = sceneOf(
      mountsScript([NAMED], [{Type: 'bind', Source: 'data'}]),
      {confirmed: false},
    );
    await actions.remove(EXITED);
    deepStrictEqual(
      scene.confirmations[0]?.detail,
      `${WORDS}\nThis is the last container using 'data'.`,
    );
  });

  it('F-0902 AC-24: when Docker cannot be asked for the mounts, the dialog has only S369', async () => {
    deepStrictEqual(
      [
        await detailOf(() => finished(1)),
        await detailOf(() => finished(0, 'not json')),
        await detailOf(() => finished(0, '{"Mounts":[]}')),
        await detailOf(argv =>
          argv[0] === 'inspect'
            ? finished(0, inspectOf([NAMED]))
            : finished(0, 'target'),
        ),
      ],
      [
        WORDS,
        WORDS,
        WORDS,
        `${WORDS}\nThis is the last container using 'data'.`,
      ],
    );
  });

  /** A listed container with the labels and the volumes given. */
  function listed(
    containerId: string,
    labels: Record<string, string>,
    volumes: string[],
    createdAt = 1,
  ): ListedContainer {
    return {
      id: containerId,
      name: containerId,
      image: 'image',
      state: 'exited',
      createdAt,
      startedAt: undefined,
      finishedAt: undefined,
      labels,
      binds: [],
      volumes,
    };
  }

  const UNIQUE_VOLUME: ListedVolume = {
    name: 'repo-volume',
    labels: {'vsch.local.repository.unique': 'true'},
  };
  const OWN = listed(
    'target',
    {'vsch.local.repository.volume': 'repo-volume'},
    ['repo-volume'],
  );

  it('F-0904 AC-11: a Remove whose container names a unique volume no other container mounts asks the second dialog S347/S133, and Remove deletes the container and then the volume', async () => {
    const {scene, actions} = sceneOf(quiet, {
      containers: [OWN],
      volumes: [UNIQUE_VOLUME],
    });
    await actions.remove(EXITED);
    deepStrictEqual(
      [
        scene.confirmations.map(each => [
          each.message,
          each.detail,
          each.accept,
          each.severity,
        ]),
        scene.events.filter(
          event => event.startsWith('rm ') || event.startsWith('volume'),
        ),
      ],
      [
        [
          [
            'Remove this container?',
            'This action is not reversible and deletes the container permanently.',
            'Remove',
            undefined,
          ],
          [
            'The container is using a volume with a cloned repository.',
            'Do you want to remove the volume and the data it contains?',
            'Remove',
            'info',
          ],
        ],
        ['rm target', 'volume rm repo-volume'],
      ],
    );
  });

  it('F-0904 AC-11: Cancel on the second dialog deletes only the container', async () => {
    const {scene, actions} = sceneOf(quiet, {
      confirmed: [true, false],
      containers: [OWN],
      volumes: [UNIQUE_VOLUME],
    });
    await actions.remove(EXITED);
    deepStrictEqual(
      scene.events.filter(
        event => event.startsWith('rm ') || event.startsWith('volume'),
      ),
      ['rm target'],
    );
  });

  it('F-0904 AC-12, AC-13, AC-35, AC-36: no second dialog for a devVolume, for a container with no volume label, for a volume another container mounts in any state, or when the label names no volume; one for a volume that only another container’s label names', async () => {
    const asked = async (
      containers: ListedContainer[],
      volumes: ListedVolume[],
    ): Promise<number> => {
      const {scene, actions} = sceneOf(quiet, {containers, volumes});
      await actions.remove(EXITED);
      return scene.confirmations.length;
    };
    deepStrictEqual(
      [
        await asked([OWN], [{name: 'repo-volume', labels: {}}]),
        await asked(
          [OWN],
          [
            {
              name: 'repo-volume',
              labels: {'vsch.local.repository.unique': 'false'},
            },
          ],
        ),
        await asked([listed('target', {}, ['repo-volume'])], [UNIQUE_VOLUME]),
        await asked(
          [OWN, listed('other', {}, ['repo-volume'], 2)],
          [UNIQUE_VOLUME],
        ),
        await asked([OWN], []),
        await asked([listed('else', {})], [UNIQUE_VOLUME]),
        await asked(
          [
            OWN,
            listed(
              'named',
              {'vsch.local.repository.volume': 'repo-volume'},
              [],
              2,
            ),
          ],
          [UNIQUE_VOLUME],
        ),
      ],
      [1, 1, 1, 1, 1, 1, 2],
    );
  });

  it('F-0904 AC-11: a Remove whose lists cannot be read asks only the first dialog and removes the container', async () => {
    const {scene, actions} = sceneOf(quiet, {listFails: true});
    await actions.remove(EXITED);
    deepStrictEqual(
      [
        scene.confirmations.length,
        scene.events.filter(event => event.startsWith('rm ')),
      ],
      [1, ['rm target']],
    );
  });

  it('F-0904 BR-5: a volume removal that fails after the container went is the error S169 naming the command, and the view is read again', async () => {
    const {scene, actions} = sceneOf(
      argv => (argv[0] === 'volume' ? finished(1) : finished(0)),
      {containers: [OWN], volumes: [UNIQUE_VOLUME]},
    );
    await actions.remove(EXITED);
    deepStrictEqual(scene.events.slice(-2), [
      'error: Error removing volume: Command failed: docker volume rm repo-volume',
      'refresh',
    ]);
  });
});
