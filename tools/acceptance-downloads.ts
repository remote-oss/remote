/**
 * @fileoverview The download host of the acceptance runs: an HTTP and an HTTPS server the run controls, from which
 * the harness host and the editor fetch the server archive, or fail on purpose: a status, a broken body, a hang, and
 * the run's template index under `/templates/`. The behaviour is chosen by the first segment of the path; every request
 * is logged; the certificate is the run's own, trusted by nobody.
 */

import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {createSecureContext} from 'node:tls';
import type {AddressInfo, Socket} from 'node:net';
import path from 'node:path';
import {
  servedControlFolder,
  servedTemplatesFolder,
} from './acceptance-templates.ts';
import {type CommandRunner, checked} from './command-runner.ts';

/**
 * The VSCodium servers the download host serves: the release the client is pinned to, by platform, `alpine-<arch>`
 * (musl) or `linux-<arch>` (glibc).
 */
export const SERVER_ARCHIVE = {
  tagName: '1.140.06829-insider',
  repository: 'VSCodium/vscodium-insiders',
  /** The release asset's sha256, by platform; the release lists each asset's digest. */
  sha256: {
    'alpine-arm64':
      'e0f2b7bbd1760f1c6cf97e720f031a6c6415664bd589bba659d655323fec43e2',
    'alpine-x64':
      'df0678a1bd2f6640f527b497fa47d99795041c7774581761ada97f6eeaad5a00',
    'linux-arm64':
      '397a7c3bd38a5ea7f004253b2b5c08b7bdaa79d1f93a0f7f64d04c826a21481f',
    'linux-x64':
      'bbc2ced95874d47e61958909ac7267205ba85469c2835666fb5b74746569b7cd',
  },
} as const;

/** The names the harness host knows the download host by. */
export const DOWNLOAD_HOST_NAMES: readonly string[] = [
  'downloads',
  'update.code.visualstudio.com',
];

/**
 * The names the run's certificate holds: those of the download host, and `localhost`, which the runner itself resolves,
 * for the CLI that runs there and fetches a Feature's tarball. `localhost` is not one of the harness host's names: it
 * must stay the harness host's own loopback.
 */
const CERTIFICATE_NAMES: readonly string[] = [
  ...DOWNLOAD_HOST_NAMES,
  'localhost',
];

/** The certificate's common name: the download host's own name. */
const CERTIFICATE_NAME = 'downloads';

/** How many bytes `cut` sends before it drops the connection. */
const CUT_BYTES = 1024 * 1024;

/** How many random bytes `junk` sends. */
const JUNK_BYTES = 64 * 1024;

/** How many bytes `slow` sends at each tick, and how long a tick is. */
const SLOW_CHUNK = 64 * 1024;

const SLOW_TICK_MILLISECONDS = 100;

/** The path that closes every connection `hang` holds. */
export const DROP_HUNG_PATH = '/control/drop-hung';

/** The file name of the server archive for a platform (`alpine-x64`, `linux-x64`, …). */
export function serverArchiveName(platform: string): string {
  return `vscodium-reh-${platform}-${SERVER_ARCHIVE.tagName}.tar.gz`;
}

/** The platforms a run serves for an architecture: the Alpine server, which a request naming none gets, then glibc's. */
export function servedPlatforms(architecture: string): [string, string] {
  return [`alpine-${architecture}`, `linux-${architecture}`];
}

/** A platform key: the operating system (`alpine` for musl) and the architecture. */
const PLATFORM = /^(?:alpine|linux|darwin|win32|windows)-[a-z0-9]+$/;

/**
 * The platform a request for the server names, as an archive's key, or undefined when it names none: a path segment
 * that is the template's `<os>-<arch>`, or the update service's `server-<platform>`, whose `linux-alpine` is Alpine on
 * x64.
 */
export function requestedPlatform(url: string): string | undefined {
  for (const segment of url.split('?')[0]?.split('/') ?? []) {
    const service = /^server-(.+)$/.exec(segment)?.[1];
    const named =
      service === 'linux-alpine' ? 'alpine-x64' : (service ?? segment);
    if (PLATFORM.test(named)) {
      return named;
    }
  }
  return undefined;
}

/** Downloads a file into memory; the run's own downloader, replaced by a test. */
export type Download = (address: string) => Promise<Uint8Array>;

/**
 * The server archive for `platform` in `cacheFolder`, downloaded from the pinned release when it is missing or does
 * not match its checksum. Throws when the download does not match either.
 */
export async function serverArchiveOf(
  cacheFolder: string,
  platform: string,
  download: Download,
  writeFile: (file: string, bytes: Uint8Array) => void,
  checksums: Readonly<Record<string, string>> = SERVER_ARCHIVE.sha256,
): Promise<string> {
  const expected = checksums[platform];
  if (expected === undefined) {
    throw new Error(`no server archive is pinned for ${platform}`);
  }
  const file = path.join(cacheFolder, serverArchiveName(platform));
  if (existsSync(file) && sha256Of(readFileSync(file)) === expected) {
    return file;
  }
  const archive = await download(
    `https://github.com/${SERVER_ARCHIVE.repository}/releases/download/${SERVER_ARCHIVE.tagName}/${serverArchiveName(platform)}`,
  );
  if (sha256Of(archive) !== expected) {
    throw new Error('the server archive download does not match its checksum');
  }
  mkdirSync(cacheFolder, {recursive: true});
  writeFile(file, archive);
  return file;
}

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** One DER element: its tag, its length and its content. */
function derElement(tagByte: number, ...contents: readonly Buffer[]): Buffer {
  const content = Buffer.concat(contents);
  const length =
    content.length < 0x80
      ? Buffer.from([content.length])
      : lengthOctets(content.length);
  return Buffer.concat([Buffer.from([tagByte]), length, content]);
}

/** The long form of a DER length. */
function lengthOctets(length: number): Buffer {
  const octets: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) {
    octets.unshift(rest % 256);
  }
  return Buffer.from([0x80 | octets.length, ...octets]);
}

/** A DER object identifier from its dotted form. */
function objectId(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const octets = [first * 40 + second];
  for (const arcValue of rest) {
    const groups = [arcValue % 128];
    for (
      let high = Math.floor(arcValue / 128);
      high > 0;
      high = Math.floor(high / 128)
    ) {
      groups.unshift(0x80 | (high % 128));
    }
    octets.push(...groups);
  }
  return derElement(0x06, Buffer.from(octets));
}

/** A DER UTCTime. */
function utcTime(time: Date): Buffer {
  const text = time.toISOString().replace(/[-:T]/g, '').slice(2, 14);
  return derElement(0x17, Buffer.from(`${text}Z`));
}

/** A positive serial number in minimal DER form: eight random bytes whose first is 1 to 127. */
function serialNumber(): Buffer {
  const serial = randomBytes(8);
  serial.writeUInt8((serial.readUInt8(0) % 127) + 1, 0);
  return serial;
}

/** The base64 of `bytes` in lines of 64 characters, each ending in a line break. */
function pemBody(bytes: Buffer): string {
  const text = bytes.toString('base64');
  let body = '';
  for (let start = 0; start < text.length; start += 64) {
    body += `${text.slice(start, start + 64)}\n`;
  }
  return body;
}

const SEQUENCE = 0x30;
const SHA256_WITH_RSA = '1.2.840.113549.1.1.11';
const COMMON_NAME = '2.5.4.3';
const SUBJECT_ALT_NAME = '2.5.29.17';

/**
 * Makes the run's certificate for the download host's names, signed by its own key (RSA, SHA-256, valid for two days),
 * writes it and the key as PEM into `folder`, and returns the files. Nothing trusts it.
 */
export function makeCertificate(folder: string): {
  certificateFile: string;
  keyFile: string;
} {
  const {publicKey, privateKey} = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const algorithm = derElement(
    SEQUENCE,
    objectId(SHA256_WITH_RSA),
    derElement(0x05),
  );
  const name = derElement(
    SEQUENCE,
    derElement(
      0x31,
      derElement(
        SEQUENCE,
        objectId(COMMON_NAME),
        derElement(0x0c, Buffer.from(CERTIFICATE_NAME)),
      ),
    ),
  );
  const now = Date.now();
  const alternativeNames = derElement(
    SEQUENCE,
    ...CERTIFICATE_NAMES.map(hostName =>
      derElement(0x82, Buffer.from(hostName)),
    ),
  );
  const extensions = derElement(
    0xa3,
    derElement(
      SEQUENCE,
      derElement(
        SEQUENCE,
        objectId(SUBJECT_ALT_NAME),
        derElement(0x04, alternativeNames),
      ),
    ),
  );
  const toBeSigned = derElement(
    SEQUENCE,
    derElement(0xa0, derElement(0x02, Buffer.from([2]))),
    derElement(0x02, serialNumber()),
    algorithm,
    name,
    derElement(
      SEQUENCE,
      utcTime(new Date(now - 60_000)),
      utcTime(new Date(now + 2 * 86_400_000)),
    ),
    name,
    publicKey.export({type: 'spki', format: 'der'}),
    extensions,
  );
  const signature = sign('sha256', toBeSigned, privateKey);
  const certificate = derElement(
    SEQUENCE,
    toBeSigned,
    algorithm,
    derElement(0x03, Buffer.from([0]), signature),
  );
  const certificateFile = path.join(folder, 'downloads-certificate.pem');
  const keyFile = path.join(folder, 'downloads-key.pem');
  writeFileSync(
    certificateFile,
    `-----BEGIN CERTIFICATE-----\n${pemBody(certificate)}-----END CERTIFICATE-----\n`,
  );
  writeFileSync(keyFile, privateKey.export({type: 'pkcs8', format: 'pem'}), {
    mode: 0o600,
  });
  return {certificateFile, keyFile};
}

/** What starts a download host. */
export interface DownloadHostOptions {
  /** The addresses it listens on, each with the same two ports. */
  addresses: readonly string[];
  /** The server archives by platform; a request that names no platform gets `defaultPlatform`'s. */
  archiveFiles: Readonly<Record<string, string>>;
  defaultPlatform: string;
  certificateFile: string;
  keyFile: string;
  /** One line per request is appended here. */
  logFile: string;
  /** One line per TLS handshake that names a server is appended here: the time, and the server name the client asked for. */
  tlsLogFile: string;
  /** The folder whose `devcontainer-index.json` the host serves under `/templates/`, once the run has written it. */
  templatesFolder: string;
  /** The folder whose `devcontainer-control-manifest.json` the host serves under `/control/`, once the run has written it. */
  controlFolder: string;
  /** The folder whose `<name>.tgz` files the host serves under `/features/`, as a Feature's direct tarball. */
  featuresFolder: string;
}

/** A running download host. */
export interface DownloadHost {
  httpPort: number;
  httpsPort: number;
  /** Closes the held connections and the servers. */
  stop(): Promise<void>;
}

/** The text `/templates/broken-index.json` answers: the start of an index, cut off, so it doesn't parse. */
export const BROKEN_INDEX_TEXT = '{"collections": [';

/**
 * The answer under `/templates/`: the run's index once it is written (404 before), an index that doesn't parse, or a
 * connection dropped before any answer.
 */
function answerTemplates(
  request: IncomingMessage,
  response: ServerResponse,
  templatesFolder: string,
): void {
  const indexFile = path.join(templatesFolder, 'devcontainer-index.json');
  switch (String(request.url).split('/')[2]) {
    case 'devcontainer-index.json':
      if (existsSync(indexFile)) {
        const body = readFileSync(indexFile);
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        });
        response.end(body);
        return;
      }
      break;
    case 'broken-index.json':
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(BROKEN_INDEX_TEXT),
      });
      response.end(BROKEN_INDEX_TEXT);
      return;
    case 'unreachable':
      request.socket.destroy();
      return;
    default:
      break;
  }
  response.writeHead(404, {'Content-Length': 0});
  response.end();
}

/** The answer under `/control/`: the run's control manifest once it is written (404 before), or a connection dropped. */
function answerControl(
  request: IncomingMessage,
  response: ServerResponse,
  controlFolder: string,
): void {
  const manifestFile = path.join(
    controlFolder,
    'devcontainer-control-manifest.json',
  );
  const requested = String(request.url).split('/')[2];
  if (requested === 'unreachable') {
    request.socket.destroy();
    return;
  }
  if (
    requested === 'devcontainer-control-manifest.json' &&
    existsSync(manifestFile)
  ) {
    const body = readFileSync(manifestFile);
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': body.length,
    });
    response.end(body);
    return;
  }
  response.writeHead(404, {'Content-Length': 0});
  response.end();
}

/** The answer under `/features/`: the `<name>.tgz` of the run's folder, or 404 for any other name or a missing file. */
function answerFeatures(
  response: ServerResponse,
  featuresFolder: string,
  url: string,
): void {
  const name = /^\/features\/([A-Za-z0-9._-]+\.tgz)$/.exec(
    url.split('?')[0] ?? '',
  )?.[1];
  const file = name === undefined ? undefined : path.join(featuresFolder, name);
  if (file === undefined || !existsSync(file)) {
    response.writeHead(404, {'Content-Length': 0});
    response.end();
    return;
  }
  const body = readFileSync(file);
  response.writeHead(200, {
    'Content-Type': 'application/gzip',
    'Content-Length': body.length,
  });
  response.end(body);
}

/**
 * The archive a request gets: the one of the platform it names, the default platform's when it names none, and none for
 * a platform the run serves no archive for.
 */
function archiveFileOf(
  url: string,
  options: Pick<DownloadHostOptions, 'archiveFiles' | 'defaultPlatform'>,
): string | undefined {
  return options.archiveFiles[
    requestedPlatform(url) ?? options.defaultPlatform
  ];
}

/**
 * The archive a `/machine/` request gets: the run's archive of the system the request names (`linux` or `alpine`),
 * whatever architecture it names, for a host whose `uname` reports another machine than the one it runs on; none for a
 * system the run has no archive of, or a path that names no platform.
 */
function machineArchiveOf(
  url: string,
  options: Pick<DownloadHostOptions, 'archiveFiles'>,
): string | undefined {
  const system = requestedPlatform(url)?.split('-')[0];
  const platform = Object.keys(options.archiveFiles).find(
    name => name.split('-')[0] === system,
  );
  return platform === undefined ? undefined : options.archiveFiles[platform];
}

/**
 * The archive's answers: whole (`ok`), cut after its first megabyte (`cut`) or in chunks at a slow pace (`slow`); 404
 * when the run serves no archive for the platform asked.
 */
function answerArchive(
  request: IncomingMessage,
  response: ServerResponse,
  archiveFile: string | undefined,
): void {
  if (archiveFile === undefined) {
    response.writeHead(404, {'Content-Length': 0});
    response.end();
    return;
  }
  const body = readFileSync(archiveFile);
  switch (String(request.url).split('/')[1]) {
    case 'cut':
      response.writeHead(200, {'Content-Length': body.length});
      response.write(body.subarray(0, CUT_BYTES), () => {
        request.socket.destroy();
      });
      return;
    case 'slow':
      sendSlowly(response, body);
      return;
    default:
      response.writeHead(200, {'Content-Length': body.length});
      response.end(body);
  }
}

/** The answer to one request, chosen by the first segment of its path. */
function answer(
  request: IncomingMessage,
  response: ServerResponse,
  options: Pick<
    DownloadHostOptions,
    | 'archiveFiles'
    | 'defaultPlatform'
    | 'templatesFolder'
    | 'controlFolder'
    | 'featuresFolder'
  >,
  held: Set<Socket>,
): void {
  switch (String(request.url).split('/')[1]) {
    case 'templates':
      answerTemplates(request, response, options.templatesFolder);
      return;
    case 'control':
      answerControl(request, response, options.controlFolder);
      return;
    case 'features':
      answerFeatures(response, options.featuresFolder, String(request.url));
      return;
    case 'ok':
    case 'cut':
    case 'slow':
      answerArchive(
        request,
        response,
        archiveFileOf(String(request.url), options),
      );
      return;
    case 'machine':
      answerArchive(
        request,
        response,
        machineArchiveOf(String(request.url), options),
      );
      return;
    case 'missing':
      response.writeHead(404, {'Content-Length': 0});
      response.end();
      return;
    case 'missing-cors':
      response.writeHead(404, {
        'Content-Length': 0,
        'Access-Control-Allow-Origin': '*',
      });
      response.end();
      return;
    case 'busy':
      response.writeHead(503, {'Content-Length': 0});
      response.end();
      return;
    case 'junk':
      response.writeHead(200, {'Content-Length': JUNK_BYTES});
      response.end(randomBytes(JUNK_BYTES));
      return;
    case 'hang':
      held.add(request.socket);
      request.socket.once('close', () => held.delete(request.socket));
      return;
    default:
      response.writeHead(404, {'Content-Length': 0});
      response.end();
  }
}

/** Sends `body` in chunks, one at each tick. */
function sendSlowly(response: ServerResponse, body: Uint8Array): void {
  response.writeHead(200, {'Content-Length': body.length});
  let offset = 0;
  const timer = setInterval(() => {
    response.write(body.subarray(offset, offset + SLOW_CHUNK));
    offset += SLOW_CHUNK;
    if (offset >= body.length) {
      clearInterval(timer);
      response.end();
    }
  }, SLOW_TICK_MILLISECONDS);
  response.once('close', () => {
    clearInterval(timer);
  });
}

/** Listens on `address` and `port` (0 for any), and gives the port it got. */
function listen(
  server: Server,
  address: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => {
      server.off('error', reject);
      const bound = server.address();
      resolve((bound as AddressInfo).port);
    });
  });
}

/** Closes a server, resolving also when it was never listening. */
function close(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => {
      resolve();
    });
    server.closeAllConnections();
  });
}

/** Starts the download host on every address of `options`, with one HTTP and one HTTPS port shared by them. */
export async function startDownloadHost(
  options: DownloadHostOptions,
): Promise<DownloadHost> {
  const held = new Set<Socket>();
  function handle(request: IncomingMessage, response: ServerResponse): void {
    appendFileSync(
      options.logFile,
      `${new Date().toISOString()} ${String(request.method)} ${String(request.url)} ${request.headers['user-agent'] ?? ''}\n`,
    );
    if (request.url === DROP_HUNG_PATH) {
      for (const socket of held) {
        socket.destroy();
      }
      held.clear();
      response.writeHead(204);
      response.end();
      return;
    }
    answer(request, response, options, held);
  }
  const secureOptions = {
    cert: readFileSync(options.certificateFile),
    key: readFileSync(options.keyFile),
  };
  const context = createSecureContext(secureOptions);
  const servers: Server[] = [];
  let httpPort = 0;
  let httpsPort = 0;
  try {
    for (const address of options.addresses) {
      const plain = createHttpServer(handle);
      servers.push(plain);
      httpPort = await listen(plain, address, httpPort);
      const secure = createHttpsServer(
        {
          ...secureOptions,
          SNICallback: (servername, done) => {
            appendFileSync(
              options.tlsLogFile,
              `${new Date().toISOString()} ${servername}\n`,
            );
            done(null, context);
          },
        },
        handle,
      );
      servers.push(secure);
      httpsPort = await listen(secure, address, httpsPort);
    }
  } catch (caught) {
    await Promise.all(servers.map(close));
    throw caught;
  }
  return {
    httpPort,
    httpsPort,
    stop: async () => {
      for (const socket of held) {
        socket.destroy();
      }
      await Promise.all(servers.map(close));
    },
  };
}

/** The Feature tarball of the run's fixture, by name under `/features/`: the CLI refuses any name but `devcontainer-feature-<id>.tgz`. */
const FEATURE_TARBALL = 'devcontainer-feature-c92-tarball.tgz';

/** Where the download host serves Feature tarballs from. */
function servedFeaturesFolder(runFolder: string): string {
  return path.join(runFolder, 'downloads', 'features');
}

/**
 * Packs the fixture Feature under `root` into its tarball in the run's features folder, as the dev container
 * specification's Feature tarballs are: the Feature's files at the top of a gzipped tar.
 */
function packFeatureTarball(
  command: CommandRunner,
  root: string,
  runFolder: string,
): void {
  const folder = servedFeaturesFolder(runFolder);
  mkdirSync(folder, {recursive: true});
  checked(command, 'tar', [
    '-czf',
    path.join(folder, FEATURE_TARBALL),
    '-C',
    path.join(
      root,
      'tests',
      'acceptance',
      'containers-features',
      'fixtures',
      'tarball-feature',
    ),
    '.',
  ]);
}

/**
 * The harness variables of a download host: its bases as the harness host and as the editor reach it, its log, the
 * certificate file the CLI of a launch can trust, and the address of the fixture Feature's tarball on the runner's own
 * `localhost`.
 */
export function downloadVariables(
  host: Pick<DownloadHost, 'httpPort' | 'httpsPort'>,
  logFile: string,
  tlsLogFile: string,
  certificateFile: string,
): Record<string, string> {
  return {
    HARNESS_DOWNLOADS_CERTIFICATE: certificateFile,
    HARNESS_FEATURE_TARBALL_URL: `https://localhost:${String(host.httpsPort)}/features/${FEATURE_TARBALL}`,
    HARNESS_DOWNLOADS_HTTP: `http://downloads:${String(host.httpPort)}`,
    HARNESS_DOWNLOADS_HTTPS: `https://downloads:${String(host.httpsPort)}`,
    HARNESS_DOWNLOADS_LICENSED: `https://update.code.visualstudio.com:${String(host.httpsPort)}`,
    HARNESS_DOWNLOADS_LOCAL: `http://127.0.0.1:${String(host.httpPort)}`,
    HARNESS_DOWNLOADS_LOG: logFile,
    HARNESS_DOWNLOADS_TLS_LOG: tlsLogFile,
  };
}

/** The `docker run` arguments that give the harness host the download host's names at the bridge's gateway. */
export function downloadHostArguments(): string[] {
  return DOWNLOAD_HOST_NAMES.flatMap(name => [
    '--add-host',
    `${name}:host-gateway`,
  ]);
}

/** The address of Docker's bridge gateway, where `host-gateway` points. */
export function bridgeGateway(command: CommandRunner): string {
  return checked(command, 'docker', [
    'network',
    'inspect',
    'bridge',
    '--format',
    '{{(index .IPAM.Config 0).Gateway}}',
  ]).trim();
}

/** The download host of a run: the variables the launches get, and its end. */
export interface RunDownloads {
  variables: Record<string, string>;
  stop(): Promise<void>;
}

/**
 * Starts the download host of a run in `runFolder`: the Alpine and glibc server archives for this machine's
 * architecture from the cache under `root`, the run's certificate, and the two ports on the loopback address and on
 * Docker's bridge gateway.
 */
export async function startRunDownloads(
  command: CommandRunner,
  download: Download,
  root: string,
  runFolder: string,
  architecture: string = process.arch,
  checksums: Readonly<Record<string, string>> = SERVER_ARCHIVE.sha256,
): Promise<RunDownloads> {
  const platforms = servedPlatforms(architecture);
  const archiveFiles: Record<string, string> = {};
  for (const platform of platforms) {
    archiveFiles[platform] = await serverArchiveOf(
      path.join(root, '.vscode-test', 'downloads'),
      platform,
      download,
      writeFileSync,
      checksums,
    );
  }
  const folder = path.join(runFolder, 'downloads');
  mkdirSync(folder, {recursive: true});
  const certificate = makeCertificate(folder);
  packFeatureTarball(command, root, runFolder);
  const logFile = path.join(folder, 'requests.log');
  writeFileSync(logFile, '');
  const tlsLogFile = path.join(runFolder, 'downloads-tls.log');
  writeFileSync(tlsLogFile, '');
  const host = await startDownloadHost({
    addresses: ['127.0.0.1', bridgeGateway(command)],
    archiveFiles,
    defaultPlatform: platforms[0],
    ...certificate,
    logFile,
    tlsLogFile,
    templatesFolder: servedTemplatesFolder(runFolder),
    controlFolder: servedControlFolder(runFolder),
    featuresFolder: servedFeaturesFolder(runFolder),
  });
  return {
    variables: downloadVariables(
      host,
      logFile,
      tlsLogFile,
      certificate.certificateFile,
    ),
    stop: () => host.stop(),
  };
}
