/**
 * @fileoverview The runtime commands: ids that other software, key bindings and the walkthrough call, which no menu or
 * palette shows.
 */

import {runtimeCommands} from '../identifiers.generated.ts';

/** Every runtime command id the activation registers. */
export const RUNTIME_COMMAND_IDS: readonly string[] = [
  runtimeCommands.newWindow,
  runtimeCommands.newWindowForDistro,
  runtimeCommands.connectToWSLDefault,
];
