import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  inspectArguments,
  LIST_ARGUMENTS,
  listedContainersOf,
} from '../../src/explorer/listed-containers.ts';

const RECORDED = readFileSync(
  path.join(
    import.meta.dirname,
    '..',
    'fixtures',
    'docker-inspect-containers.json',
  ),
  'utf8',
);

/** A minimal element of `docker inspect`'s array, with `changes` merged over it. */
function element(
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ['Id']: 'a'.repeat(64),
    Name: '/web',
    Created: '2026-10-15T01:00:00.5Z',
    Config: {Image: 'nginx:1', Labels: {}},
    State: {
      Status: 'running',
      StartedAt: '2026-10-15T01:00:01Z',
      FinishedAt: '0001-01-01T00:00:00Z',
    },
    ...changes,
  };
}

describe('the containers the Dev Containers view lists (card containers-29)', () => {
  it('F-0901 §16: the listing asks for every id in full, and the inspection for containers only', () => {
    deepStrictEqual(
      [LIST_ARGUMENTS, inspectArguments(['one', 'two'])],
      [
        ['ps', '-a', '-q', '--no-trunc'],
        ['inspect', '--type', 'container', 'one', 'two'],
      ],
    );
  });

  it('listedContainersOf: a recorded docker inspect array gives the facts the view reads', () => {
    const listed = listedContainersOf(RECORDED) ?? [];
    deepStrictEqual(
      listed.map(container => ({
        name: container.name,
        image: container.image,
        state: container.state,
        idLength: container.id.length,
        created: new Date(container.createdAt).toISOString().slice(0, 19),
        started: container.startedAt !== undefined,
        finished: container.finishedAt !== undefined,
        labels: container.labels,
      })),
      [
        {
          name: 'fixture-dev',
          image: 'alpine:latest',
          state: 'created',
          idLength: 64,
          created: '2026-10-15T01:03:49',
          started: false,
          finished: false,
          labels: {
            'devcontainer.config_file':
              '/tmp/proj/.devcontainer/devcontainer.json',
            'devcontainer.local_folder': '/tmp/proj',
          },
        },
        {
          name: 'fixture-plain',
          image: 'alpine:latest',
          state: 'running',
          idLength: 64,
          created: '2026-10-15T01:03:49',
          started: true,
          finished: false,
          labels: {},
        },
        {
          name: 'fixture-stopped',
          image: 'alpine:latest',
          state: 'exited',
          idLength: 64,
          created: '2026-10-15T01:03:49',
          started: true,
          finished: true,
          labels: {},
        },
      ],
    );
  });

  it('listedContainersOf: the engine’s time keeps its milliseconds, and the zero time is none', () => {
    const [container] = listedContainersOf(JSON.stringify([element()])) ?? [];
    deepStrictEqual(
      [container?.createdAt, container?.startedAt, container?.finishedAt],
      [
        Date.parse('2026-10-15T01:00:00.500Z'),
        Date.parse('2026-10-15T01:00:01Z'),
        undefined,
      ],
    );
  });

  it('listedContainersOf: the zero time with a fraction is none too, and a time that is not a time is none', () => {
    const [container] =
      listedContainersOf(
        JSON.stringify([
          element({
            State: {
              Status: 'exited',
              StartedAt: '0001-01-01T00:00:00.000000000Z',
              FinishedAt: 'yesterday',
            },
          }),
        ]),
      ) ?? [];
    deepStrictEqual(
      [container?.startedAt, container?.finishedAt],
      [undefined, undefined],
    );
  });

  it('listedContainersOf: null labels are none, and a label that is not text is left out', () => {
    const listed =
      listedContainersOf(
        JSON.stringify([
          element({Config: {Image: 'a', Labels: null}}),
          element({Config: {Image: 'b', Labels: {kept: 'yes', dropped: 3}}}),
          element({Config: {Image: 'c'}}),
        ]),
      ) ?? [];
    deepStrictEqual(
      listed.map(container => container.labels),
      [{}, {kept: 'yes'}, {}],
    );
  });

  it('listedContainersOf: the name loses only its leading slash', () => {
    const [container] =
      listedContainersOf(JSON.stringify([element({Name: '/a/b'})])) ?? [];
    deepStrictEqual(container?.name, 'a/b');
  });

  it('listedContainersOf: an empty array is no containers', () => {
    deepStrictEqual(listedContainersOf('[]'), []);
  });

  it('listedContainersOf: output that is not an array of containers is none', () => {
    deepStrictEqual(
      [
        'Error response from daemon: boom',
        '',
        '{}',
        'null',
        '[3]',
        JSON.stringify([element(), {['Id']: 'x'}]),
        JSON.stringify([element({Created: 'never'})]),
        JSON.stringify([element({Config: null})]),
        JSON.stringify([element({State: []})]),
      ].map(listedContainersOf),
      Array.from({length: 9}, () => undefined),
    );
  });
});
