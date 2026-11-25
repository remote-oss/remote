/**
 * @fileoverview Starts the relay: its settings from the environment, its store, and its HTTPS service.
 */

import {readFileSync} from 'node:fs';
import {configOf} from './config.ts';
import {refuseAll} from './refuse-all.ts';
import {relayServer} from './server.ts';
import {Store} from './store.ts';

const config = configOf(process.env);
const store = new Store(config.storeFile);
const server = relayServer(
  {
    store,
    config,
    authenticate: refuseAll,
    report: error => {
      process.stderr.write(`the relay failed: ${String(error)}\n`);
    },
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
  server.close(() => {
    store.close();
  });
});
