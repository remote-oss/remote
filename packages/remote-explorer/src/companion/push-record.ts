/**
 * @fileoverview The record of the pushes the inbox receives, for the acceptance runs: when the environment names a
 * file in `REMOTE_OSS_ACCEPTANCE_COMPANION_RECORD`, each push the inbox reads is appended to it as one JSON line before
 * its handler runs. Without the variable nothing is recorded, and a record that cannot be written is dropped.
 */

/** The variable that names the file the record is appended to. */
export const COMPANION_RECORD_VARIABLE =
  'REMOTE_OSS_ACCEPTANCE_COMPANION_RECORD';

/** Records one push the inbox received and read: the command's id and the envelope as read. */
export type PushRecorder = (commandId: string, envelope: unknown) => void;

/** What the recorder needs of its host: a line appended to a file, and the clock. */
export interface PushRecordPorts {
  append(file: string, line: string): void;
  now(): number;
}

/** The writer of the acceptance record that the variable `variable` names: one JSON line with the time and `fields`; none without a file. */
export function lineWriterOf(
  variable: string,
  environment: Readonly<Record<string, string | undefined>>,
  ports: PushRecordPorts,
): ((fields: Readonly<Record<string, unknown>>) => void) | undefined {
  const file = environment[variable];
  if (file === undefined || file === '') {
    return undefined;
  }
  return fields => {
    try {
      ports.append(file, `${JSON.stringify({time: ports.now(), ...fields})}\n`);
    } catch {
      // The record is for the acceptance runs: a file that cannot be written must never stop what it records.
    }
  };
}

/** The recorder the environment asks for, or none when it names no file. */
export function recorderOf(
  environment: Readonly<Record<string, string | undefined>>,
  ports: PushRecordPorts,
): PushRecorder | undefined {
  const write = lineWriterOf(COMPANION_RECORD_VARIABLE, environment, ports);
  return write && ((commandId, envelope) => write({commandId, envelope}));
}
