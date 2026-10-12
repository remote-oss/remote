/**
 * @fileoverview The machine a connect runs on, over Node: its processes, files, loopback ports, timers and the
 * download, and the folders and bundles the extension names. The editor side is not here; the extension passes the
 * folders it owns and the editor's `fetch`.
 */

import {randomBytes} from 'node:crypto';
import {type AddressInfo, createServer} from 'node:net';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {nodeLocalPort, nodePortProber} from 'lib-forwarding';
import {nodeClientEnvironment, nodeTimer, runtimeFolder} from 'lib-helper';
import type {ProductProfile} from 'lib-product';
import {downloadPortOf, type HttpGet, nodeClientFiles} from 'lib-server';
import {type ClientPlatform, nodeLocalFiles, nodeProcessSpawner} from 'lib-ssh';
import {HELPER_CLIENT_WAITS} from './pipeline/bounds.ts';
import type {ConnectMachine} from './connect-ports.ts';

/** What the extension knows of its own place: its folder, its storage, the editor's runtime and product. */
export interface MachinePlaces {
  /** The extension's own folder, which holds the bundled programs under `dist`. */
  extensionFolder: string;
  /** The extension's global storage folder of this profile. */
  storageFolder: string;
  /** The editor's executable, which runs the bundled programs as Node. */
  runtime: string;
  profile: ProductProfile;
  /** The editor's `fetch`, which follows its proxy settings. */
  httpGet: HttpGet;
}

/** What the machine reads of Node itself. */
export interface MachineFacts {
  /** `process.platform`. */
  platform: string;
  /** `process.env`. */
  environment: Readonly<Record<string, string | undefined>>;
  homeFolder: string;
  temporaryFolder: string;
}

/** The client platform of a Node platform: Linux for every one that is neither macOS nor Windows. */
export function clientPlatformOf(platform: string): ClientPlatform {
  if (platform === 'darwin') {
    return 'macOS';
  }
  return platform === 'win32' ? 'windows' : 'linux';
}

/** The places the client search reads from the environment. */
export function clientSearchOf(
  environment: Readonly<Record<string, string | undefined>>,
): {searchPath: string; programFilesFolder: string} {
  return {
    searchPath: environment.PATH ?? environment.Path ?? '',
    programFilesFolder: environment.ProgramFiles ?? '',
  };
}

/** A free loopback port, bound and released at once: the helper's SOCKS port, which the helper binds itself. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      // A TCP listener's address is always an address object, never a pipe name.
      const {port} = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** A token no other window or transfer shares: the process and a random part. */
export function newTemporaryToken(): string {
  return `${String(process.pid)}-${randomBytes(6).toString('hex')}`;
}

/** The machine over Node, from the extension's `places` and Node's `facts`. */
export function nodeMachineOf(
  places: MachinePlaces,
  facts: MachineFacts,
): ConnectMachine {
  const bundles = path.join(places.extensionFolder, 'dist');
  return {
    profile: places.profile,
    platform: clientPlatformOf(facts.platform),
    homeFolder: facts.homeFolder,
    processEnvironment: facts.environment,
    clientSearch: clientSearchOf(facts.environment),
    spawner: nodeProcessSpawner,
    helpers: nodeClientEnvironment(places.runtime, HELPER_CLIENT_WAITS),
    freeSocksPort: freeLoopbackPort,
    bundles: {
      helperScript: path.join(bundles, 'connection-helper.js'),
      askpassProgram: path.join(bundles, 'askpass.js'),
      runtime: places.runtime,
    },
    folders: {
      registry: path.join(places.storageFolder, 'registry'),
      runtime: runtimeFolder(
        facts.platform,
        facts.environment,
        facts.temporaryFolder,
      ),
      clientTemporary: facts.temporaryFolder,
    },
    files: nodeLocalFiles,
    clientFiles: nodeClientFiles,
    download: downloadPortOf(places.httpGet),
    scheduler: {setTimer: nodeTimer},
    clock: {
      now: Date.now,
      wait: milliseconds =>
        new Promise(resolve => {
          setTimeout(resolve, milliseconds);
        }),
    },
    local: nodeLocalPort(),
    prober: nodePortProber(),
    newTemporaryToken,
  };
}

/** Node's facts for this process. */
export function nodeFacts(): MachineFacts {
  return {
    platform: process.platform,
    environment: process.env,
    homeFolder: homedir(),
    temporaryFolder: tmpdir(),
  };
}
