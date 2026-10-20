/**
 * @fileoverview A program: stops the helpers recorded under each user-data folder its arguments name, and exits 1
 * with the reason when it can't.
 *
 *     node tests/acceptance/server/stop-helpers.ts <user-data folder>...
 */

import {stopHelpersUnder} from './helper-stop.ts';

try {
  for (const userDataFolder of process.argv.slice(2)) {
    await stopHelpersUnder(userDataFolder);
  }
} catch (error) {
  console.error(
    `stop-helpers: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
