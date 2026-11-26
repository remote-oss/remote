/**
 * @fileoverview Starts the agent: runs the command its arguments ask for and ends with that command's exit status.
 */

import {runCommand} from './commands.ts';

process.exitCode = runCommand(process.argv.slice(2), {
  stdout: text => process.stdout.write(text),
  stderr: text => process.stderr.write(text),
});
