/**
 * @fileoverview The record of the calls the explorer makes to the companion, for the acceptance runs: when the
 * environment names a file in `REMOTE_OSS_ACCEPTANCE_COMPANION_CALL_RECORD`, each command the protocol executes is
 * appended to it as one JSON line with its time and its id, never its argument or its answer. Without the
 * variable nothing is recorded, and a record that cannot be written is dropped.
 */

import type {CommandBus} from 'lib-companion';
import {lineWriterOf, type PushRecordPorts} from './push-record.ts';

/** The variable that names the file the record is appended to. */
export const CALL_RECORD_VARIABLE =
  'REMOTE_OSS_ACCEPTANCE_COMPANION_CALL_RECORD';

/** Records the id of one command the protocol executes. */
export type CallRecorder = (commandId: string) => void;

/** The recorder the environment asks for, or none when it names no file. */
export function callRecorderOf(
  environment: Readonly<Record<string, string | undefined>>,
  ports: PushRecordPorts,
): CallRecorder | undefined {
  const write = lineWriterOf(CALL_RECORD_VARIABLE, environment, ports);
  return write === undefined
    ? undefined
    : commandId => {
        write({commandId});
      };
}

/** `base`, with `record` told the id of each command before it is executed; `base` itself without a recorder. */
export function recordedBus(
  base: CommandBus,
  record: CallRecorder | undefined,
): CommandBus {
  return record === undefined
    ? base
    : {
        ...base,
        executeCommand: (commandId, argument) => {
          record(commandId);
          return base.executeCommand(commandId, argument);
        },
      };
}
