import {deepStrictEqual} from 'node:assert';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import type {ListedContainer} from '../../src/explorer/listed-containers.ts';
import {
  removeVolumeOf,
  volumeNameOf,
} from '../../src/explorer/volume-actions.ts';

const UNIQUE_ROW = {name: 'owner-repo-1', viewItem: 'uniqueDevVolume'};

function finished(status: number): EngineRunOutcome {
  return {kind: 'ran', status, stdout: '', stderr: ''};
}

function mounting(volumes: string[]): ListedContainer {
  return {
    id: 'one',
    name: 'one',
    image: 'image',
    state: 'created',
    createdAt: 1,
    startedAt: undefined,
    finishedAt: undefined,
    labels: {},
    binds: [],
    volumes,
  };
}

/** Remove over a scripted Docker; every dialog, call and notice is in `events`, in order. */
function sceneOf(
  script: (argv: readonly string[]) => EngineRunOutcome,
  options: {confirmed?: boolean; containers?: ListedContainer[]} = {},
) {
  const events: string[] = [];
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      events.push(argv.join(' '));
      return Promise.resolve(script(argv));
    },
    spawn: () => Promise.resolve({kind: 'failed', detail: 'no spawn'}),
  };
  const remove = removeVolumeOf({
    engine: () => engine,
    program: () => 'docker',
    containers: () => Promise.resolve(options.containers ?? []),
    confirm: confirmation => {
      events.push(
        `confirm ${confirmation.message}|${confirmation.detail}|${confirmation.accept}`,
      );
      return Promise.resolve(options.confirmed ?? true);
    },
    inform: detail => {
      events.push(`inform ${detail}`);
      return Promise.resolve();
    },
    showError: text => {
      events.push(`error ${text}`);
    },
    refresh: () => {
      events.push('refresh');
      return Promise.resolve();
    },
    translate: template => template,
    cancellation: new AbortController().signal,
  });
  return {events, remove};
}

describe('Remove of the Dev Volumes view (card containers-167)', () => {
  it('F-0904 AC-9: a volume no container mounts asks S041 with the raw name and no message, and Remove runs docker volume rm and reads the view again', async () => {
    const {events, remove} = sceneOf(() => finished(0));
    await remove(UNIQUE_ROW);
    deepStrictEqual(events, [
      "confirm |Are you sure you want to remove volume 'owner-repo-1'?|Remove",
      'volume rm owner-repo-1',
      'refresh',
    ]);
  });

  it('F-0904 AC-9: Cancel removes nothing and reads nothing', async () => {
    const {events, remove} = sceneOf(() => finished(0), {confirmed: false});
    await remove(UNIQUE_ROW);
    deepStrictEqual(events.length, 1);
  });

  it('F-0904 AC-10, AC-17, AC-37: a volume that a container mounts, in any state, shows S394 with the raw name and no S041, and a container that only names it does not count', async () => {
    const used = sceneOf(() => finished(0), {
      containers: [mounting(['x']), mounting(['owner-repo-1'])],
    });
    await used.remove(UNIQUE_ROW);
    const named = sceneOf(() => finished(0), {containers: [mounting([])]});
    await named.remove(UNIQUE_ROW);
    deepStrictEqual(
      [used.events, named.events[0]?.slice(0, 8)],
      [
        ["inform Volume 'owner-repo-1' is in use and cannot be removed."],
        'confirm ',
      ],
    );
  });

  it('F-0904 AC-14, AC-21: a removal that fails for a volume already gone is no error, and the view is read again', async () => {
    const {events, remove} = sceneOf(() => finished(1));
    await remove(UNIQUE_ROW);
    deepStrictEqual(events.slice(1), [
      'volume rm owner-repo-1',
      'volume inspect -- owner-repo-1',
      'refresh',
    ]);
  });

  it('F-0904 AC-28: a removal Docker refuses for a volume that is still there is the error S169 naming the command, and the view is read again', async () => {
    const {events, remove} = sceneOf(argv =>
      finished(argv[1] === 'rm' ? 1 : 0),
    );
    await remove(UNIQUE_ROW);
    deepStrictEqual(events.slice(1), [
      'volume rm owner-repo-1',
      'volume inspect -- owner-repo-1',
      'error Error removing volume: Command failed: docker volume rm owner-repo-1',
      'refresh',
    ]);
  });

  it('F-0904 AC-9: anything that is not a volume row does nothing at all', async () => {
    const {events, remove} = sceneOf(() => finished(0));
    for (const argument of [
      undefined,
      'owner-repo-1',
      {name: 'x', viewItem: 'container'},
      {name: 3, viewItem: 'devVolume'},
      {viewItem: 'devVolume'},
    ]) {
      await remove(argument);
    }
    deepStrictEqual(
      [events, volumeNameOf({name: 'a', viewItem: 'devVolume'})],
      [[], 'a'],
    );
  });
});
