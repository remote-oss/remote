/**
 * @fileoverview Starts the agent: runs the command its arguments ask for and ends with that command's exit status.
 */

import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {runCommand} from './commands.ts';
import {readConfig} from './config.ts';
import {signIn} from './sign-in.ts';
import {stateFolderOf} from './state.ts';

/** The first line of the standard input, or undefined when it ends before one. */
async function firstLineOfInput(): Promise<string | undefined> {
  const lines = createInterface({input: process.stdin});
  for await (const line of lines) {
    lines.close();
    return line;
  }
  return undefined;
}

process.exitCode = await runCommand(
  process.argv.slice(2),
  {
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
  },
  {
    login: fromStandardInput => {
      const home = process.env.HOME;
      if (home === undefined || home === '') {
        process.stderr.write('tunnel-agent login: HOME is not set\n');
        return Promise.resolve(1);
      }
      return signIn(
        {
          fetch,
          sleep: milliseconds => sleep(milliseconds),
          now: Date.now,
          readLine: firstLineOfInput,
          print: line => process.stdout.write(`${line}\n`),
          complain: line => process.stderr.write(`${line}\n`),
          stateFolder: stateFolderOf(home),
          clientId: readConfig(new URL('.', import.meta.url)).githubClientId,
        },
        fromStandardInput,
      );
    },
  },
);
