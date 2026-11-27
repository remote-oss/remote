/**
 * @fileoverview Starts the agent: runs the command its arguments ask for and ends with that command's exit status.
 */

import {hostname, homedir} from 'node:os';
import manifest from '../package.json' with {type: 'json'};
import {agentHandlers} from './agent.ts';
import {runCommand} from './commands.ts';
import {readConfig} from './config.ts';
import {serveControl} from './control/session.ts';
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
  connect: (domain, token) => {
    const relay = relayOf(domain, token, folder, (stream, tunnel) => {
      void serveControl(stream, {
        version: manifest.version,
        editors: {
          serve: () =>
            Promise.reject(
              new Error('The editor server is not built into this agent yet.'),
            ),
        },
        tunnel: relay.portsOf(tunnel),
        logLine: line => process.stderr.write(`${line}\n`),
      });
    });
    return relay;
  },
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
