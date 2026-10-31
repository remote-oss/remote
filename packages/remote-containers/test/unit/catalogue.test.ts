import {deepStrictEqual} from 'node:assert';
import {
  CATALOGUE_URL,
  type CataloguePorts,
  type CatalogueTemplate,
  catalogueUrlOf,
  DOWNLOAD_MILLISECONDS,
  fetchCatalogue,
  parseCatalogue,
  showCatalogueFailure,
} from '../../src/authoring/catalogue.ts';

const NEVER = new AbortController().signal;

/** A trimmed copy of the index: two collections, the second on another registry, and an entry without a version. */
const INDEX = JSON.stringify({
  collections: [
    {
      templates: [
        {
          id: 'ghcr.io/devcontainers/templates/alpine',
          version: '3.5.0',
          name: 'Alpine',
          description: 'Simple Alpine container with Git installed.',
          documentationURL: 'https://example.org/alpine',
          publisher: 'Dev Container Spec Maintainers',
          options: {imageVariant: {type: 'string', default: '3.23'}},
          optionalPaths: ['.github/dependabot.yml', 7],
        },
        {id: 'ghcr.io/devcontainers/templates/broken', name: 'No version'},
        'not an entry',
      ],
    },
    {
      templates: [
        {
          id: 'localhost:5000/other/templates/mini',
          version: '1.0.0',
          name: 'Mini',
          publisher: 'Somebody',
        },
      ],
    },
  ],
});

/** Ports whose download answers `answer` and whose timer fires when `fire` is called. */
function portsOf(
  answer: (url: string, cancellation: AbortSignal) => Promise<string>,
  environment: Record<string, string | undefined> = {},
): {
  ports: CataloguePorts;
  fire: () => void;
  timers: number[];
  stopped: number[];
} {
  let callback: (() => void) | undefined;
  const timers: number[] = [];
  const stopped: number[] = [];
  return {
    ports: {
      environment,
      download: answer,
      setTimer: (milliseconds, onTimer) => {
        timers.push(milliseconds);
        callback = onTimer;
        return () => {
          stopped.push(milliseconds);
        };
      },
    },
    fire: () => {
      callback?.();
    },
    timers,
    stopped,
  };
}

describe('the template catalogue (card containers-77)', () => {
  it('F-0802 BR-1: the index is read into its templates, in its order, skipping an entry without a text id, name and version', () => {
    const result = parseCatalogue(INDEX);
    deepStrictEqual(
      result.kind === 'catalogue' ? result.templates.map(each => each.id) : [],
      [
        'ghcr.io/devcontainers/templates/alpine',
        'localhost:5000/other/templates/mini',
      ],
    );
  });

  it('F-0802 BR-5: a ghcr.io template is owned by the second part of its reference, any other by its publisher', () => {
    const result = parseCatalogue(INDEX);
    deepStrictEqual(
      result.kind === 'catalogue'
        ? result.templates.map(each => each.owner)
        : [],
      ['devcontainers', 'Somebody'],
    );
  });

  it('F-0802 BR-5: a collection’s repository on github.com gives its templates that owner, in the public index’s shape and in the run’s', () => {
    const publicIndex = JSON.stringify({
      collections: [
        {
          sourceInformation: {
            name: 'Dev Container Templates',
            repository: 'https://github.com/devcontainers/templates',
            ociReference: 'ghcr.io/devcontainers/templates',
          },
          templates: [
            {
              id: 'ghcr.io/devcontainers/templates/alpine',
              version: '1',
              name: 'Alpine',
            },
          ],
        },
      ],
    });
    const runIndex = JSON.stringify({
      collections: [
        {
          sourceInformation: {
            repository: 'https://github.com/devcontainers/templates',
          },
          templates: [
            {
              id: '127.0.0.1:5000/devcontainers/templates/alpine',
              version: '1',
              name: 'Alpine',
            },
          ],
        },
      ],
    });
    deepStrictEqual(
      [publicIndex, runIndex].map(text => {
        const result = parseCatalogue(text);
        return result.kind === 'catalogue'
          ? result.templates.map(each => [
              each.owner,
              each.collectionRepository,
            ])
          : [];
      }),
      [
        [['devcontainers', 'https://github.com/devcontainers/templates']],
        [['devcontainers', 'https://github.com/devcontainers/templates']],
      ],
    );
  });

  it('F-0802 BR-5: a collection with no repository, or one that is not on github.com or is not an address, leaves the owner to the reference and the publisher', () => {
    function owners(repository: unknown): string[] {
      const result = parseCatalogue(
        JSON.stringify({
          collections: [
            {
              sourceInformation: repository === undefined ? {} : {repository},
              templates: [
                {
                  id: 'ghcr.io/spec/templates/x',
                  version: '1',
                  name: 'X',
                  publisher: 'Pub',
                },
              ],
            },
          ],
        }),
      );
      return result.kind === 'catalogue'
        ? result.templates.map(each => each.owner)
        : [];
    }
    deepStrictEqual(
      [
        owners(undefined),
        owners('https://gitlab.com/devcontainers/templates'),
        owners('not an address'),
        owners('https://github.com/'),
      ],
      [['spec'], ['spec'], ['spec'], ['spec']],
    );
  });

  it('F-0802 BR-1: a template carries its description, documentation, options and optional paths, and a missing one is empty', () => {
    const result = parseCatalogue(INDEX);
    const expected: CatalogueTemplate[] = [
      {
        id: 'ghcr.io/devcontainers/templates/alpine',
        version: '3.5.0',
        name: 'Alpine',
        description: 'Simple Alpine container with Git installed.',
        owner: 'devcontainers',
        options: {imageVariant: {type: 'string', default: '3.23'}},
        optionalPaths: ['.github/dependabot.yml'],
        documentationURL: 'https://example.org/alpine',
      },
      {
        id: 'localhost:5000/other/templates/mini',
        version: '1.0.0',
        name: 'Mini',
        owner: 'Somebody',
        options: {},
        optionalPaths: [],
      },
    ];
    deepStrictEqual(
      result.kind === 'catalogue' ? result.templates : [],
      expected,
    );
  });

  it('F-0802 BR-5: a template with no publisher and a reference of another registry has an empty owner', () => {
    const result = parseCatalogue(
      '{"collections":[{"templates":[{"id":"a.io/x/y","version":"1","name":"Y"}]}]}',
    );
    deepStrictEqual(
      result.kind === 'catalogue' ? result.templates[0]?.owner : undefined,
      '',
    );
  });

  it('F-0802 7.E3: text that is no JSON is a failure with the parser’s own message', () => {
    const result = parseCatalogue('{"collections": [');
    deepStrictEqual(
      [result.kind, result.kind === 'failed' && result.cause !== ''],
      ['failed', true],
    );
  });

  it('F-0802 7.E3: JSON of another shape lists no template', () => {
    deepStrictEqual(
      [
        parseCatalogue('[]'),
        parseCatalogue('{"collections": [3, {"templates": 4}]}'),
      ],
      [
        {kind: 'catalogue', templates: [], features: []},
        {kind: 'catalogue', templates: [], features: []},
      ],
    );
  });

  it('F-0804 BR-3, AC-2: a Feature has the owner of its collection’s repository on github.com, and none from any other host or from no repository', () => {
    const feature = {id: 'ghcr.io/x/features/f', version: '1.2.3', name: 'F'};
    const result = parseCatalogue(
      JSON.stringify({
        collections: [
          {
            sourceInformation: {
              repository: 'https://github.com/devcontainers/features',
            },
            features: [feature],
          },
          {
            sourceInformation: {
              repository: 'https://gitlab.com/someone/features',
            },
            features: [feature],
          },
          {features: [feature]},
        ],
      }),
    );
    deepStrictEqual(
      result.kind === 'catalogue'
        ? result.features.map(each => each.owner)
        : [],
      ['devcontainers', undefined, undefined],
    );
  });

  it('F-0804 BR-1: one index gives the templates and the Features, in the index’s order, and an entry without a text id, name and version is skipped', () => {
    const result = parseCatalogue(
      JSON.stringify({
        collections: [
          {
            templates: [{id: 'ghcr.io/x/templates/t', version: '1', name: 'T'}],
            features: [
              {
                id: 'ghcr.io/x/features/b',
                version: '2.0.0',
                name: 'B',
                options: {level: {type: 'string'}},
              },
              {id: 'ghcr.io/x/features/skipped', version: '1'},
              {name: 'No id', version: '1'},
              {id: 'ghcr.io/x/features/no-version', name: 'No version'},
              3,
            ],
          },
          {
            features: [
              {id: 'ghcr.io/x/features/a', version: '1.0.0', name: 'A'},
            ],
          },
        ],
      }),
    );
    deepStrictEqual(
      result.kind === 'catalogue'
        ? [
            result.templates.map(each => each.name),
            result.features.map(each => [
              each.id,
              each.version,
              each.name,
              each.options,
            ]),
          ]
        : [],
      [
        ['T'],
        [
          ['ghcr.io/x/features/b', '2.0.0', 'B', {level: {type: 'string'}}],
          ['ghcr.io/x/features/a', '1.0.0', 'A', {}],
        ],
      ],
    );
  });

  it('F-0802 BR-1: the index is the published one', () => {
    deepStrictEqual(
      catalogueUrlOf({}),
      'https://containers.dev/static/devcontainer-index.json',
    );
  });

  it('F-0802 BR-1: the harness’s index counts while REMOTE_OSS_ACCEPTANCE is 1', () => {
    deepStrictEqual(
      catalogueUrlOf({
        REMOTE_OSS_ACCEPTANCE: '1',
        REMOTE_OSS_TEMPLATE_INDEX: 'http://127.0.0.1:9/templates/index.json',
      }),
      'http://127.0.0.1:9/templates/index.json',
    );
  });

  it('#1214 design check: the harness index variable is ignored without REMOTE_OSS_ACCEPTANCE=1', () => {
    deepStrictEqual(
      [
        catalogueUrlOf({
          REMOTE_OSS_TEMPLATE_INDEX: 'http://127.0.0.1:9/index.json',
        }),
        catalogueUrlOf({
          REMOTE_OSS_ACCEPTANCE: 'true',
          REMOTE_OSS_TEMPLATE_INDEX: 'http://127.0.0.1:9/index.json',
        }),
      ],
      [CATALOGUE_URL, CATALOGUE_URL],
    );
  });

  it('F-0802 BR-1: the switch without an index, or with an empty one, is the published index', () => {
    deepStrictEqual(
      [
        catalogueUrlOf({REMOTE_OSS_ACCEPTANCE: '1'}),
        catalogueUrlOf({
          REMOTE_OSS_ACCEPTANCE: '1',
          REMOTE_OSS_TEMPLATE_INDEX: '',
        }),
      ],
      [CATALOGUE_URL, CATALOGUE_URL],
    );
  });

  it('F-0802 AC-37: a fetch downloads the index once and reads it, then stops its timer', async () => {
    const urls: string[] = [];
    const {ports, timers, stopped} = portsOf(url => {
      urls.push(url);
      return Promise.resolve(INDEX);
    });
    const result = await fetchCatalogue(ports, NEVER);
    deepStrictEqual(
      [urls, result.kind, timers, stopped],
      [
        [CATALOGUE_URL],
        'catalogue',
        [DOWNLOAD_MILLISECONDS],
        [DOWNLOAD_MILLISECONDS],
      ],
    );
  });

  it('F-0802 7.E3: a download that fails gives its own message as the cause', async () => {
    const {ports} = portsOf(() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    );
    deepStrictEqual(await fetchCatalogue(ports, NEVER), {
      kind: 'failed',
      cause: 'getaddrinfo ENOTFOUND',
    });
  });

  it('F-0802 7.E3: a download that rejects with no error gives its text as the cause', async () => {
    const {ports} = portsOf(() =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a download may reject with anything
      Promise.reject('refused'),
    );
    deepStrictEqual(await fetchCatalogue(ports, NEVER), {
      kind: 'failed',
      cause: 'refused',
    });
  });

  it('F-0801 7.E10: a download that takes 30 s is ended and fails as timed out', async () => {
    const harness = portsOf(
      (url, cancellation) =>
        new Promise((resolve, reject) => {
          cancellation.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const fetching = fetchCatalogue(harness.ports, NEVER);
    harness.fire();
    deepStrictEqual(await fetching, {
      kind: 'failed',
      cause: 'the catalogue download timed out',
    });
  });

  it('F-0801 7.E10: the user’s cancel reaches the download, which fails with its own message', async () => {
    const controller = new AbortController();
    const harness = portsOf(
      (url, cancellation) =>
        new Promise((resolve, reject) => {
          cancellation.addEventListener('abort', () => {
            reject(new Error('cancelled by the user'));
          });
        }),
    );
    const fetching = fetchCatalogue(harness.ports, controller.signal);
    controller.abort();
    deepStrictEqual(await fetching, {
      kind: 'failed',
      cause: 'cancelled by the user',
    });
  });

  it('F-0801 7.E10: a cancel that came before the fetch reaches the download as aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let seen: boolean | undefined;
    const {ports} = portsOf((url, cancellation) => {
      seen = cancellation.aborted;
      return Promise.resolve(INDEX);
    });
    await fetchCatalogue(ports, controller.signal);
    deepStrictEqual(seen, true);
  });

  it('F-0801 7.E10: the failure is a modal error with our text and the cause', async () => {
    const shown: string[] = [];
    await showCatalogueFailure(
      {
        showModalError: message => {
          shown.push(message);
          return Promise.resolve(undefined);
        },
      },
      template => template,
      'the catalogue download timed out',
    );
    deepStrictEqual(shown, [
      "The list of dev container templates couldn't be downloaded: the catalogue download timed out",
    ]);
  });
});
