/**
 * @fileoverview Starts the relay: its settings from the environment, its store, and its HTTPS service.
 */

import {readFileSync, statSync, watchFile} from 'node:fs';
import {Allowlist} from './auth/allowlist.ts';
import {authenticateWith} from './auth/authenticate.ts';
import {LookupLimit} from './auth/lookups.ts';
import {GithubIdentity} from './auth/github.ts';
import {Tokens} from './auth/tokens.ts';
import {configOf} from './config.ts';
import {Legs} from './legs/legs.ts';
import {relayServer} from './server.ts';
import {Store} from './store.ts';

/** Writes a failure the relay's answers don't carry to its standard error. */
function reportFailure(failure: unknown): void {
  process.stderr.write(`the relay failed: ${String(failure)}\n`);
}

/** How often the relay looks at the allowlist file for a change, in milliseconds. */
const ALLOWLIST_CHECK_MILLISECONDS = 5000;

const config = configOf(process.env);
const store = new Store(config.storeFile);
const tokens = new Tokens(readFileSync(config.tokenKeyFile), Date.now);
const allowlist = new Allowlist(
  {
    modified: () => statSync(config.allowlistFile).mtimeMs,
    text: () => readFileSync(config.allowlistFile, 'utf8'),
  },
  {
    onRead: () => {
      legs.closeUnadmitted(owner => allowlist.admits(owner));
    },
    report: reportFailure,
  },
);
const authenticate = authenticateWith({
  github: new GithubIdentity(config.githubApi, fetch, Date.now),
  lookups: new LookupLimit(Date.now),
  allowlist,
  tokens,
  tunnels: store,
  report: reportFailure,
});
const legs = new Legs(authenticate, reportFailure, config.limits.clients);
try {
  allowlist.load();
} catch (failure) {
  process.stderr.write(
    `the relay cannot start: the allowlist ${config.allowlistFile}: ${String(failure)}\n`,
  );
  process.exit(1);
}
const server = relayServer(
  {
    store,
    config,
    authenticate,
    tokens,
    legs,
    report: reportFailure,
  },
  readFileSync(config.certificateFile),
  readFileSync(config.keyFile),
);
watchFile(
  config.allowlistFile,
  {interval: ALLOWLIST_CHECK_MILLISECONDS, persistent: false},
  () => {
    allowlist.refresh();
  },
);
server.listen(config.port, () => {
  process.stdout.write(
    `the relay serves cp.${config.domain} on port ${String(config.port)}\n`,
  );
});
process.once('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => {
    store.close();
  });
});
