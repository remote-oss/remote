/**
 * @fileoverview The extensions cache of a new container: each extension the server is to install is taken
 * as a package from the shared cache when it is there, else downloaded once from the product's gallery, checked
 * against the checksum the gallery publishes beside it, and kept for every later container. The container's own
 * cache entry links to the shared package on the `vscode` volume, or is a copy of the client's when no volume is
 * mounted; the server then installs from that file. A package that can't be cached is left to the server's own
 * download, as without a cache.
 */

import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import {
  type ClientFilePort,
  CLIENT_DOWNLOAD_BOUNDS,
  type DownloadPort,
  parseResult,
  RESULT_BEGIN,
  RESULT_END,
} from 'lib-server';

/** The gallery query flags that bring each version's files, properties and target platform. */
const QUERY_FLAGS = 950;

/** The query's filter type that names one extension by its id. */
const EXTENSION_NAME_FILTER = 7;

const PACKAGE_ASSET = 'Microsoft.VisualStudio.Services.VSIXPackage';
const ENGINE_PROPERTY = 'Microsoft.VisualStudio.Code.Engine';
const PRERELEASE_PROPERTY = 'Microsoft.VisualStudio.Code.PreRelease';
const UNIVERSAL = 'universal';

/** What a gallery id, a version and a target platform may hold, so that a file name made of them stays one name. */
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TARGET = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** How long one gallery query may take before the extension is left to the server, in milliseconds. */
export const GALLERY_QUERY_MILLISECONDS = 15_000;

/** The version of an extension chosen for a container: its package, and the file name the cache keeps it under. */
export interface GalleryPick {
  id: string;
  version: string;
  packageAddress: string;
  fileName: string;
}

/** The body of the gallery query for one extension id. */
export function galleryQueryOf(extensionId: string): unknown {
  return {
    filters: [
      {
        criteria: [{filterType: EXTENSION_NAME_FILTER, value: extensionId}],
        pageNumber: 1,
        pageSize: 1,
      },
    ],
    flags: QUERY_FLAGS,
  };
}

/** The numbers of a version text, `major.minor.patch`, ignoring anything after them; none for another text. */
function numbersOf(version: string): [number, number, number] | undefined {
  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return found === null
    ? undefined
    : [Number(found[1]), Number(found[2]), Number(found[3])];
}

function atLeast(
  version: readonly [number, number, number],
  floor: readonly [number, number, number],
): boolean {
  if (version[0] !== floor[0]) {
    return version[0] > floor[0];
  }
  return version[1] !== floor[1]
    ? version[1] > floor[1]
    : version[2] >= floor[2];
}

/**
 * Whether an extension's engine range accepts the product's version: `*`, `^x.y.z` (the same major, at least x.y.z),
 * and `>=x.y.z` or a bare `x.y.z` (at least x.y.z). A range of another form is not accepted.
 */
export function engineAccepts(engine: string, productVersion: string): boolean {
  const range = engine.trim();
  if (range === '*') {
    return true;
  }
  const product = numbersOf(productVersion);
  const caret = range.startsWith('^');
  const floor = numbersOf(range.replace(/^(\^|>=)\s*/, ''));
  if (product === undefined || floor === undefined) {
    return false;
  }
  return (!caret || product[0] === floor[0]) && atLeast(product, floor);
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The value of a gallery version's property, by its key. */
function propertyOf(
  version: Record<string, unknown>,
  key: string,
): string | undefined {
  const found = listOf(version.properties)
    .map(recordOf)
    .find(property => property?.key === key);
  return typeof found?.value === 'string' ? found.value : undefined;
}

/**
 * The newest version of the gallery's answer for `extensionId` that the container can install: for its target or universal,
 * not a pre-release, with an engine the product's version meets, and with a package to download. A version or target
 * that isn't a plain version or platform name is passed over, so the file name stays inside its folder. A `pinned`
 * version is the only one taken. None otherwise.
 */
export function pickOf(
  answer: unknown,
  extensionId: string,
  target: string,
  productVersion: string,
  pinned?: string,
): GalleryPick | undefined {
  const extension = recordOf(
    listOf(recordOf(listOf(recordOf(answer)?.results)[0])?.extensions)[0],
  );
  for (const entry of listOf(extension?.versions)) {
    const version = recordOf(entry);
    const versionText = version?.version;
    const versionTarget =
      typeof version?.targetPlatform === 'string'
        ? version.targetPlatform
        : UNIVERSAL;
    const packageAddress = listOf(version?.files)
      .map(recordOf)
      .find(file => file?.assetType === PACKAGE_ASSET)?.source;
    if (
      version === undefined ||
      typeof versionText !== 'string' ||
      !VERSION.test(versionText) ||
      (pinned !== undefined && versionText !== pinned) ||
      !TARGET.test(versionTarget) ||
      typeof packageAddress !== 'string' ||
      (versionTarget !== target && versionTarget !== UNIVERSAL) ||
      propertyOf(version, PRERELEASE_PROPERTY) === 'true' ||
      !engineAccepts(
        propertyOf(version, ENGINE_PROPERTY) ?? '*',
        productVersion,
      )
    ) {
      continue;
    }
    return {
      id: extensionId,
      version: versionText,
      packageAddress,
      fileName: `${extensionId}-${versionText}${versionTarget === UNIVERSAL ? '' : `-${versionTarget}`}.vsix`,
    };
  }
  return undefined;
}

/**
 * The address of the checksum a gallery publishes beside a package, as Open VSX does: the package's address with its
 * `.vsix` ending replaced by `.sha256`. None for an address that doesn't end so.
 */
export function checksumAddressOf(packageAddress: string): string | undefined {
  const address = new URL(packageAddress);
  if (!address.pathname.endsWith('.vsix')) {
    return undefined;
  }
  address.pathname = `${address.pathname.slice(0, -'.vsix'.length)}.sha256`;
  return address.toString();
}

/**
 * The fixed script of the container side, by `CACHE_ACTION`: `own` makes the container's cache folder; `link` links
 * the shared package into it when the package is there; `publish` gives the copied part its final name in the shared
 * cache without replacing a package another container published first, then links it; `present` only looks. A link
 * is made only where the container's cache has no entry of that name, so an entry the server wrote stays. It reports
 * `server.cached` and `server.present`.
 */
export const CACHE_SCRIPT = [
  'set -u',
  'mkdir -p -- "$OWN_FOLDER" 2>/dev/null',
  'cached=no',
  'case $CACHE_ACTION in',
  '  link) [ -f "$SHARED_FOLDER/$FILE_NAME" ] && cached=yes ;;',
  '  publish)',
  '    ln -- "$PART_FILE" "$SHARED_FOLDER/$FILE_NAME" 2>/dev/null',
  '    rm -f -- "$PART_FILE"',
  '    [ -f "$SHARED_FOLDER/$FILE_NAME" ] && cached=yes',
  '    ;;',
  'esac',
  'present=no',
  '{ [ -e "$OWN_FOLDER/$FILE_NAME" ] || [ -L "$OWN_FOLDER/$FILE_NAME" ]; } && present=yes',
  'if [ "$cached" = yes ] && [ "$present" = no ]; then',
  '  ln -s -- "$SHARED_FOLDER/$FILE_NAME" "$OWN_FOLDER/$FILE_NAME" || cached=no',
  'fi',
  `printf '%s\\n' '${RESULT_BEGIN}' 'status=Ok' "server.cached=$cached" "server.present=$present" '${RESULT_END}'`,
  '',
].join('\n');

/** What the cache step reads and calls. */
export interface ExtensionCachePorts {
  /** Posts a gallery query and gives the answer's JSON, or undefined when the gallery gave none. */
  queryGallery(
    address: string,
    query: unknown,
    cancellation: AbortSignal,
  ): Promise<unknown>;
  download: DownloadPort;
  files: ClientFilePort;
  /** The text of a client file, or undefined when it can't be read. */
  readText(file: string): Promise<string | undefined>;
  channel: HostChannel;
  newTemporaryToken(): string;
  logger: Logger;
}

/** One new container's cache step. */
export interface ExtensionCacheRequest {
  extensions: readonly string[];
  /** The gallery's service address, from the product. */
  serviceUrl: string;
  /** The container's target platform as the gallery names it, for example `linux-x64` or `alpine-arm64`. */
  target: string;
  productVersion: string;
  /** The shared cache on the `vscode` volume, or none when no volume is mounted, where the client keeps the packages. */
  sharedFolder: string | undefined;
  /** The client's own folder for packages. */
  clientFolder: string;
  /** The container's own cache folder, in the server's data folder. */
  ownFolder: string;
  /** How long one gallery query may take. */
  queryMilliseconds: number;
  cancellation: AbortSignal;
}

/** What the container side found: whether the shared package is there, and whether the container's cache had an entry. */
interface ContainerFacts {
  cached: boolean;
  present: boolean;
}

/** Runs the container side with `variables`, and gives what it found. */
async function containerSide(
  ports: ExtensionCachePorts,
  request: ExtensionCacheRequest,
  variables: Readonly<Record<string, string>>,
): Promise<ContainerFacts> {
  const lines: string[] = [];
  const outcome = await ports.channel.runScript(
    {
      script: CACHE_SCRIPT,
      interpreter: 'posixShell',
      environment: {
        OWN_FOLDER: request.ownFolder,
        SHARED_FOLDER: request.sharedFolder ?? '',
        FILE_NAME: '',
        PART_FILE: '',
        CACHE_ACTION: 'own',
        ...variables,
      },
      input: {kind: 'text', text: ''},
      cancellation: request.cancellation,
    },
    line => {
      lines.push(line);
    },
  );
  const parsed = outcome.kind === 'failed' ? undefined : parseResult(lines);
  const facts =
    parsed !== undefined && 'block' in parsed
      ? parsed.block.serverFacts
      : undefined;
  return {cached: facts?.cached === 'yes', present: facts?.present === 'yes'};
}

/** Downloads `address` into the client file `destination`; gives whether it worked, logging why when it didn't. */
async function downloaded(
  ports: ExtensionCachePorts,
  address: string,
  destination: string,
  cancellation: AbortSignal,
): Promise<boolean | 'missing'> {
  const result = await ports.download.download({
    ...CLIENT_DOWNLOAD_BOUNDS,
    address,
    destination,
    cancellation,
    redirect: {kind: 'any'},
    authorizationFor: () => undefined,
    onPercent: () => undefined,
  });
  if (result.kind === 'downloaded') {
    return true;
  }
  return result.kind === 'failed' && result.status === 404 ? 'missing' : false;
}

/**
 * The path of `pick`'s package in the container when a cache already holds it: linked from the shared cache, or copied
 * from the client's own folder when no volume is mounted. None when no cache has it yet.
 */
async function existingPackage(
  ports: ExtensionCachePorts,
  request: ExtensionCacheRequest,
  pick: GalleryPick,
): Promise<string | undefined> {
  const ownFile = `${request.ownFolder}/${pick.fileName}`;
  if (request.sharedFolder !== undefined) {
    const facts = await containerSide(ports, request, {
      CACHE_ACTION: 'link',
      FILE_NAME: pick.fileName,
    });
    if (!facts.cached) {
      return undefined;
    }
    ports.logger.info(
      `the extension ${pick.id}@${pick.version} is taken from the shared cache`,
    );
    return ownFile;
  }
  const clientFile = `${request.clientFolder}/${pick.fileName}`;
  if (!(await ports.files.exists(clientFile))) {
    return undefined;
  }
  return (await copiedToContainer(ports, request, pick, clientFile))
    ? ownFile
    : undefined;
}

/**
 * Downloads `pick`'s package and its published checksum, checks it, and keeps it: published in the shared cache, or in
 * the client's folder, and given to the container's own cache where it has no entry of that name. Each way it can't
 * is one log line; nothing is kept that didn't match.
 */
async function storedPackage(
  ports: ExtensionCachePorts,
  request: ExtensionCacheRequest,
  pick: GalleryPick,
): Promise<void> {
  const {logger, files} = ports;
  const label = `${pick.id}@${pick.version}`;
  const checksumAddress = checksumAddressOf(pick.packageAddress);
  const token = ports.newTemporaryToken();
  const checksumFile = `${request.clientFolder}/.${pick.fileName}.${token}.sha256`;
  const partFile = `${request.clientFolder}/.${pick.fileName}.${token}.part`;
  try {
    const checksumRead =
      checksumAddress === undefined
        ? 'missing'
        : await downloaded(
            ports,
            checksumAddress,
            checksumFile,
            request.cancellation,
          );
    const expected =
      checksumRead === true
        ? (await ports.readText(checksumFile))?.trim().toLowerCase()
        : undefined;
    if (expected === undefined || !/^[0-9a-f]{64}$/.test(expected)) {
      logger.info(`no checksum is published for ${label}; it isn't cached`);
      return;
    }
    if (
      (await downloaded(
        ports,
        pick.packageAddress,
        partFile,
        request.cancellation,
      )) !== true
    ) {
      logger.info(
        `the extension ${label} could not be downloaded for the cache`,
      );
      return;
    }
    if ((await files.sha256(partFile)) !== expected) {
      logger.info(
        `the extension ${label} doesn't match its published checksum; nothing is cached`,
      );
      return;
    }
    if (request.sharedFolder === undefined) {
      await keptOnClient(ports, request, pick, partFile);
    } else {
      await publishedShared(ports, request, {
        sharedFolder: request.sharedFolder,
        pick,
        partFile,
        token,
      });
    }
  } finally {
    await files.remove(checksumFile);
    await files.remove(partFile);
  }
}

/** Copies a client file into the container's own cache, its folder made first, unless an entry of its name is there; gives whether the container has it. */
async function copiedToContainer(
  ports: ExtensionCachePorts,
  request: ExtensionCacheRequest,
  pick: GalleryPick,
  clientFile: string,
): Promise<boolean> {
  const facts = await containerSide(ports, request, {
    CACHE_ACTION: 'present',
    FILE_NAME: pick.fileName,
  });
  if (facts.present) {
    return true;
  }
  const copied = await ports.channel.copyToHost({
    localFile: clientFile,
    remotePath: `${request.ownFolder}/${pick.fileName}`,
    cancellation: request.cancellation,
  });
  return copied.kind !== 'failed';
}

/** Keeps a checked package in the client's folder under its final name, then gives it to the container. */
async function keptOnClient(
  ports: ExtensionCachePorts,
  request: ExtensionCacheRequest,
  pick: GalleryPick,
  partFile: string,
): Promise<void> {
  const clientFile = `${request.clientFolder}/${pick.fileName}`;
  const renamed = await ports.files.rename(partFile, clientFile);
  if (renamed.kind !== 'failed') {
    await copiedToContainer(ports, request, pick, clientFile);
  }
}

/** Copies a checked package into the shared cache under a part name, then publishes it there and links it. */
async function publishedShared(
  ports: ExtensionCachePorts,
  request: ExtensionCacheRequest,
  place: {
    sharedFolder: string;
    pick: GalleryPick;
    partFile: string;
    token: string;
  },
): Promise<void> {
  const sharedPart = `${place.sharedFolder}/.${place.pick.fileName}.${place.token}.part`;
  const copied = await ports.channel.copyToHost({
    localFile: place.partFile,
    remotePath: sharedPart,
    cancellation: request.cancellation,
  });
  if (copied.kind !== 'failed') {
    await containerSide(ports, request, {
      CACHE_ACTION: 'publish',
      FILE_NAME: place.pick.fileName,
      PART_FILE: sharedPart,
    });
  }
}

/** What the server's start gets, and what the cache keeps for after it. */
export interface ExtensionPlan {
  /**
   * The extensions for the server's `--install-extension`, in order: the path of each package a cache already holds,
   * and the entry itself for every other, which the server installs from the gallery after it starts.
   */
  installs: string[];
  /** The gallery versions no cache holds yet: the background step caches them for the next container. */
  pending: GalleryPick[];
}

/** The text a log line gives for something thrown: an error's message, or the value itself. */
export function reasonOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** How long the background step may take in all, in milliseconds. */
const BACKGROUND_CACHE_MILLISECONDS = 600_000;

/**
 * The plan of a new container's extensions, before its server starts: a gallery query for each plain entry, and the
 * cached package's path where a cache has it. Nothing is downloaded here, so the server's own installs are still
 * running when the window connects. Nothing of this fails the connect.
 */
export async function planExtensions(
  ports: ExtensionCachePorts,
  request: ExtensionCacheRequest,
): Promise<ExtensionPlan> {
  const plan: ExtensionPlan = {installs: [], pending: []};
  for (const entry of request.extensions) {
    const parts = entry.split('@');
    const [extensionId = '', pinned] = parts;
    if (
      parts.length > 2 ||
      !EXTENSION_ID.test(extensionId) ||
      (pinned !== undefined && !VERSION.test(pinned))
    ) {
      ports.logger.info(
        `${entry} isn't a plain gallery id or pinned version; the server installs it`,
      );
      plan.installs.push(entry);
      continue;
    }
    const answer = await ports.queryGallery(
      `${request.serviceUrl}/extensionquery`,
      galleryQueryOf(extensionId),
      AbortSignal.any([
        request.cancellation,
        AbortSignal.timeout(request.queryMilliseconds),
      ]),
    );
    const pick = pickOf(
      answer,
      extensionId,
      request.target,
      request.productVersion,
      pinned,
    );
    if (pick === undefined) {
      ports.logger.info(
        `the gallery offers no version of ${entry} for ${request.target}; the server installs it`,
      );
      plan.installs.push(entry);
      continue;
    }
    const cached = await existingPackage(ports, request, pick);
    plan.installs.push(cached ?? entry);
    if (cached === undefined) {
      plan.pending.push(pick);
    }
  }
  return plan;
}

/**
 * Caches the pending versions after the server is ready, one at a time, for the next container. `lifetime` ends with
 * the connection; the whole step is bounded besides. Its failures are log lines: nothing is shown, and the connection
 * is never touched.
 */
export async function cacheInBackground(
  ports: ExtensionCachePorts,
  request: Omit<ExtensionCacheRequest, 'cancellation'>,
  pending: readonly GalleryPick[],
  lifetime: AbortSignal,
  bound: number = BACKGROUND_CACHE_MILLISECONDS,
): Promise<void> {
  const cancellation = AbortSignal.any([lifetime, AbortSignal.timeout(bound)]);
  const bounded = {...request, cancellation};
  for (const pick of pending) {
    if (cancellation.aborted) {
      ports.logger.info(
        `the extensions cache stopped before ${pick.id}@${pick.version}: ${lifetime.aborted ? 'the connection ended' : 'its time ran out'}`,
      );
      return;
    }
    try {
      await storedPackage(ports, bounded, pick);
    } catch (caught) {
      ports.logger.info(
        `the extension ${pick.id}@${pick.version} could not be cached: ${reasonOf(caught)}`,
      );
    }
  }
}
