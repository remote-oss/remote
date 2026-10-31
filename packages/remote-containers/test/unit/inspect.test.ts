import {deepStrictEqual} from 'node:assert';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {inspectOf} from '../../src/explorer/inspect.ts';
import type {TargetRow} from '../../src/explorer/targets-model.ts';

/** A container row of the Dev Containers view. */
const CONTAINER: TargetRow = {
  id: 'target',
  label: 'proj',
  description: 'name',
  tooltip: '',
  icon: 'vm',
  viewItem: 'container dev running stop remove details inspect log',
  children: [],
};

/** The Image row of the Details view, whose description is the image the container was created from. */
const IMAGE = {
  id: 'attributes/image',
  label: 'Image',
  description: 'alpine:3.20',
  viewItem: 'image',
  children: [],
};

function finished(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}

/** Everything Inspect touched, in order. */
interface Scene {
  events: string[];
}

/** Inspect over a Docker that answers `answer`, or no Docker at all when `engine` is false. */
function sceneOf(answer: EngineRunOutcome, engine = true) {
  const scene: Scene = {events: []};
  const host: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      scene.events.push(argv.join(' '));
      return Promise.resolve(answer);
    },
    spawn: () => Promise.resolve({kind: 'failed', detail: 'no spawn'}),
  };
  const inspect = inspectOf({
    engine: () => (engine ? host : undefined),
    program: () => 'docker',
    open: content => {
      scene.events.push(`open ${content}`);
      return Promise.resolve();
    },
    showError: text => {
      scene.events.push(`error: ${text}`);
    },
    translate: template => template,
    cancellation: new AbortController().signal,
  });
  return {scene, inspect};
}

describe('Inspect of the Dev Containers view (card containers-104)', () => {
  it('F-0902 AC-11: a container row is inspected by its id, and its first object is opened, indented with tabs', async () => {
    const {scene, inspect} = sceneOf(
      finished(0, JSON.stringify([{Id: 'target', Config: {Image: 'alpine'}}])),
    );
    await inspect(CONTAINER);
    deepStrictEqual(scene.events, [
      'inspect target',
      'open {\n\t"Id": "target",\n\t"Config": {\n\t\t"Image": "alpine"\n\t}\n}',
    ]);
  });

  it('F-0902 AC-11: every call opens a document again', async () => {
    const {scene, inspect} = sceneOf(finished(0, '[{"Id":"target"}]'));
    await inspect(CONTAINER);
    await inspect(CONTAINER);
    deepStrictEqual(
      scene.events.filter(event => event.startsWith('open ')).length,
      2,
    );
  });

  it('F-0902 AC-40: the Image row of the Details view is inspected as an image, by the reference it shows', async () => {
    const {scene, inspect} = sceneOf(finished(0, '[{"Id":"sha256:1"}]'));
    await inspect(IMAGE);
    deepStrictEqual(scene.events, [
      'image inspect alpine:3.20',
      'open {\n\t"Id": "sha256:1"\n}',
    ]);
  });

  it('F-0902 AC-56: anything else than a container row or an Image row with a reference does nothing at all', async () => {
    const {scene, inspect} = sceneOf(finished(0, '[{}]'));
    for (const argument of [
      undefined,
      'target',
      {...IMAGE, viewItem: 'volume'},
      {...IMAGE, description: ''},
      {...IMAGE, description: 3},
      {id: 'g', label: 'Group', rows: []},
    ]) {
      await inspect(argument);
    }
    deepStrictEqual(scene.events, []);
  });

  it('F-0902 6.6: a failed inspect, a reply that is no array of objects and no engine show an error naming the command and open nothing', async () => {
    const outcomes: string[][] = [];
    for (const [answer, engine] of [
      [finished(1), true],
      [finished(0, 'not json'), true],
      [finished(0, '[]'), true],
      [{kind: 'failed', detail: 'no docker'} as EngineRunOutcome, true],
      [finished(0, '[{}]'), false],
    ] as const) {
      const {scene, inspect} = sceneOf(answer, engine);
      await inspect(CONTAINER);
      outcomes.push(
        scene.events.filter(event => !event.startsWith('inspect ')),
      );
    }
    deepStrictEqual(
      outcomes,
      Array.from({length: 5}, () => [
        'error: Error inspecting: Command failed: docker inspect target',
      ]),
    );
  });
});
