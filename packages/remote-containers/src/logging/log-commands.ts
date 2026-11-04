/**
 * @fileoverview The two commands that open a log file: the pick of every log file of the profile, and the log of the
 * activation before this one. What each shows is decided here; the editor's pick, document and dialog are ports.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {type LogFile, logChoicesOf, previousLogOf} from './log-files.ts';

/** The English templates of the two commands. */
const LOG_TEMPLATES = {
  S066: 'Choose a log file',
  S239: 'No log files found.',
  S242: 'No previous log file found.',
} as const;

/** What the commands need of the editor and the disk. */
export interface LogCommandPorts {
  /** The log files of the profile now. */
  files(): Promise<LogFile[]>;
  /** Shows the pick with `placeholder` and gives the place of the row chosen, none when it was dismissed. */
  pick(
    placeholder: string,
    rows: ReadonlyArray<{label: string; description?: string}>,
  ): Promise<number | undefined>;
  /** Opens the file as a preview, in the `log` language, not read-only. */
  open(file: string): Promise<void>;
  /** Shows a modal dialog with this detail and one OK button. */
  tell(detail: string): Promise<void>;
  /** The start of this activation, as its log file names hold it. */
  currentStart: string;
  translate: Translate;
}

/** `Show All Logs...`: the pick of every log file, newest first; with none, one row that opens nothing. */
export function openLogFileOf(ports: LogCommandPorts): () => Promise<void> {
  return async () => {
    const choices = logChoicesOf(await ports.files());
    const placeholder = ports.translate(LOG_TEMPLATES.S066);
    if (choices.length === 0) {
      await ports.pick(placeholder, [
        {label: ports.translate(LOG_TEMPLATES.S239)},
      ]);
      return;
    }
    const chosen = await ports.pick(
      placeholder,
      choices.map(({label, description}) => ({label, description})),
    );
    const file = chosen === undefined ? undefined : choices[chosen]?.file;
    if (file !== undefined) {
      await ports.open(file);
    }
  };
}

/** `Show Previous Log`: the log of the activation before this one, or the dialog that there is none. */
export function openLastLogFileOf(ports: LogCommandPorts): () => Promise<void> {
  return async () => {
    const previous = previousLogOf(await ports.files(), ports.currentStart);
    if (previous === undefined) {
      await ports.tell(ports.translate(LOG_TEMPLATES.S242));
    } else {
      await ports.open(previous.file);
    }
  };
}
