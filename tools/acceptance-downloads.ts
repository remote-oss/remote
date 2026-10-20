/**
 * @fileoverview The download host of the acceptance runs: an HTTP and an HTTPS server the run controls, from which
 * the harness host and the editor fetch the server archive, or fail on purpose: a status, a broken body, a hang. The behaviour is chosen
 * by the first segment of the path; every request is logged; the certificate is the run's own, trusted by nobody.
 */

import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
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
import {type CommandRunner, checked} from './command-runner.ts';

/** The VSCodium server for Alpine the download host serves: the release the client is pinned to, by architecture. */
export const SERVER_ARCHIVE = {
  tagName: '1.140.06829-insider',
  repository: 'VSCodium/vscodium-insiders',
  /** The release asset's sha256, by `alpine-<architecture>` of the host. */
  sha256: {
    'alpine-arm64':
      'e0f2b7bbd1760f1c6cf97e720f031a6c6415664bd589bba659d655323fec43e2',
    'alpine-x64':
      'df0678a1bd2f6640f527b497fa47d99795041c7774581761ada97f6eeaad5a00',
  },
} as const;

/** The names the harness host knows the download host by. */
export const DOWNLOAD_HOST_NAMES: readonly string[] = [
  'downloads',
  'update.code.visualstudio.com',
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

/** The file name of the server archive for an architecture. */
export function serverArchiveName(architecture: string): string {
  return `vscodium-reh-alpine-${architecture}-${SERVER_ARCHIVE.tagName}.tar.gz`;
}

/** Downloads a file into memory; the run's own downloader, replaced by a test. */
export type Download = (address: string) => Promise<Uint8Array>;

/**
 * The server archive for `architecture` in `cacheFolder`, downloaded from the pinned release when it is missing or
 * does not match its checksum. Throws when the download does not match either.
 */
export async function serverArchiveOf(
  cacheFolder: string,
  architecture: string,
  download: Download,
  writeFile: (file: string, bytes: Uint8Array) => void,
  checksums: Readonly<Record<string, string>> = SERVER_ARCHIVE.sha256,
): Promise<string> {
  const expected = checksums[`alpine-${architecture}`];
  if (expected === undefined) {
    throw new Error(`no server archive is pinned for ${architecture}`);
  }
  const file = path.join(cacheFolder, serverArchiveName(architecture));
  if (existsSync(file) && sha256Of(readFileSync(file)) === expected) {
    return file;
  }
  const archive = await download(
    `https://github.com/${SERVER_ARCHIVE.repository}/releases/download/${SERVER_ARCHIVE.tagName}/${serverArchiveName(architecture)}`,
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
    ...DOWNLOAD_HOST_NAMES.map(hostName =>
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
  archiveFile: string;
  certificateFile: string;
  keyFile: string;
  /** One line per request is appended here. */
  logFile: string;
  /** One line per TLS handshake that names a server is appended here: the time, and the server name the client asked for. */
  tlsLogFile: string;
}

/** A running download host. */
export interface DownloadHost {
  httpPort: number;
  httpsPort: number;
  /** Closes the held connections and the servers. */
  stop(): Promise<void>;
}

/** The answer to one request, chosen by the first segment of its path. */
function answer(
  request: IncomingMessage,
  response: ServerResponse,
  archiveFile: string,
  held: Set<Socket>,
): void {
  const archiveLength = statSync(archiveFile).size;
  switch (String(request.url).split('/')[1]) {
    case 'ok':
      response.writeHead(200, {'Content-Length': archiveLength});
      response.end(readFileSync(archiveFile));
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
    case 'cut':
      response.writeHead(200, {'Content-Length': archiveLength});
      response.write(readFileSync(archiveFile).subarray(0, CUT_BYTES), () => {
        request.socket.destroy();
      });
      return;
    case 'slow':
      sendSlowly(response, readFileSync(archiveFile));
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
    answer(request, response, options.archiveFile, held);
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

/** The harness variables of a download host: its bases as the harness host and as the editor reach it, and its log. */
export function downloadVariables(
  host: Pick<DownloadHost, 'httpPort' | 'httpsPort'>,
  logFile: string,
  tlsLogFile: string,
): Record<string, string> {
  return {
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
 * Starts the download host of a run in `runFolder`: the server archive for this machine's architecture from the cache
 * under `root`, the run's certificate, and the two ports on the loopback address and on Docker's bridge gateway.
 */
export async function startRunDownloads(
  command: CommandRunner,
  download: Download,
  root: string,
  runFolder: string,
  architecture: string = process.arch,
  checksums: Readonly<Record<string, string>> = SERVER_ARCHIVE.sha256,
): Promise<RunDownloads> {
  const archiveFile = await serverArchiveOf(
    path.join(root, '.vscode-test', 'downloads'),
    architecture,
    download,
    writeFileSync,
    checksums,
  );
  const folder = path.join(runFolder, 'downloads');
  mkdirSync(folder, {recursive: true});
  const certificate = makeCertificate(folder);
  const logFile = path.join(folder, 'requests.log');
  writeFileSync(logFile, '');
  const tlsLogFile = path.join(runFolder, 'downloads-tls.log');
  writeFileSync(tlsLogFile, '');
  const host = await startDownloadHost({
    addresses: ['127.0.0.1', bridgeGateway(command)],
    archiveFile,
    ...certificate,
    logFile,
    tlsLogFile,
  });
  return {
    variables: downloadVariables(host, logFile, tlsLogFile),
    stop: () => host.stop(),
  };
}
