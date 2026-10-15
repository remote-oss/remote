import {deepStrictEqual} from 'node:assert';
import {
  type ContainerFacts,
  createdKey,
  decide,
  discoveryArguments,
  idLabels,
  legacyDiscoveryArguments,
  legacyIdLabels,
} from '../../src/lifecycle/labels.ts';

const FOLDER = '/w/a b';
const CONFIG = '/w/a b/.devcontainer/devcontainer.json';
const LEGACY_FOLDER = '/w/p';

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

/** A legacy-labelled container for `folder`, created at `created`, with the given quality. */
function legacy(
  containerId: string,
  status: string,
  created: string,
  quality = 'stable',
  folder = LEGACY_FOLDER,
): ContainerFacts {
  return {
    id: containerId,
    created,
    status,
    labels: {'vsch.local.folder': folder, 'vsch.quality': quality},
  };
}

const EARLIER = '2026-10-14T03:00:28.107239685Z';
const LATER = '2026-10-14T03:05:00Z';
const STANDARD = idLabels(FOLDER, CONFIG);

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

  it('F-0409: the legacy query\u2019s arguments', () => {
    deepStrictEqual(legacyDiscoveryArguments('/w/a b'), [
      'ps',
      '-a',
      '-q',
      '--no-trunc',
      '--filter',
      'label=vsch.local.folder=/w/a b',
      '--filter',
      'label=vsch.quality=stable',
    ]);
  });

  it("F-0409 AC-3 (C7's half): no container gives create", () => {
    deepStrictEqual(decide(FOLDER, CONFIG, []), {kind: 'create'});
  });

  for (const status of ['running', 'exited', 'created'] as const) {
    it(`F-0409 BR-3: a ${status} container of the exact pair is used`, () => {
      deepStrictEqual(
        decide(FOLDER, CONFIG, [container('c1', status, EARLIER)]),
        {kind: 'use', containerId: 'c1', status, idLabels: STANDARD},
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
      [
        {kind: 'create'},
        {
          kind: 'use',
          containerId: 'c1',
          status: 'running',
          idLabels: idLabels(FOLDER, '/w/a b/other.json'),
        },
      ],
    );
  });

  it('F-0409 BR-2: a container with the folder label only is used', () => {
    deepStrictEqual(
      decide(FOLDER, CONFIG, [container('c1', 'exited', EARLIER, null)]),
      {kind: 'use', containerId: 'c1', status: 'exited', idLabels: STANDARD},
    );
  });

  it('F-0409 BR-2: an exact pair older than a folder-only container still wins, since tiers come before age', () => {
    deepStrictEqual(
      decide(FOLDER, CONFIG, [
        container('old-exact', 'exited', EARLIER),
        container('new-folder', 'running', LATER, null),
      ]),
      {
        kind: 'use',
        containerId: 'old-exact',
        status: 'exited',
        idLabels: STANDARD,
      },
    );
  });

  it('F-0409 BR-3: of two exact pairs the newer wins, whatever its status', () => {
    deepStrictEqual(
      decide(FOLDER, CONFIG, [
        container('old', 'running', EARLIER),
        container('new', 'exited', LATER),
      ]),
      {kind: 'use', containerId: 'new', status: 'exited', idLabels: STANDARD},
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
      [
        {kind: 'create'},
        {kind: 'use', containerId: 'c2', status: 'exited', idLabels: STANDARD},
      ],
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

  it('F-0409 AC-1: a legacy container is used', () => {
    deepStrictEqual(
      decide(LEGACY_FOLDER, CONFIG, [legacy('lc1', 'exited', EARLIER)]),
      {
        kind: 'use',
        containerId: 'lc1',
        status: 'exited',
        idLabels: legacyIdLabels(LEGACY_FOLDER),
      },
    );
  });

  it('F-0409 AC-37: a legacy container beats an older and a newer exact pair', () => {
    deepStrictEqual(
      decide(LEGACY_FOLDER, CONFIG, [
        container(
          'exact-01',
          'exited',
          '2026-01-01T00:00:00Z',
          CONFIG,
          LEGACY_FOLDER,
        ),
        legacy('legacy-02', 'exited', '2026-01-02T00:00:00Z'),
        container(
          'exact-03',
          'exited',
          '2026-01-03T00:00:00Z',
          CONFIG,
          LEGACY_FOLDER,
        ),
      ]),
      {
        kind: 'use',
        containerId: 'legacy-02',
        status: 'exited',
        idLabels: legacyIdLabels(LEGACY_FOLDER),
      },
    );
  });

  it('F-0409 AC-37: a legacy container beats a newer folder-only one', () => {
    deepStrictEqual(
      decide(LEGACY_FOLDER, CONFIG, [
        legacy('legacy-01', 'exited', '2026-01-01T00:00:00Z'),
        container(
          'folder-02',
          'running',
          '2026-01-02T00:00:00Z',
          null,
          LEGACY_FOLDER,
        ),
      ]),
      {
        kind: 'use',
        containerId: 'legacy-01',
        status: 'exited',
        idLabels: legacyIdLabels(LEGACY_FOLDER),
      },
    );
  });

  it('F-0409 BR-3: the newest of two legacy containers', () => {
    deepStrictEqual(
      decide(LEGACY_FOLDER, CONFIG, [
        legacy('legacy-01', 'exited', '2026-01-01T00:00:00Z'),
        legacy('legacy-02', 'exited', '2026-01-02T00:00:00Z'),
      ]),
      {
        kind: 'use',
        containerId: 'legacy-02',
        status: 'exited',
        idLabels: legacyIdLabels(LEGACY_FOLDER),
      },
    );
  });

  it("F-0409: a legacy container with another quality isn't a candidate", () => {
    deepStrictEqual(
      decide(LEGACY_FOLDER, CONFIG, [
        legacy('lc1', 'exited', EARLIER, 'insider'),
      ]),
      {kind: 'create'},
    );
  });

  it("F-0409: a legacy container of another folder isn't a candidate", () => {
    deepStrictEqual(
      decide(LEGACY_FOLDER, CONFIG, [
        legacy('lc1', 'exited', EARLIER, 'stable', '/w/q'),
      ]),
      {kind: 'create'},
    );
  });

  it('F-0409 BR-3: a removing legacy container is skipped', () => {
    deepStrictEqual(
      decide(LEGACY_FOLDER, CONFIG, [
        legacy('legacy-01', 'removing', LATER),
        container('exact-02', 'exited', EARLIER, CONFIG, LEGACY_FOLDER),
      ]),
      {
        kind: 'use',
        containerId: 'exact-02',
        status: 'exited',
        idLabels: idLabels(LEGACY_FOLDER, CONFIG),
      },
    );
  });

  it('F-0409 BR-3: a paused legacy container is unusable', () => {
    deepStrictEqual(
      decide(LEGACY_FOLDER, CONFIG, [legacy('lc1', 'paused', EARLIER)]),
      {kind: 'unusable', containerId: 'lc1', status: 'paused'},
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
        {kind: 'use', containerId: 'bb', status: 'exited', idLabels: STANDARD},
        {kind: 'use', containerId: 'bb', status: 'exited', idLabels: STANDARD},
      ],
    );
  });
});
