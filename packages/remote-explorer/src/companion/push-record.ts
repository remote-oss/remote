/**
 * @fileoverview The record of the pushes the inbox receives, for the acceptance runs: when the environment names a
 * file in `REMOTE_OSS_ACCEPTANCE_COMPANION_RECORD`, each push the inbox reads is appended to it as one JSON line before
 * its handler runs. Without the variable nothing is recorded.
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

/** The recorder the environment asks for, or none when it names no file. */
export function recorderOf(
  environment: Readonly<Record<string, string | undefined>>,
  ports: PushRecordPorts,
): PushRecorder | undefined {
  const file = environment[COMPANION_RECORD_VARIABLE];
  if (file === undefined || file === '') {
    return undefined;
  }
  return (commandId, envelope) => {
    ports.append(
      file,
      `${JSON.stringify({time: ports.now(), commandId, envelope})}\n`,
    );
  };
}
