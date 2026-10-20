/**
 * @fileoverview The run's templates against a recording command runner, a fake layer fetch and a fake `fetch`.
 */

import {deepStrictEqual, rejects} from 'node:assert';
import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  CUSTOM_FEATURES_NAMESPACE,
  CUSTOM_NAMESPACE,
  ghcrLayer,
  type MirroredTemplate,
  MIRROR_NAMESPACE,
  MIRRORED_TEMPLATES,
  prepareRunTemplates,
  publishArguments,
  runIndexText,
  servedTemplatesFolder,
  templateLayerOf,
  templateRegistryOf,
} from './acceptance-templates.ts';
import type {CommandResult, CommandRunner} from './command-runner.ts';
import {REPOSITORY_ROOT} from './repository.ts';
import {
  FEATURES_REFERENCE,
  KEPT_COMMUNITY_FEATURES,
  KEPT_FEATURES,
  SNAPSHOT_FOLDER,
  TEMPLATES_REFERENCE,
} from './trim-template-index.ts';

/** The run's own templates, in name order. */
const CUSTOM_TEMPLATES = ['bare-lab', 'mini', 'options-lab', 'paths-free-lab'];

const LAYER = new TextEncoder().encode('a layer');

/** A template whose digest is the one of `LAYER`. */
const TEMPLATE: MirroredTemplate = {
  name: 'tiny',
  version: '1.2.3',
  layerDigest: `sha256:${createHash('sha256').update(LAYER).digest('hex')}`,
};

/** A layer fetch that counts its calls and gives `bytes`. */
function counting(bytes: Uint8Array = LAYER): {
  fetchLayer: (template: MirroredTemplate) => Promise<Uint8Array>;
  fetched: string[];
} {
  const fetched: string[] = [];
  return {
    fetchLayer: template => {
      fetched.push(template.name);
      return Promise.resolve(bytes);
    },
    fetched,
  };
}

/** The address a fake `fetch` was asked for. */
function urlOf(address: string | URL | Request): string {
  if (typeof address === 'string') {
    return address;
  }
  return address instanceof URL ? address.href : address.url;
}

/** A runner that records each call and succeeds. */
function recording(): {command: CommandRunner; calls: string[][]} {
  const calls: string[][] = [];
  return {
    command: (program, programArguments): CommandResult => {
      calls.push([program, ...programArguments]);
      return {status: 0, stdout: '', stderr: ''};
    },
    calls,
  };
}

describe('the run templates', () => {
  let folder = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'templates-unit-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  describe('templateRegistryOf', () => {
    it('tooling-57: the registry is named localhost with its port, which the CLI speaks plain HTTP to', () => {
      deepStrictEqual(templateRegistryOf('127.0.0.1:49200'), 'localhost:49200');
    });
  });

  describe('templateLayerOf', () => {
    it('tooling-57: a missing layer is fetched, checked and kept in the cache', async () => {
      const fetch = counting();
      const file = await templateLayerOf(folder, TEMPLATE, fetch.fetchLayer);
      deepStrictEqual(
        [fetch.fetched, path.basename(file), readFileSync(file)],
        [['tiny'], 'tiny-1.2.3.tar', Buffer.from(LAYER)],
      );
    });

    it('tooling-57: a cached layer that matches its digest is used without a fetch', async () => {
      writeFileSync(path.join(folder, 'tiny-1.2.3.tar'), LAYER);
      const fetch = counting();
      await templateLayerOf(folder, TEMPLATE, fetch.fetchLayer);
      deepStrictEqual(fetch.fetched, []);
    });

    it('tooling-57: a cached layer that does not match is fetched again and replaced', async () => {
      writeFileSync(path.join(folder, 'tiny-1.2.3.tar'), 'stale');
      const fetch = counting();
      const file = await templateLayerOf(folder, TEMPLATE, fetch.fetchLayer);
      deepStrictEqual(
        [fetch.fetched, readFileSync(file)],
        [['tiny'], Buffer.from(LAYER)],
      );
    });

    it('tooling-57: a fetched layer that does not match its digest fails the step, naming the template, and writes nothing', async () => {
      const cache = path.join(folder, 'cache');
      const failure = await templateLayerOf(
        cache,
        TEMPLATE,
        counting(new TextEncoder().encode('other')).fetchLayer,
      ).then(
        () => 'no failure',
        (caught: unknown) =>
          caught instanceof Error ? caught.message : String(caught),
      );
      deepStrictEqual(
        [failure, existsSync(cache)],
        [
          'the layer of the template tiny 1.2.3 does not match its digest',
          false,
        ],
      );
    });
  });

  describe('ghcrLayer', () => {
    it("tooling-57: the layer is read by its digest with the registry's anonymous pull token", async () => {
      const requests: string[] = [];
      function fakeFetch(
        address: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> {
        const headers = new Headers(init?.headers);
        requests.push(
          `${urlOf(address)} ${headers.get('Authorization') ?? ''}`,
        );
        return Promise.resolve(
          urlOf(address).includes('/token?')
            ? Response.json({token: 'pull-token'})
            : new Response(LAYER),
        );
      }
      const layer = await ghcrLayer(TEMPLATE, fakeFetch);
      deepStrictEqual(
        [requests, Buffer.from(layer)],
        [
          [
            `https://ghcr.io/token?scope=repository:${MIRROR_NAMESPACE}/tiny:pull `,
            `https://ghcr.io/v2/${MIRROR_NAMESPACE}/tiny/blobs/${TEMPLATE.layerDigest} Bearer pull-token`,
          ],
          Buffer.from(LAYER),
        ],
      );
    });

    it('tooling-57: a refused token fails, naming the repository and the status', async () => {
      await rejects(
        ghcrLayer(TEMPLATE, () =>
          Promise.resolve(new Response('', {status: 403})),
        ),
        /ghcr\.io gave no token for devcontainers\/templates\/tiny: 403/,
      );
    });

    it('tooling-57: a missing layer fails, naming the repository and the status', async () => {
      function fakeFetch(address: string | URL | Request): Promise<Response> {
        return Promise.resolve(
          urlOf(address).includes('/token?')
            ? Response.json({token: 'pull-token'})
            : new Response('', {status: 404}),
        );
      }
      await rejects(
        ghcrLayer(TEMPLATE, fakeFetch),
        /ghcr\.io gave no layer for devcontainers\/templates\/tiny: 404/,
      );
    });
  });

  describe('runIndexText', () => {
    it("tooling-57: the snapshot's template ids move to the run's registry, Feature ids and other ids stay, and the run's own collections follow", () => {
      const snapshot = JSON.stringify({
        collections: [
          {
            sourceInformation: {ociReference: FEATURES_REFERENCE},
            features: [{id: `${FEATURES_REFERENCE}/git`, name: 'Git'}],
          },
          {
            sourceInformation: {ociReference: TEMPLATES_REFERENCE},
            templates: [
              {id: `${TEMPLATES_REFERENCE}/alpine`, name: 'Alpine'},
              {id: 'example.com/other/thing', name: 'Other'},
            ],
          },
        ],
      });
      const index = JSON.parse(
        runIndexText(
          snapshot,
          [
            {id: 'mini', name: 'Mini'},
            {id: 'options-lab', name: 'Options Lab'},
          ],
          [
            {id: 'lab-options', name: 'Lab Options'},
            {id: 'lab-plain', name: 'Lab Plain'},
          ],
          'localhost:49200',
        ),
      ) as {
        collections: Array<{
          sourceInformation: {ociReference: string};
          features?: Array<{id: string; name: string}>;
          templates?: Array<{id: string; name: string}>;
        }>;
      };
      deepStrictEqual(
        index.collections.map(collection => [
          collection.sourceInformation.ociReference,
          (collection.features ?? collection.templates ?? []).map(entry => [
            entry.id,
            entry.name,
          ]),
        ]),
        [
          [FEATURES_REFERENCE, [[`${FEATURES_REFERENCE}/git`, 'Git']]],
          [
            TEMPLATES_REFERENCE,
            [
              [`localhost:49200/${MIRROR_NAMESPACE}/alpine`, 'Alpine'],
              ['example.com/other/thing', 'Other'],
            ],
          ],
          [
            `localhost:49200/${CUSTOM_NAMESPACE}`,
            [
              [`localhost:49200/${CUSTOM_NAMESPACE}/mini`, 'Mini'],
              [
                `localhost:49200/${CUSTOM_NAMESPACE}/options-lab`,
                'Options Lab',
              ],
            ],
          ],
          [
            `localhost:49200/${CUSTOM_FEATURES_NAMESPACE}`,
            [
              [
                `localhost:49200/${CUSTOM_FEATURES_NAMESPACE}/lab-options`,
                'Lab Options',
              ],
              [
                `localhost:49200/${CUSTOM_FEATURES_NAMESPACE}/lab-plain`,
                'Lab Plain',
              ],
            ],
          ],
        ],
      );
    });

    it("tooling-61: the run's Features collection names its repository, for the owner a Feature list shows", () => {
      const index = JSON.parse(
        runIndexText('{"collections":[]}', [], [], 'localhost:49200'),
      ) as {collections: Array<{sourceInformation: unknown}>};
      deepStrictEqual(index.collections.at(-1)?.sourceInformation, {
        name: "The acceptance run's own Features",
        repository: 'https://github.com/remote-oss-run/features',
        ociReference: `localhost:49200/${CUSTOM_FEATURES_NAMESPACE}`,
      });
    });
  });

  describe('publishArguments', () => {
    it('tooling-57: the CLI publishes a source folder into a namespace of the registry', () => {
      deepStrictEqual(
        publishArguments('/cli.js', '/src', 'localhost:1', 'a/b'),
        [
          '/cli.js',
          'templates',
          'publish',
          '/src',
          '-r',
          'localhost:1',
          '-n',
          'a/b',
        ],
      );
    });
  });

  describe('prepareRunTemplates', () => {
    it("tooling-57: each layer is unpacked, both collections are published with the package's CLI, and the run's index is written where the host serves it", async () => {
      const root = path.join(folder, 'root');
      cpSync(
        path.join(REPOSITORY_ROOT, SNAPSHOT_FOLDER),
        path.join(root, SNAPSHOT_FOLDER),
        {recursive: true},
      );
      const runFolder = path.join(folder, 'run');
      const {command, calls} = recording();
      const registry = await prepareRunTemplates(
        command,
        root,
        runFolder,
        '127.0.0.1:49200',
        counting().fetchLayer,
        [TEMPLATE],
      );
      const bundledCli = path.join(
        root,
        'packages/remote-containers/dist/devcontainers-cli/devcontainer.js',
      );
      const index = JSON.parse(
        readFileSync(
          path.join(
            servedTemplatesFolder(runFolder),
            'devcontainer-index.json',
          ),
          'utf8',
        ),
      ) as {
        collections: Array<{
          features?: Array<{id: string}>;
          templates?: Array<{id: string}>;
        }>;
      };
      const features = index.collections.at(-1);
      const templates = index.collections.at(-2);
      deepStrictEqual(
        [
          registry,
          calls,
          readdirSync(
            path.join(runFolder, 'templates', 'custom', 'src'),
          ).sort(),
          templates?.templates?.map(template => template.id),
          features?.features?.map(feature => feature.id),
        ],
        [
          'localhost:49200',
          [
            [
              'tar',
              '-xf',
              path.join(root, '.vscode-test', 'templates', 'tiny-1.2.3.tar'),
              '-C',
              path.join(runFolder, 'templates', 'mirror', 'src', 'tiny'),
            ],
            [
              process.execPath,
              ...publishArguments(
                bundledCli,
                path.join(runFolder, 'templates', 'mirror', 'src'),
                'localhost:49200',
                MIRROR_NAMESPACE,
              ),
            ],
            [
              process.execPath,
              ...publishArguments(
                bundledCli,
                path.join(runFolder, 'templates', 'custom', 'src'),
                'localhost:49200',
                CUSTOM_NAMESPACE,
              ),
            ],
          ],
          CUSTOM_TEMPLATES,
          CUSTOM_TEMPLATES.map(
            name => `localhost:49200/${CUSTOM_NAMESPACE}/${name}`,
          ),
          ['lab-options', 'lab-plain'].map(
            name => `localhost:49200/${CUSTOM_FEATURES_NAMESPACE}/${name}`,
          ),
        ],
      );
    });
  });

  describe('the pinned data', () => {
    it("tooling-61: the snapshot holds the specification's templates with every mirrored one, and only the Features the cut keeps", () => {
      const snapshot = JSON.parse(
        readFileSync(
          path.join(
            REPOSITORY_ROOT,
            SNAPSHOT_FOLDER,
            'devcontainer-index.json',
          ),
          'utf8',
        ),
      ) as {
        collections: Array<{
          sourceInformation: {ociReference: string};
          features?: Array<{id: string; name: string}>;
          templates?: Array<{id: string; version: string}>;
        }>;
      };
      const specification = snapshot.collections.find(
        collection =>
          collection.sourceInformation.ociReference === TEMPLATES_REFERENCE,
      );
      deepStrictEqual(
        [
          MIRRORED_TEMPLATES.map(
            template =>
              specification?.templates?.find(
                each => each.id === `${TEMPLATES_REFERENCE}/${template.name}`,
              )?.version,
          ),
          snapshot.collections
            .flatMap(collection =>
              (collection.features ?? []).map(feature =>
                collection.sourceInformation.ociReference === FEATURES_REFERENCE
                  ? feature.id
                  : feature.name,
              ),
            )
            .sort(),
          snapshot.collections.map(collection =>
            Object.keys(collection).sort().join(),
          ),
        ],
        [
          MIRRORED_TEMPLATES.map(template => template.version),
          [
            ...KEPT_FEATURES.map(name => `${FEATURES_REFERENCE}/${name}`),
            ...KEPT_COMMUNITY_FEATURES,
          ].sort(),
          snapshot.collections.map(collection =>
            collection === specification
              ? 'sourceInformation,templates'
              : 'features,sourceInformation',
          ),
        ],
      );
    });

    it("tooling-57: the snapshot's folder carries the collection's licence and its source note", () => {
      const fixtures = path.join(REPOSITORY_ROOT, SNAPSHOT_FOLDER);
      deepStrictEqual(
        [
          readFileSync(path.join(fixtures, 'LICENSE'), 'utf8').includes(
            'MIT License',
          ),
          readFileSync(path.join(fixtures, 'SOURCE.md'), 'utf8').includes(
            'https://containers.dev/static/devcontainer-index.json',
          ),
        ],
        [true, true],
      );
    });

    it("tooling-61: the run's own templates have the shapes the later wizard rows need", () => {
      const templates = path.join(
        REPOSITORY_ROOT,
        SNAPSHOT_FOLDER,
        'custom',
        'src',
      );
      function read(name: string) {
        return JSON.parse(
          readFileSync(
            path.join(templates, name, 'devcontainer-template.json'),
            'utf8',
          ),
        ) as {
          id: string;
          options?: Record<
            string,
            {
              type: string;
              enum?: string[];
              default: unknown;
              description?: string;
              proposals?: string[];
            }
          >;
          optionalPaths?: string[];
        };
      }
      const optionsLab = read('options-lab');
      deepStrictEqual(
        [
          readdirSync(templates).sort(),
          readdirSync(templates).map(name => read(name).id),
          Object.entries(optionsLab.options ?? {}).map(([name, option]) => [
            name,
            option.type,
            option.enum ?? option.proposals ?? null,
            option.default,
            option.description ?? null,
          ]),
          optionsLab.optionalPaths,
          Object.keys(read('paths-free-lab').options ?? {}),
          read('paths-free-lab').optionalPaths,
          read('bare-lab').options,
          read('bare-lab').optionalPaths,
        ],
        [
          CUSTOM_TEMPLATES,
          CUSTOM_TEMPLATES,
          [
            ['flavour', 'string', ['a', 'b', 'c'], 'b', 'Flavour:'],
            ['channel', 'string', ['stable', 'edge'], 'stable', 'Channel:'],
            ['motto', 'string', null, 'plain', 'Motto:'],
            ['withDocs', 'boolean', null, true, 'With docs'],
            ['withTests', 'boolean', null, false, 'With tests'],
            ['quiet', 'boolean', null, false, null],
          ],
          ['zeta.txt', 'docs/*', 'alpha.txt'],
          ['size'],
          undefined,
          undefined,
          undefined,
        ],
      );
    });

    it("tooling-61: the run's own Features are two, one with every shape of option and one with none", () => {
      const features = JSON.parse(
        readFileSync(
          path.join(REPOSITORY_ROOT, SNAPSHOT_FOLDER, 'custom-features.json'),
          'utf8',
        ),
      ) as Array<{id: string; name: string; options?: Record<string, unknown>}>;
      deepStrictEqual(
        features.map(feature => [
          feature.id,
          feature.name,
          Object.keys(feature.options ?? {}),
        ]),
        [
          [
            'lab-options',
            'Lab Options',
            ['enabled', 'verbose', 'level', 'tone', 'installPath'],
          ],
          ['lab-plain', 'Lab Plain', []],
        ],
      );
    });

    it('tooling-57: no package names a file outside its own folder, so the test data reaches no VSIX', () => {
      const packages = path.join(REPOSITORY_ROOT, 'packages');
      const outside = readdirSync(packages).flatMap(name => {
        const manifestFile = path.join(packages, name, 'package.json');
        if (!existsSync(manifestFile)) {
          return [];
        }
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
          files?: string[];
        };
        return (manifest.files ?? [])
          .filter(entry => entry.includes('..') || entry.startsWith('/'))
          .map(entry => `${name}: ${entry}`);
      });
      deepStrictEqual(outside, []);
    });
  });
});
