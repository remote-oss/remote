/**
 * @fileoverview Starts the agent: runs the command its arguments ask for and ends with that command's exit status.
 */

import {userInfo} from 'node:os';
import path from 'node:path';
import {runCommand} from './commands.ts';
import {runProgram} from './process-runner.ts';

process.exitCode = await runCommand(
  process.argv.slice(2),
  {
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
  },
  {
    runner: runProgram,
    home: userInfo().homedir,
    ...(process.env.XDG_CONFIG_HOME === undefined
      ? {}
      : {configHome: process.env.XDG_CONFIG_HOME}),
    user: userInfo().username,
    launcher: path.resolve(process.argv[1] ?? ''),
  },
);
