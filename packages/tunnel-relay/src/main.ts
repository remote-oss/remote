/**
 * @fileoverview Starts the relay: its settings from the environment, its store, and its HTTPS service.
 */

import {readFileSync, statSync} from 'node:fs';
import {Allowlist} from './auth/allowlist.ts';
import {authenticateWith} from './auth/authenticate.ts';
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

const config = configOf(process.env);
const store = new Store(config.storeFile);
const tokens = new Tokens(readFileSync(config.tokenKeyFile), Date.now);
const authenticate = authenticateWith({
  github: new GithubIdentity(config.githubApi, fetch, Date.now),
  allowlist: new Allowlist({
    modified: () => statSync(config.allowlistFile).mtimeMs,
    text: () => readFileSync(config.allowlistFile, 'utf8'),
  }),
  tokens,
  tunnels: store,
  report: reportFailure,
});
const server = relayServer(
  {
    store,
    config,
    authenticate,
    tokens,
    legs: new Legs(authenticate),
    report: reportFailure,
  },
  readFileSync(config.certificateFile),
  readFileSync(config.keyFile),
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
