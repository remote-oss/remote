/**
 * @fileoverview Starts the agent: runs the command its arguments ask for and ends with that command's exit status.
 */

import {hostname, homedir} from 'node:os';
import {agentHandlers} from './agent.ts';
import {runCommand} from './commands.ts';
import {readConfig} from './config.ts';
import {relayOf} from './sdk.ts';
import {stateFolderOf} from './state.ts';

const folder = stateFolderOf(homedir());
const stopping = new AbortController();
process.once('SIGINT', () => {
  stopping.abort();
});
process.once('SIGTERM', () => {
  stopping.abort();
});

const handlers = agentHandlers({
  folder,
  hostName: hostname(),
  domain: () => readConfig(new URL('.', import.meta.url)).domain,
  connect: (domain, token) =>
    // The control server takes these streams when it is wired; until then a connection to it is closed.
    relayOf(domain, token, folder, stream => stream.destroy()),
  stop: stopping.signal,
  report: line => process.stderr.write(`${line}\n`),
});

process.exitCode = await runCommand(
  process.argv.slice(2),
  {
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
  },
  handlers,
);
