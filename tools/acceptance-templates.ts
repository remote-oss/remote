/**
 * @fileoverview The acceptance run's templates, for a launch that asks for them: three of the specification's published
 * templates mirrored from `ghcr.io` into the run's cache by the digest of their one layer, and the templates of our own,
 * published together into the run's registry; and the run's copy of the pinned index, naming them there, with the
 * Features the snapshot keeps and two of our own. The CLI speaks plain HTTP only to a registry it reaches as
 * `localhost:<port>`, so the run names its registry that way.
 */

import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {checked, type CommandRunner} from './command-runner.ts';
import {controlManifestText} from './acceptance-control-manifest.ts';
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
  {
    name: 'docker-in-docker',
    version: '1.3.5',
    layerDigest:
      'sha256:97c627da9c1da8bc826fe70b6ad1ab1f9be10258532dbffd1a408bb979a358a0',
  },
];

/** The namespace the mirrored templates keep in the run's registry, as they have on `ghcr.io`. */
export const MIRROR_NAMESPACE = 'devcontainers/templates';

/** The namespace of the run's own templates. */
export const CUSTOM_NAMESPACE = 'remote-oss-run/custom';

/**
 * The run's own templates that are published but not listed in the index, each re-pushed without the annotation that
 * holds its metadata: the manifest of `templates publish` carries it, and a template whose artifact does not has no
 * metadata for the wizard to read.
 */
export const UNLISTED_TEMPLATES: readonly string[] = ['no-metadata-lab'];

/**
 * The `oras` image the run copies a manifest with, pinned by its tag and the digest `docker pull` reported for it on
 * 2026-11-01.
 */
export const ORAS_IMAGE =
  'ghcr.io/oras-project/oras:v1.2.2@sha256:cd549d80c4aa89638aea5964a3cd8193a6dd8abf939a43b5d562c24dbab08ff1';

/** The annotation of a template's manifest that holds its metadata, as the dev container's manifest format names it. */
const METADATA_ANNOTATION = 'dev.containers.metadata';

/** The namespace of the run's own Features, which are published; the second owner's are listed only. */
export const CUSTOM_FEATURES_NAMESPACE = 'remote-oss-run/features';

/** The image the run's `mini` and its template without metadata name in their fixtures; packaging replaces it with the run's dev container image. */
export const RUN_IMAGE_PLACEHOLDER = 'remote-oss-acceptance-run-image';

/** The run's own templates whose configuration names the run's dev container image. */
export const RUN_IMAGE_TEMPLATES: readonly string[] = [
  'mini',
  'no-metadata-lab',
];

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

/** One entry of an index, as far as the run's copy changes it. */
interface IndexEntry {
  id: string;
}

/** The metadata of one of the run's own templates or Features: its `id` is its folder's name. */
export type CustomMetadata = Readonly<Record<string, unknown>> & {id: string};

/** A collection of the run's own Features, as `custom-features.json` lists it. */
export interface CustomFeatureCollection {
  /** Where the collection is published in the run's registry. */
  namespace: string;
  name: string;
  /** The repository whose owner a Feature list shows. */
  repository: string;
  features: readonly CustomMetadata[];
}

/**
 * The run's index: the pinned snapshot with its templates' ids moved from `ghcr.io` to `registry` and its Features'
 * ids left as they are, a collection of the run's own templates, whose metadata is `customTemplates` and whose ids name
 * them in `registry`, and the collections of the run's own Features, `customFeatures`, named the same way.
 */
export function runIndexText(
  snapshotText: string,
  customTemplates: readonly CustomMetadata[],
  customFeatures: readonly CustomFeatureCollection[],
  registry: string,
): string {
  const snapshot = JSON.parse(snapshotText) as {
    collections: Array<{templates?: IndexEntry[]}>;
  };
  const prefix = `${TEMPLATES_REFERENCE}/`;
  const collections = snapshot.collections.map(collection =>
    collection.templates === undefined
      ? collection
      : {
          ...collection,
          templates: collection.templates.map(template =>
            template.id.startsWith(prefix)
              ? {
                  ...template,
                  id: `${registry}/${MIRROR_NAMESPACE}/${template.id.slice(prefix.length)}`,
                }
              : template,
          ),
        },
  );
  function named(namespace: string, entry: CustomMetadata): CustomMetadata {
    return {...entry, id: `${registry}/${namespace}/${entry.id}`};
  }
  const customTemplatesCollection = {
    sourceInformation: {
      name: "The acceptance run's own templates",
      ociReference: `${registry}/${CUSTOM_NAMESPACE}`,
    },
    templates: customTemplates.map(entry => named(CUSTOM_NAMESPACE, entry)),
  };
  const customFeatureCollections = customFeatures.map(collection => ({
    sourceInformation: {
      name: collection.name,
      repository: collection.repository,
      ociReference: `${registry}/${collection.namespace}`,
    },
    features: collection.features.map(entry =>
      named(collection.namespace, entry),
    ),
  }));
  return `${JSON.stringify({collections: [...collections, customTemplatesCollection, ...customFeatureCollections]}, undefined, 2)}\n`;
}

/** The CLI's arguments that publish every template or Feature under `sourceFolder` into `namespace` of `registry`. */
export function publishArguments(
  bundledCli: string,
  kind: 'templates' | 'features',
  sourceFolder: string,
  registry: string,
  namespace: string,
): string[] {
  return [
    bundledCli,
    kind,
    'publish',
    sourceFolder,
    '-r',
    registry,
    '-n',
    namespace,
  ];
}

/**
 * The manifest text of a template without the annotation that holds its metadata: the config and the layers stay as
 * they are, and the annotations object goes when that was its only key.
 */
export function manifestWithoutMetadata(manifestText: string): string {
  const manifest = JSON.parse(manifestText) as {
    annotations?: Record<string, string>;
  } & Record<string, unknown>;
  const {annotations, ...rest} = manifest;
  const others = Object.fromEntries(
    Object.entries(annotations ?? {}).filter(
      ([key]) => key !== METADATA_ANNOTATION,
    ),
  );
  return JSON.stringify(
    Object.keys(others).length === 0 ? rest : {...rest, annotations: others},
  );
}

/** The `oras` command line that runs `orasArguments` in the image, on the host's network so that it reaches `localhost`. */
export function orasArguments(
  subcommand: readonly string[],
  mount?: {folder: string},
): string[] {
  return [
    'run',
    '--rm',
    '--network',
    'host',
    ...(mount === undefined ? [] : ['-v', `${mount.folder}:/work`]),
    ORAS_IMAGE,
    ...subcommand,
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

/** Where the download host serves the run's control manifest from. */
export function servedControlFolder(runFolder: string): string {
  return path.join(runFolder, 'downloads', 'control');
}

/** The placeholder of the run's registry in a Feature's metadata, as the dependencies of a Feature name its siblings. */
const REGISTRY_TOKEN = '${registry}';

/** The text of a Feature's metadata with the run's registry written in. */
export function featureMetadataText(text: string, registry: string): string {
  return text.replaceAll(REGISTRY_TOKEN, registry);
}

/**
 * Prepares the run's templates: the layer of each of `templates` from the cache under `root` (fetched by `fetchLayer` when it is
 * missing) unpacked, the run's own templates and Features copied with the run's `mini` and its template without metadata naming `devContainerImage`, all published
 * into the registry at `registryAddress` with the dev container CLI the package bundles, and the run's index and control manifest
 * written where the download host serves them. Gives the registry as the templates' ids name it.
 */
export async function prepareRunTemplates(
  command: CommandRunner,
  root: string,
  runFolder: string,
  registryAddress: string,
  fetchLayer: LayerFetch,
  templates: readonly MirroredTemplate[] = MIRRORED_TEMPLATES,
  devContainerImage?: string,
): Promise<string> {
  if (devContainerImage === undefined) {
    throw new Error(
      'the run dev container image is missing, and the mini and no-metadata-lab templates name it',
    );
  }
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
  const placeholder = `"${RUN_IMAGE_PLACEHOLDER}"`;
  for (const name of RUN_IMAGE_TEMPLATES) {
    const configuration = path.join(
      customSources,
      name,
      '.devcontainer',
      'devcontainer.json',
    );
    const text = readFileSync(configuration, 'utf8');
    if (!text.includes(placeholder)) {
      throw new Error(
        `the ${name} template no longer names the run image placeholder`,
      );
    }
    writeFileSync(
      configuration,
      text.replace(placeholder, JSON.stringify(devContainerImage)),
    );
  }
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
    publishArguments(
      bundledCli,
      'templates',
      mirrorSources,
      registry,
      MIRROR_NAMESPACE,
    ),
  );
  checked(
    command,
    process.execPath,
    publishArguments(
      bundledCli,
      'templates',
      customSources,
      registry,
      CUSTOM_NAMESPACE,
    ),
  );
  for (const name of UNLISTED_TEMPLATES) {
    const reference = `${registry}/${CUSTOM_NAMESPACE}/${name}:latest`;
    const manifest = checked(
      command,
      'docker',
      orasArguments(['manifest', 'fetch', '--plain-http', reference]),
    );
    const pushed = path.join(work, 'oras');
    mkdirSync(pushed, {recursive: true});
    writeFileSync(
      path.join(pushed, `${name}.json`),
      manifestWithoutMetadata(manifest),
    );
    checked(
      command,
      'docker',
      orasArguments(
        ['manifest', 'push', '--plain-http', reference, `/work/${name}.json`],
        {folder: pushed},
      ),
    );
  }
  const featureSources = path.join(work, 'features', 'src');
  cpSync(path.join(fixtures, 'custom-features', 'src'), featureSources, {
    recursive: true,
  });
  for (const name of readdirSync(featureSources)) {
    const metadataFile = path.join(
      featureSources,
      name,
      'devcontainer-feature.json',
    );
    writeFileSync(
      metadataFile,
      featureMetadataText(readFileSync(metadataFile, 'utf8'), registry),
    );
  }
  checked(
    command,
    process.execPath,
    publishArguments(
      bundledCli,
      'features',
      featureSources,
      registry,
      CUSTOM_FEATURES_NAMESPACE,
    ),
  );
  const served = servedTemplatesFolder(runFolder);
  mkdirSync(served, {recursive: true});
  function metadata(file: string): CustomMetadata {
    return JSON.parse(readFileSync(file, 'utf8')) as CustomMetadata;
  }
  writeFileSync(
    path.join(served, 'devcontainer-index.json'),
    runIndexText(
      readFileSync(path.join(fixtures, 'devcontainer-index.json'), 'utf8'),
      readdirSync(customSources)
        .filter(name => !UNLISTED_TEMPLATES.includes(name))
        .sort()
        .map(name =>
          metadata(
            path.join(customSources, name, 'devcontainer-template.json'),
          ),
        ),
      [
        {
          namespace: CUSTOM_FEATURES_NAMESPACE,
          name: "The acceptance run's own Features",
          repository: 'https://github.com/remote-oss-run/features',
          features: readdirSync(featureSources)
            .sort()
            .map(name =>
              metadata(
                path.join(featureSources, name, 'devcontainer-feature.json'),
              ),
            ),
        },
        JSON.parse(
          readFileSync(
            path.join(fixtures, 'custom-community-features.json'),
            'utf8',
          ),
        ) as CustomFeatureCollection,
      ],
      registry,
    ),
  );
  const control = servedControlFolder(runFolder);
  mkdirSync(control, {recursive: true});
  writeFileSync(
    path.join(control, 'devcontainer-control-manifest.json'),
    controlManifestText(registry),
  );
  return registry;
}
