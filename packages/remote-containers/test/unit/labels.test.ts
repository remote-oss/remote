import {deepStrictEqual} from 'node:assert';
import {
  type ContainerFacts,
  createdKey,
  decide,
  discoveryArguments,
  idLabels,
} from '../../src/lifecycle/labels.ts';

const FOLDER = '/w/a b';
const CONFIG = '/w/a b/.devcontainer/devcontainer.json';

/** A container labelled for `folder` and `config` (none when null), created at `created`. */
function container(
  containerId: string,
  status: string,
  created: string,
  config: string | null = CONFIG,
  folder = FOLDER,
): ContainerFacts {
  return {
    id: containerId,
    created,
    status,
    labels: {
      'devcontainer.local_folder': folder,
      ...(config === null ? {} : {'devcontainer.config_file': config}),
    },
  };
}

const EARLIER = '2026-10-14T03:00:28.107239685Z';
const LATER = '2026-10-14T03:05:00Z';

describe('how a folder is labelled and its container chosen', () => {
  it('C7: the id labels are the folder and the configuration file, in that order', () => {
    deepStrictEqual(idLabels(FOLDER, CONFIG), [
      'devcontainer.local_folder=/w/a b',
      'devcontainer.config_file=/w/a b/.devcontainer/devcontainer.json',
    ]);
  });

  it('contracts 6: the discovery query holds a folder with spaces, quotes and a comma as one unchanged element', () => {
    deepStrictEqual(discoveryArguments('/w/x,"y" z'), [
      'ps',
      '-a',
      '-q',
      '--no-trunc',
      '--filter',
      'label=devcontainer.local_folder=/w/x,"y" z',
    ]);
  });

  it("F-0409 AC-3 (C7's half): no container gives create", () => {
    deepStrictEqual(decide(FOLDER, CONFIG, []), {kind: 'create'});
  });

  for (const status of ['running', 'exited', 'created'] as const) {
    it(`F-0409 BR-3: a ${status} container of the exact pair is used`, () => {
      deepStrictEqual(
        decide(FOLDER, CONFIG, [container('c1', status, EARLIER)]),
        {kind: 'use', containerId: 'c1', status},
      );
    });
  }

  for (const status of ['paused', 'restarting', 'dead', 'frozen']) {
    it(`F-0409 BR-3: a ${status} container is unusable`, () => {
      deepStrictEqual(
        decide(FOLDER, CONFIG, [container('c1', status, EARLIER)]),
        {kind: 'unusable', containerId: 'c1', status},
      );
    });
  }

  it('F-0409 AC-15: a container of another configuration file is never a candidate', () => {
    const other = container('c1', 'running', EARLIER, '/w/a b/other.json');
    deepStrictEqual(
      [
        decide(FOLDER, CONFIG, [other]),
        decide(FOLDER, '/w/a b/other.json', [other]),
      ],
      [{kind: 'create'}, {kind: 'use', containerId: 'c1', status: 'running'}],
    );
  });

  it('F-0409 BR-2: a container with the folder label only is used', () => {
    deepStrictEqual(
      decide(FOLDER, CONFIG, [container('c1', 'exited', EARLIER, null)]),
      {kind: 'use', containerId: 'c1', status: 'exited'},
    );
  });

  it('F-0409 BR-2: an exact pair older than a folder-only container still wins, since tiers come before age', () => {
    deepStrictEqual(
      decide(FOLDER, CONFIG, [
        container('old-exact', 'exited', EARLIER),
        container('new-folder', 'running', LATER, null),
      ]),
      {kind: 'use', containerId: 'old-exact', status: 'exited'},
    );
  });

  it('F-0409 BR-3: of two exact pairs the newer wins, whatever its status', () => {
    deepStrictEqual(
      decide(FOLDER, CONFIG, [
        container('old', 'running', EARLIER),
        container('new', 'exited', LATER),
      ]),
      {kind: 'use', containerId: 'new', status: 'exited'},
    );
  });

  it('F-0409 AC-25: a container being removed is not a candidate', () => {
    deepStrictEqual(
      [
        decide(FOLDER, CONFIG, [container('c1', 'removing', LATER)]),
        decide(FOLDER, CONFIG, [
          container('c1', 'removing', LATER),
          container('c2', 'exited', EARLIER),
        ]),
      ],
      [{kind: 'create'}, {kind: 'use', containerId: 'c2', status: 'exited'}],
    );
  });

  it('F-0409 AC-28: a folder reached through a link is another string, so it gets a new container', () => {
    deepStrictEqual(
      decide('/link/w', CONFIG, [
        container('c1', 'running', EARLIER, CONFIG, '/real/w'),
      ]),
      {kind: 'create'},
    );
  });

  it('C7: a fraction the engine trimmed sorts as time', () => {
    deepStrictEqual(
      [
        createdKey('2026-10-14T03:00:28.1Z') >
          createdKey('2026-10-14T03:00:28.09Z'),
        createdKey('2026-10-14T03:00:28Z') <
          createdKey('2026-10-14T03:00:28.000000001Z'),
      ],
      [true, true],
    );
  });

  it('C7: a time of another form is its own key', () => {
    deepStrictEqual(createdKey('yesterday'), 'yesterday');
  });

  it('C7: two equal creation times give the greater id, in either order', () => {
    const left = container('aa', 'exited', EARLIER);
    const right = container('bb', 'exited', EARLIER);
    deepStrictEqual(
      [
        decide(FOLDER, CONFIG, [left, right]),
        decide(FOLDER, CONFIG, [right, left]),
      ],
      [
        {kind: 'use', containerId: 'bb', status: 'exited'},
        {kind: 'use', containerId: 'bb', status: 'exited'},
      ],
    );
  });
});
