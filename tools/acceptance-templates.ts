/**
 * @fileoverview The acceptance run's templates, for a launch that asks for them: two of the specification's published
 * templates mirrored from `ghcr.io` into the run's cache by the digest of their one layer, and one template of our own,
 * published together into the run's registry; and the run's copy of the pinned index, naming them there. The CLI
 * speaks plain HTTP only to a registry it reaches as `localhost:<port>`, so the run names its registry that way.
 */

import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {checked, type CommandRunner} from './command-runner.ts';
import {SNAPSHOT_FOLDER, TEMPLATES_REFERENCE} from './trim-template-index.ts';

/** A published template the run mirrors: its name in the collection, its version, and the digest of its layer. */
export interface MirroredTemplate {
  name: string;
  version: string;
  layerDigest: string;
}

/** The smallest templates the rows need, with the digests `ghcr.io` gave for their versions on 2026-10-20. */
export const MIRRORED_TEMPLATES: readonly MirroredTemplate[] = [
  {
    name: 'alpine',
    version: '3.5.0',
    layerDigest:
      'sha256:cb2543d50c20e04c8db04d0b7e8ce2cc92a140c75eab36b563efd96c9424b50a',
  },
  {
    name: 'docker-existing-dockerfile',
    version: '1.3.2',
    layerDigest:
      'sha256:1413e22cf66b77dea458ceffed09306bd8540caa8256f49eb2d6c82e44f72bda',
  },
];

/** The namespace the mirrored templates keep in the run's registry, as they have on `ghcr.io`. */
export const MIRROR_NAMESPACE = 'devcontainers/templates';

/** The namespace of the run's own template. */
export const CUSTOM_NAMESPACE = 'remote-oss-run/custom';

/** Fetches the layer of a mirrored template; the run's goes to `ghcr.io`, a test's is a fake. */
export type LayerFetch = (template: MirroredTemplate) => Promise<Uint8Array>;

/** The run's registry as the CLI must name it to speak plain HTTP to it: `localhost` with the registry's port. */
export function templateRegistryOf(address: string): string {
  return `localhost:${address.slice(address.lastIndexOf(':') + 1)}`;
}

function sha256Of(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * The layer of `template` in `cacheFolder`, fetched when it is missing or does not match its digest. Throws, naming the
 * template, when the fetched layer does not match either.
 */
export async function templateLayerOf(
  cacheFolder: string,
  template: MirroredTemplate,
  fetchLayer: LayerFetch,
): Promise<string> {
  const file = path.join(
    cacheFolder,
    `${template.name}-${template.version}.tar`,
  );
  if (
    existsSync(file) &&
    sha256Of(readFileSync(file)) === template.layerDigest
  ) {
    return file;
  }
  const layer = await fetchLayer(template);
  if (sha256Of(layer) !== template.layerDigest) {
    throw new Error(
      `the layer of the template ${template.name} ${template.version} does not match its digest`,
    );
  }
  mkdirSync(cacheFolder, {recursive: true});
  writeFileSync(file, layer);
  return file;
}

/** The layer of `template` from `ghcr.io`, read anonymously with the registry's pull token. */
export async function ghcrLayer(
  template: MirroredTemplate,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const repository = `${MIRROR_NAMESPACE}/${template.name}`;
  const tokenResponse = await fetcher(
    `https://ghcr.io/token?scope=repository:${repository}:pull`,
  );
  if (!tokenResponse.ok) {
    throw new Error(
      `ghcr.io gave no token for ${repository}: ${String(tokenResponse.status)}`,
    );
  }
  const {token} = (await tokenResponse.json()) as {token: string};
  const blob = await fetcher(
    `https://ghcr.io/v2/${repository}/blobs/${template.layerDigest}`,
    {headers: {Authorization: `Bearer ${token}`}},
  );
  if (!blob.ok) {
    throw new Error(
      `ghcr.io gave no layer for ${repository}: ${String(blob.status)}`,
    );
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/** One template entry of an index, as far as the run's copy changes it. */
interface IndexTemplate {
  id: string;
}

/**
 * The run's index: the pinned snapshot with its templates' ids moved from `ghcr.io` to `registry`, and a collection of
 * the run's own template, whose metadata is `customMetadata` and whose id names it in `registry`.
 */
export function runIndexText(
  snapshotText: string,
  customMetadata: Readonly<Record<string, unknown>> & {id: string},
  registry: string,
): string {
  const snapshot = JSON.parse(snapshotText) as {
    collections: Array<{templates: IndexTemplate[]}>;
  };
  const prefix = `${TEMPLATES_REFERENCE}/`;
  const collections = snapshot.collections.map(collection => ({
    ...collection,
    templates: collection.templates.map(template =>
      template.id.startsWith(prefix)
        ? {
            ...template,
            id: `${registry}/${MIRROR_NAMESPACE}/${template.id.slice(prefix.length)}`,
          }
        : template,
    ),
  }));
  const customCollection = {
    sourceInformation: {
      name: "The acceptance run's own templates",
      ociReference: `${registry}/${CUSTOM_NAMESPACE}`,
    },
    templates: [
      {
        ...customMetadata,
        id: `${registry}/${CUSTOM_NAMESPACE}/${customMetadata.id}`,
      },
    ],
  };
  return `${JSON.stringify({collections: [...collections, customCollection]}, undefined, 2)}\n`;
}

/** The CLI's arguments that publish every template under `sourceFolder` into `namespace` of `registry`. */
export function publishArguments(
  bundledCli: string,
  sourceFolder: string,
  registry: string,
  namespace: string,
): string[] {
  return [
    bundledCli,
    'templates',
    'publish',
    sourceFolder,
    '-r',
    registry,
    '-n',
    namespace,
  ];
}

/** Where a run keeps its templates' work: the sources it publishes. */
function runTemplatesFolder(runFolder: string): string {
  return path.join(runFolder, 'templates');
}

/** Where the download host serves the run's index from. */
export function servedTemplatesFolder(runFolder: string): string {
  return path.join(runFolder, 'downloads', 'templates');
}

/**
 * Prepares the run's templates: the layer of each of `templates` from the cache under `root` (fetched by `fetchLayer` when it is
 * missing) unpacked, the run's own template copied, both published into the registry at `registryAddress` with the
 * dev container CLI the package bundles, and the run's index written where the download host serves it. Gives the
 * registry as the templates' ids name it.
 */
export async function prepareRunTemplates(
  command: CommandRunner,
  root: string,
  runFolder: string,
  registryAddress: string,
  fetchLayer: LayerFetch,
  templates: readonly MirroredTemplate[] = MIRRORED_TEMPLATES,
): Promise<string> {
  const registry = templateRegistryOf(registryAddress);
  const work = runTemplatesFolder(runFolder);
  const mirrorSources = path.join(work, 'mirror', 'src');
  for (const template of templates) {
    const layer = await templateLayerOf(
      path.join(root, '.vscode-test', 'templates'),
      template,
      fetchLayer,
    );
    const folder = path.join(mirrorSources, template.name);
    mkdirSync(folder, {recursive: true});
    checked(command, 'tar', ['-xf', layer, '-C', folder]);
  }
  const fixtures = path.join(root, SNAPSHOT_FOLDER);
  const customSources = path.join(work, 'custom', 'src');
  cpSync(path.join(fixtures, 'custom', 'src'), customSources, {
    recursive: true,
  });
  const bundledCli = path.join(
    root,
    'packages',
    'remote-containers',
    'dist',
    'devcontainers-cli',
    'devcontainer.js',
  );
  checked(
    command,
    process.execPath,
    publishArguments(bundledCli, mirrorSources, registry, MIRROR_NAMESPACE),
  );
  checked(
    command,
    process.execPath,
    publishArguments(bundledCli, customSources, registry, CUSTOM_NAMESPACE),
  );
  const served = servedTemplatesFolder(runFolder);
  mkdirSync(served, {recursive: true});
  writeFileSync(
    path.join(served, 'devcontainer-index.json'),
    runIndexText(
      readFileSync(path.join(fixtures, 'devcontainer-index.json'), 'utf8'),
      JSON.parse(
        readFileSync(
          path.join(customSources, 'mini', 'devcontainer-template.json'),
          'utf8',
        ),
      ) as Record<string, unknown> & {id: string},
      registry,
    ),
  );
  return registry;
}
