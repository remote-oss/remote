/**
 * @fileoverview The askpass program that `ssh` runs to ask for a password, a passphrase or a confirmation: it hands the
 * question to the helper's askpass endpoint and prints the answer on standard output. It loads nothing of the editor.
 */

import {nodeEndpointPort} from 'lib-helper';
import {runAskpassProgram} from 'lib-ssh';

runAskpassProgram({
  programArguments: process.argv.slice(2),
  environment: process.env,
  port: nodeEndpointPort(),
  output: text => process.stdout.write(text),
})
  .then(status => {
    process.exitCode = status;
  })
  .catch(() => {
    // A program that cannot run refuses the question, which ssh takes as a cancelled prompt.
    process.exitCode = 1;
  });
