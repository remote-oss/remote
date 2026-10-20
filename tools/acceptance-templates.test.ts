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
import {SNAPSHOT_FOLDER, TEMPLATES_REFERENCE} from './trim-template-index.ts';

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
    it("tooling-57: the snapshot's ids move to the run's registry, other ids stay, and the run's own collection follows", () => {
      const snapshot = JSON.stringify({
        collections: [
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
        runIndexText(snapshot, {id: 'mini', name: 'Mini'}, 'localhost:49200'),
      ) as {
        collections: Array<{
          sourceInformation: {ociReference: string};
          templates: Array<{id: string; name: string}>;
        }>;
      };
      deepStrictEqual(
        index.collections.map(collection => [
          collection.sourceInformation.ociReference,
          collection.templates.map(template => [template.id, template.name]),
        ]),
        [
          [
            TEMPLATES_REFERENCE,
            [
              [`localhost:49200/${MIRROR_NAMESPACE}/alpine`, 'Alpine'],
              ['example.com/other/thing', 'Other'],
            ],
          ],
          [
            `localhost:49200/${CUSTOM_NAMESPACE}`,
            [[`localhost:49200/${CUSTOM_NAMESPACE}/mini`, 'Mini']],
          ],
        ],
      );
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
      ) as {collections: Array<{templates: Array<{id: string}>}>};
      deepStrictEqual(
        [
          registry,
          calls,
          readdirSync(path.join(runFolder, 'templates', 'custom', 'src')),
          index.collections.at(-1)?.templates.map(template => template.id),
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
          ['mini'],
          [`localhost:49200/${CUSTOM_NAMESPACE}/mini`],
        ],
      );
    });
  });

  describe('the pinned data', () => {
    it("tooling-57: the snapshot holds the specification's collection with every mirrored template, and no Features", () => {
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
          features?: unknown;
          templates: Array<{id: string; version: string}>;
        }>;
      };
      const [collection] = snapshot.collections;
      deepStrictEqual(
        [
          snapshot.collections.length,
          collection?.sourceInformation.ociReference,
          collection?.features,
          MIRRORED_TEMPLATES.map(
            template =>
              collection?.templates.find(
                each => each.id === `${TEMPLATES_REFERENCE}/${template.name}`,
              )?.version,
          ),
        ],
        [
          1,
          TEMPLATES_REFERENCE,
          undefined,
          MIRRORED_TEMPLATES.map(template => template.version),
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
