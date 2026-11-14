/**
 * @fileoverview engine-stand-in: a Docker engine address on a Windows client that takes the client's drive paths as
 * bind sources, as Docker Desktop's engine endpoint does, in front of an engine that runs in a WSL distro
 * (reading-2511-desktop-stand-in, #2511).
 *
 *   node tools/engine-stand-in.ts --engine tcp://<address>:<port> --address-file <file>
 *       listen on 127.0.0.1 at a free port, write `tcp://127.0.0.1:<port>` to <file> once listening, forward every
 *       request to the engine, and print a line for each bind source it rewrites
 *
 * Only a container create's body changes: a bind source on a Windows drive becomes the distro's `/mnt/<drive>/…` path
 * of its long form. Every other request, and the upgraded streams of attach, exec and BuildKit, pass through unchanged.
 */

import {realpathSync, writeFileSync} from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  request,
  type ServerResponse,
} from 'node:http';
import {type AddressInfo, connect, type Socket} from 'node:net';
import {pipeline} from 'node:stream';
import {buffer} from 'node:stream/consumers';
import {isMainModule, messageOf} from './repository.ts';

/** A path on a Windows drive, `C:\…` or `c:/…`. */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** The engine API's container create, with or without a version prefix. */
const CREATE_PATH = /^\/(v[0-9.]+\/)?containers\/create(\?|$)/;

/** Where the stand-in forwards to. */
export interface EngineAddress {
  readonly host: string;
  readonly port: number;
}

/** What the stand-in is given: where its lines go, and how a drive path's long form is read. */
export interface StandInOptions {
  readonly report: (line: string) => void;
  readonly longPathOf: (source: string) => string;
}

/** What a container create's body became. */
export type CreateReading =
  | {
      readonly kind: 'read';
      readonly body: Buffer;
      readonly rewrites: readonly string[];
    }
  | {readonly kind: 'unparsed'; readonly reason: string};

/** A running stand-in: the address a client names as `DOCKER_HOST`. */
export interface StandIn {
  readonly address: string;
  close(): Promise<void>;
}

/** The long form of `source` on this machine (`RUNNER~1` spelled out), or `source` itself when it does not exist. */
export function longPath(source: string): string {
  try {
    return realpathSync.native(source);
  } catch {
    return source;
  }
}

/** The distro's `/mnt/<drive>/…` path of the long form of `source`, a Windows drive path. */
function longPathOfDrive(
  source: string,
  longPathOf: (source: string) => string,
): string {
  const long = longPathOf(source);
  return `/mnt/${long.charAt(0).toLowerCase()}${long.slice(2).replaceAll('\\', '/')}`;
}

/** The distro's `/mnt/<drive>/…` path of a Windows drive path's long form, or undefined for any other path. */
export function distroPathOf(
  source: string,
  longPathOf: (source: string) => string,
): string | undefined {
  return DRIVE_PATH.test(source)
    ? longPathOfDrive(source, longPathOf)
    : undefined;
}

/**
 * A `Binds` entry whose source is on a Windows drive, split at the colon after the drive: the source, then
 * `:<target>` and any options. A drive path holds no other colon, so `c:/vscode` (a volume `c`) is not one.
 */
function driveBind(entry: unknown): {source: string; rest: string} | undefined {
  if (typeof entry !== 'string' || !DRIVE_PATH.test(entry)) {
    return undefined;
  }
  const separator = entry.indexOf(':', 2);
  return separator < 0
    ? undefined
    : {source: entry.slice(0, separator), rest: entry.slice(separator)};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The body of a container create with each bind source on a Windows drive rewritten, in `HostConfig.Binds` and in
 * `HostConfig.Mounts` entries of type bind, and a line per rewrite. A body that is not JSON is `unparsed` and never
 * rewritten in part; a body with nothing to rewrite is returned byte for byte.
 */
export function rewriteCreate(
  body: Buffer,
  longPathOf: (source: string) => string,
): CreateReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch (error) {
    return {kind: 'unparsed', reason: messageOf(error)};
  }
  const rewrites: string[] = [];
  const hostConfig = isRecord(parsed) ? parsed.HostConfig : undefined;
  if (isRecord(hostConfig)) {
    const binds = hostConfig.Binds;
    if (Array.isArray(binds)) {
      hostConfig.Binds = binds.map((entry: unknown, index) => {
        const drive = driveBind(entry);
        if (drive === undefined) {
          return entry;
        }
        const target = longPathOfDrive(drive.source, longPathOf);
        rewrites.push(
          `HostConfig.Binds[${String(index)}] ${drive.source} -> ${target}`,
        );
        return `${target}${drive.rest}`;
      });
    }
    const mounts = hostConfig.Mounts;
    if (Array.isArray(mounts)) {
      mounts.forEach((mount: unknown, index) => {
        if (
          !isRecord(mount) ||
          mount.Type !== 'bind' ||
          typeof mount.Source !== 'string'
        ) {
          return;
        }
        const target = distroPathOf(mount.Source, longPathOf);
        if (target !== undefined) {
          rewrites.push(
            `HostConfig.Mounts[${String(index)}].Source ${mount.Source} -> ${target}`,
          );
          mount.Source = target;
        }
      });
    }
  }
  return {
    kind: 'read',
    body: rewrites.length === 0 ? body : Buffer.from(JSON.stringify(parsed)),
    rewrites,
  };
}

/** The request line and headers of `incoming` as the client sent them. */
function requestHead(incoming: IncomingMessage): string {
  const headers = incoming.rawHeaders
    .map((word, index) => (index % 2 === 0 ? `${word}: ` : `${word}\r\n`))
    .join('');
  return `${String(incoming.method)} ${String(incoming.url)} HTTP/${incoming.httpVersion}\r\n${headers}\r\n`;
}

/** Starts the stand-in for `engine` on 127.0.0.1 at a free port. */
export async function startStandIn(
  engine: EngineAddress,
  options: StandInOptions,
): Promise<StandIn> {
  function relay(
    incoming: IncomingMessage,
    outgoing: ServerResponse,
    body: Buffer | undefined,
  ): void {
    const headers = {...incoming.headers};
    if (body !== undefined) {
      delete headers['transfer-encoding'];
      headers['content-length'] = String(body.length);
    }
    const upstream = request(
      {...engine, method: incoming.method, path: incoming.url, headers},
      answer => {
        outgoing.writeHead(Number(answer.statusCode), answer.rawHeaders);
        outgoing.flushHeaders();
        pipeline(answer, outgoing, () => undefined);
      },
    );
    upstream.on('error', error => {
      options.report(
        `engine-stand-in: ${String(incoming.method)} ${String(incoming.url)}: ${error.message}`,
      );
      if (outgoing.headersSent) {
        outgoing.destroy();
      } else {
        outgoing.writeHead(502).end(`engine-stand-in: ${error.message}`);
      }
    });
    if (body === undefined) {
      pipeline(incoming, upstream, () => undefined);
    } else {
      upstream.end(body);
    }
  }

  async function relayCreate(
    incoming: IncomingMessage,
    outgoing: ServerResponse,
  ): Promise<void> {
    let body: Buffer;
    try {
      body = await buffer(incoming);
    } catch {
      return;
    }
    const reading = rewriteCreate(body, options.longPathOf);
    const named = `engine-stand-in: POST ${String(incoming.url)}`;
    if (reading.kind === 'unparsed') {
      options.report(
        `${named}: the body is not JSON (${reading.reason}), so it is passed through unchanged`,
      );
      relay(incoming, outgoing, body);
      return;
    }
    for (const rewrite of reading.rewrites) {
      options.report(`${named}: ${rewrite}`);
    }
    relay(incoming, outgoing, reading.body);
  }

  const server = createServer({requestTimeout: 0}, (incoming, outgoing) => {
    if (incoming.method === 'POST' && CREATE_PATH.test(String(incoming.url))) {
      void relayCreate(incoming, outgoing);
    } else {
      relay(incoming, outgoing, undefined);
    }
  });
  const streams = new Set<Socket>();
  server.on(
    'upgrade',
    (incoming: IncomingMessage, client: Socket, head: Buffer) => {
      const upstream = connect({...engine, allowHalfOpen: true}, () => {
        upstream.write(requestHead(incoming));
        upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      for (const stream of [client, upstream]) {
        streams.add(stream);
        stream.once('close', () => {
          streams.delete(stream);
        });
      }
      upstream.on('error', () => {
        client.destroy();
      });
      client.on('error', () => {
        upstream.destroy();
      });
    },
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    address: `tcp://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>(resolve => {
        for (const stream of streams) {
          stream.destroy();
        }
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/**
 * Starts the stand-in its command line asks for (`--engine tcp://<address>:<port> --address-file <file>`), writes its
 * address to the file, and says where it stands; its lines go to `report`.
 */
export async function standInFromCommandLine(
  commandLine: readonly string[],
  report: (line: string) => void,
): Promise<StandIn> {
  const engine = new URL(
    String(commandLine[commandLine.indexOf('--engine') + 1]),
  );
  const addressFile = String(
    commandLine[commandLine.indexOf('--address-file') + 1],
  );
  const standIn = await startStandIn(
    {host: engine.hostname, port: Number(engine.port)},
    {report, longPathOf: longPath},
  );
  writeFileSync(addressFile, standIn.address);
  report(`engine-stand-in: ${standIn.address} in front of ${engine.href}`);
  return standIn;
}

if (isMainModule(import.meta.url)) {
  await standInFromCommandLine(
    process.argv.slice(2),
    console.log.bind(console),
  );
}
