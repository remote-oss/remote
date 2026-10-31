/**
 * @fileoverview The catalogue of dev container templates: the published index of the dev container specification,
 * downloaded once for each run of the wizard and read into the templates it lists, and the error shown when it cannot
 * be downloaded. The download runs in the extension host, so the editor's proxy settings apply to it.
 */

import {harnessUrlOf} from '../acceptance-switch.ts';
import {isRecord} from '../extensions/extension-list.ts';
import {linkedAbort} from '../linked-abort.ts';
import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** Where the published index is. */
export const CATALOGUE_URL =
  'https://containers.dev/static/devcontainer-index.json';

/** The variable that names the harness's own index; it counts only while the switch is on. */
const INDEX_VARIABLE = 'REMOTE_OSS_TEMPLATE_INDEX';

/** How long the download may take, in milliseconds. */
export const DOWNLOAD_MILLISECONDS = 30_000;

/** What the wizard shows of one template. */
export interface CatalogueTemplate {
  /** The full OCI reference, e.g. `ghcr.io/devcontainers/templates/alpine`. */
  id: string;
  version: string;
  /** The label. */
  name: string;
  description?: string;
  /**
   * The owner shown beside the label: the second part of the path of its collection's repository on `github.com`,
   * else the second part of a `ghcr.io` reference, else the publisher.
   */
  owner: string;
  /** The repository of the template's collection as the index publishes it (`sourceInformation.repository`). */
  collectionRepository?: string;
  options: Readonly<Record<string, unknown>>;
  optionalPaths: readonly string[];
  documentationURL?: string;
}

/** What the wizard shows of one Feature. */
export interface CatalogueFeature {
  /** The full OCI reference without a tag, e.g. `ghcr.io/devcontainers/features/common-utils`. */
  id: string;
  /** The published version, e.g. `2.5.3`. */
  version: string;
  /** The label. */
  name: string;
  /** The GitHub owner its collection's repository names; none when the repository is not on `github.com`. */
  owner?: string;
  options: Readonly<Record<string, unknown>>;
}

/** What reading or downloading the catalogue gives. */
export type CatalogueResult =
  | {
      kind: 'catalogue';
      templates: CatalogueTemplate[];
      features: CatalogueFeature[];
    }
  | {kind: 'failed'; cause: string};

/** What the download needs of its surroundings. */
export interface CataloguePorts {
  /** The extension host's environment. */
  environment: Readonly<Record<string, string | undefined>>;
  /** The text at `url`; it rejects with the cause in its message, and ends when `cancellation` aborts. */
  download(url: string, cancellation: AbortSignal): Promise<string>;
  /** Runs `callback` once after `milliseconds`; the result cancels it. */
  setTimer(milliseconds: number, callback: () => void): () => void;
}

type Fields = Record<string, unknown>;

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The index to download: the harness's own when the switch is on and it names one, else the published one. */
export function catalogueUrlOf(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return harnessUrlOf(environment, INDEX_VARIABLE, CATALOGUE_URL);
}

/** The owner a collection's repository on `github.com` names: the first part of its path. */
function repositoryOwnerOf(repository: string | undefined): string | undefined {
  if (repository === undefined) {
    return undefined;
  }
  try {
    const address = new URL(repository);
    const [, owner] = address.pathname.split('/');
    return address.hostname === 'github.com' && owner !== ''
      ? owner
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The owner of a template: the GitHub owner its collection's repository names, else the second part of its `ghcr.io`
 * reference, else its publisher.
 */
function ownerOf(
  reference: string,
  entry: Fields,
  repository: string | undefined,
): string {
  const [registry, owner] = reference.split('/');
  return (
    repositoryOwnerOf(repository) ??
    (registry === 'ghcr.io' && owner !== undefined
      ? owner
      : (textOf(entry.publisher) ?? ''))
  );
}

/** What every entry of the index, template or Feature, must have: a text `id`, `name` and `version`. */
function identityOf(
  entry: unknown,
):
  | {fields: Fields; reference: string; name: string; version: string}
  | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const reference = textOf(entry.id);
  const name = textOf(entry.name);
  const version = textOf(entry.version);
  return reference === undefined || name === undefined || version === undefined
    ? undefined
    : {fields: entry, reference, name, version};
}

/** The template an entry of the index describes; none for an entry without a text `id`, `name` and `version`. */
function templateOf(
  candidate: unknown,
  repository: string | undefined,
): CatalogueTemplate | undefined {
  const identity = identityOf(candidate);
  if (identity === undefined) {
    return undefined;
  }
  const {fields: entry, reference, name, version} = identity;
  const description = textOf(entry.description);
  const documentationURL = textOf(entry.documentationURL);
  return {
    id: reference,
    version,
    name,
    ...(description === undefined ? {} : {description}),
    owner: ownerOf(reference, entry, repository),
    ...(repository === undefined ? {} : {collectionRepository: repository}),
    options: isRecord(entry.options) ? entry.options : {},
    optionalPaths: Array.isArray(entry.optionalPaths)
      ? entry.optionalPaths.filter(
          (path): path is string => typeof path === 'string',
        )
      : [],
    ...(documentationURL === undefined ? {} : {documentationURL}),
  };
}

/** The Feature an entry of the index describes; none for an entry without a text `id`, `name` and `version`. */
function featureOf(
  candidate: unknown,
  repository: string | undefined,
): CatalogueFeature | undefined {
  const identity = identityOf(candidate);
  if (identity === undefined) {
    return undefined;
  }
  const {fields, reference, name, version} = identity;
  const owner = repositoryOwnerOf(repository);
  return {
    id: reference,
    version,
    name,
    ...(owner === undefined ? {} : {owner}),
    options: isRecord(fields.options) ? fields.options : {},
  };
}

/** The repository a collection of the index names as its source, when it names one. */
function repositoryOf(collection: Fields): string | undefined {
  return isRecord(collection.sourceInformation)
    ? textOf(collection.sourceInformation.repository)
    : undefined;
}

/** The templates and the Features of the index text, in the index's order; the parser's own message for text that is no JSON. */
export function parseCatalogue(text: string): CatalogueResult {
  let index: unknown;
  try {
    index = JSON.parse(text);
  } catch (caught) {
    return {kind: 'failed', cause: (caught as Error).message};
  }
  const collections: unknown[] =
    isRecord(index) && Array.isArray(index.collections)
      ? (index.collections as unknown[])
      : [];
  return {
    kind: 'catalogue',
    templates: collections.flatMap(collection =>
      isRecord(collection) && Array.isArray(collection.templates)
        ? (collection.templates as unknown[]).flatMap(
            entry => templateOf(entry, repositoryOf(collection)) ?? [],
          )
        : [],
    ),
    features: collections.flatMap(collection =>
      isRecord(collection) && Array.isArray(collection.features)
        ? (collection.features as unknown[]).flatMap(
            entry => featureOf(entry, repositoryOf(collection)) ?? [],
          )
        : [],
    ),
  };
}

/** Downloads the index and reads it: once for each run of the wizard, never kept. */
export async function fetchCatalogue(
  ports: CataloguePorts,
  cancellation: AbortSignal,
): Promise<CatalogueResult> {
  const {own, release} = linkedAbort(cancellation);
  const state = {timedOut: false};
  const stop = ports.setTimer(DOWNLOAD_MILLISECONDS, () => {
    state.timedOut = true;
    own.abort();
  });
  const outcome = await ports
    .download(catalogueUrlOf(ports.environment), own.signal)
    .then(parseCatalogue, (caught: unknown): CatalogueResult => ({
      kind: 'failed',
      cause: state.timedOut
        ? 'the catalogue download timed out'
        : caught instanceof Error
          ? caught.message
          : String(caught),
    }));
  stop();
  release();
  return outcome;
}

/** The template of the text shown when the catalogue cannot be downloaded; the string id is `catalogueUnavailable`. */
const UNAVAILABLE_TEMPLATE =
  "The list of dev container templates couldn't be downloaded: {0}";

/** What the editor shows the failure with. */
export interface CatalogueDialogs {
  /** A modal error with `message` and no buttons but the editor's own. */
  showModalError(message: string): PromiseLike<unknown>;
}

/** Tells the user that the catalogue could not be downloaded and why, on any path that starts the wizard. */
export async function showCatalogueFailure(
  dialogs: CatalogueDialogs,
  translate: Translate,
  cause: string,
): Promise<void> {
  await dialogs.showModalError(
    filled(translate, UNAVAILABLE_TEMPLATE, [cause]),
  );
}
