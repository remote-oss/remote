/**
 * @fileoverview The shared connection of a window as the product runs it: the helper and the askpass program are the
 * bundles of the `remote-ssh` package, started as processes of their own, and `ssh` is the real client. The window
 * side is lib-ssh's client over lib-helper's node environment.
 */

import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodeClientEnvironment} from 'lib-helper';
import {
  acquireConnection,
  type AcquireConnectionOutcome,
  type ConnectionAcquireRequest,
  type ConnectionClientEnvironment,
  type ConnectionLimits,
  killConnection,
  type RunBase,
  type SshRequest,
} from 'lib-ssh';

const BUNDLES = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'remote-ssh',
  'dist',
);

/** The bundled connection helper: `pnpm build` makes it. */
const HELPER_BUNDLE = path.join(BUNDLES, 'connection-helper.js');

/** The bundled askpass program: `pnpm build` makes it. */
const ASKPASS_BUNDLE = path.join(BUNDLES, 'askpass.js');

/** How long a helper stays after its last window leaves, in milliseconds: long enough to carry a reload. */
const GRACE_MILLISECONDS = 3000;

/** The limits a window puts on the waits of one connection, in milliseconds. */
const LIMITS: ConnectionLimits = {
  requestMilliseconds: 10000,
  loginMilliseconds: 30000,
};

/** A free loopback port: bound and released at once. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        resolve(
          typeof address === 'object' && address !== null ? address.port : 0,
        );
      });
    });
  });
}

/** The connections of the windows of one user on one machine, with the folder their helpers keep their records in. */
export class WindowSide {
  /** The folder the helpers' records and sockets live in. */
  readonly folder: string;
  readonly environment: ConnectionClientEnvironment;

  /** A fresh folder and the client over it. */
  constructor() {
    if (!existsSync(HELPER_BUNDLE) || !existsSync(ASKPASS_BUNDLE)) {
      throw new Error(
        `the bundles of remote-ssh are missing from ${BUNDLES}; run pnpm build`,
      );
    }
    this.folder = mkdtempSync(path.join(tmpdir(), 'window-'));
    this.environment = {
      freePort,
      helper: {
        ...nodeClientEnvironment(process.execPath),
        endpointFolder: this.folder,
      },
    };
  }

  /** The request a window makes for the host `base` names, with the bundles as the helper and the askpass program. */
  request(
    base: RunBase,
    changes: Partial<ConnectionAcquireRequest> = {},
  ): ConnectionAcquireRequest {
    const request: SshRequest = {...base, purpose: 'connection'};
    return {
      folder: path.join(this.folder, 'registry'),
      hostString: base.target.host,
      script: HELPER_BUNDLE,
      options: {
        request: JSON.stringify(request),
        unboundedWaitSeconds: 60,
        runtimeFolder: this.folder,
        runtime: process.execPath,
        askpassProgram: ASKPASS_BUNDLE,
        displayHost: base.target.host,
        externalAskpass: false,
        askpassFirstMessageMilliseconds: 5000,
      },
      policy: {kind: 'graceAfterLastLease', milliseconds: GRACE_MILLISECONDS},
      cancellation: new AbortController().signal,
      ...changes,
    };
  }

  /** Takes a lease for a window on the helper of the host. */
  acquire(
    base: RunBase,
    changes: Partial<ConnectionAcquireRequest> = {},
  ): Promise<AcquireConnectionOutcome> {
    return acquireConnection(
      this.environment,
      this.request(base, changes),
      LIMITS,
    );
  }

  /** Ends the helper of the host and its `ssh`, as "Kill Local Connection Server" does. */
  kill(hostString: string): Promise<void> {
    return killConnection(
      this.environment,
      path.join(this.folder, 'registry'),
      hostString,
    );
  }

  /** The records of the helpers that run, by their file names. */
  records(): string[] {
    const registry = path.join(this.folder, 'registry');
    return existsSync(registry)
      ? readdirSync(registry, {recursive: true, encoding: 'utf8'}).filter(
          name => name.endsWith('.json'),
        )
      : [];
  }

  /** Removes the folder; call after `kill` of every host. */
  remove(): void {
    rmSync(this.folder, {recursive: true, force: true});
  }
}
