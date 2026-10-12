/**
 * @fileoverview The editor adapters of the acceptance harness: they answer the connect's questions from a script the
 * test wrote and record every question. Without the harness's switch the extension uses the real adapters; this is
 * the only file that reads it.
 */

import type {ProgressPort} from 'lib-authority';
import type {EditorAdapters} from '../editor-surfaces.ts';
import type {ChannelPort} from '../log-channel.ts';
import type {MitigationAction} from './mitigation-picker.ts';
import {ownText} from './own-strings.ts';

/** The variables the one place reads. */
const SWITCH = 'REMOTE_OSS_ACCEPTANCE';
const SCRIPT = 'REMOTE_OSS_ACCEPTANCE_SCRIPT';
const RECORD = 'REMOTE_OSS_ACCEPTANCE_RECORD';
const LOG_FILE_VARIABLE = 'REMOTE_OSS_ACCEPTANCE_LOG';

/** One expected question and its answer, in the order the test expects them. */
export type ScriptEntry =
  | {surface: 'pick'; match: string; answer: 'yes' | 'no' | 'dismiss'}
  | {surface: 'maskedInput'; match: string; answer: {text: string} | 'dismiss'}
  | {
      surface: 'platformPick';
      match: string;
      answer: 'linux' | 'windows' | 'macOS' | 'dismiss';
    }
  | {
      surface: 'failureDialog';
      match: string;
      answer: {button: string} | 'dismiss';
    }
  | {
      surface: 'mitigationPick';
      match: string;
      answer: MitigationAction | 'dismiss';
    }
  | {surface: 'licenceModal'; match: string; answer: 'decline' | 'dismiss'};

/** One line of the record: the question as asked, and what the adapter answered. */
export interface RecordLine {
  /** A question's surface, or `progress` or `downloadProgress` for a display-only line. */
  surface: ScriptEntry['surface'] | 'progress' | 'downloadProgress';
  /** The question's text: a pick's title (or its placeholder when it has none), a masked input's placeholder, a dialog's message. */
  question: string;
  /** The answer given: the entry's answer, `'dismiss'` on fail-closed, and `'<supplied>'` for a masked input's text. */
  answer: string;
  /** Whether a script entry matched (false: failed closed). */
  matched: boolean;
  /** Whether the progress message carried the details link; only the phase lines of a `progress` surface have it. */
  details?: boolean;
}

/** The files the adapters use: the script is read, the record is appended to. */
export interface AdapterFiles {
  read(file: string): string;
  append(file: string, text: string): void;
}

/** What an answer from an entry is: the value the adapter gives, and the text the record keeps. */
interface Given<Value> {
  value: Value | undefined;
  recorded: string;
}

/** The entries of the script file; a missing or unreadable file, or one with no list, holds none. */
function entriesOf(scriptFile: string, files: AdapterFiles): ScriptEntry[] {
  try {
    const parsed = JSON.parse(files.read(scriptFile)) as {
      entries?: ScriptEntry[];
    };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/**
 * Adapters that answer only from the script. A question the next entry does not match, of any surface, is dismissed
 * and does not use up an entry. The licence modal has no answer that accepts.
 */
export function scriptedAdapters(
  scriptFile: string,
  recordFile: string,
  real: Pick<EditorAdapters, 'terminals' | 'downloadProgress'>,
  files: AdapterFiles,
): EditorAdapters & {unusedEntries(): number} {
  const entries = entriesOf(scriptFile, files);
  let cursor = 0;

  function record(line: RecordLine): void {
    files.append(recordFile, `${JSON.stringify(line)}\n`);
  }

  /**
   * Asks the next entry about a question of `surface`. `answerOf` turns a matching entry into what to give; it gives
   * nothing for an entry that cannot be used here, which fails closed like a question nothing matches.
   */
  function answerFrom<Kind extends ScriptEntry['surface'], Value>(
    surface: Kind,
    question: string,
    answerOf: (
      entry: Extract<ScriptEntry, {surface: Kind}>,
    ) => Given<Value> | undefined,
  ): Value | undefined {
    const entry = entries[cursor];
    if (entry?.surface === surface && question.includes(entry.match)) {
      const given = answerOf(entry as Extract<ScriptEntry, {surface: Kind}>);
      if (given !== undefined) {
        cursor += 1;
        record({surface, question, answer: given.recorded, matched: true});
        return given.value;
      }
    }
    record({surface, question, answer: 'dismiss', matched: false});
    return undefined;
  }

  return {
    prompts: {
      pick: request =>
        Promise.resolve(
          answerFrom('pick', request.title ?? request.placeholder, entry => ({
            value: entry.answer === 'dismiss' ? undefined : entry.answer,
            recorded: entry.answer,
          })),
        ),
      maskedInput: request =>
        Promise.resolve(
          answerFrom('maskedInput', request.placeholder, entry => ({
            value: entry.answer === 'dismiss' ? undefined : entry.answer.text,
            recorded: entry.answer === 'dismiss' ? 'dismiss' : '<supplied>',
          })),
        ),
      translate: template => template,
    },
    terminals: real.terminals,
    downloadProgress: real.downloadProgress,
    failureDialog: {
      showError: (text, buttons) =>
        Promise.resolve(
          answerFrom('failureDialog', text, entry => {
            if (entry.answer === 'dismiss') {
              return {value: undefined, recorded: 'dismiss'};
            }
            const {button} = entry.answer;
            return buttons.includes(button)
              ? {value: button, recorded: button}
              : undefined;
          }),
        ),
    },
    licenceDialog: {
      showModal: (message, detail, buttons) =>
        Promise.resolve(
          answerFrom('licenceModal', message, entry => ({
            value: entry.answer === 'decline' ? buttons.at(-1) : undefined,
            recorded: entry.answer,
          })),
        ),
    },
    platformPick: {
      pick: pick =>
        Promise.resolve(
          answerFrom(
            'platformPick',
            ownText(pick.placeholder, template => template),
            entry => ({
              value: entry.answer === 'dismiss' ? undefined : entry.answer,
              recorded: entry.answer,
            }),
          ),
        ),
    },
    mitigationPick: {
      pick: pick =>
        Promise.resolve(
          answerFrom('mitigationPick', pick.placeholder, entry => ({
            value: entry.answer === 'dismiss' ? undefined : entry.answer,
            recorded: entry.answer,
          })),
        ),
    },
    unusedEntries: () => entries.length - cursor,
  };
}

/**
 * The adapters the extension uses: the scripted ones when the harness's switch is on and it names both files, and
 * the real ones in every other case, so that the switch alone never answers anything.
 */
export function adaptersFor(
  environment: Readonly<Record<string, string | undefined>>,
  real: EditorAdapters,
  files: AdapterFiles,
): EditorAdapters {
  const script = environment[SCRIPT];
  const record = environment[RECORD];
  return environment[SWITCH] === '1' &&
    script !== undefined &&
    script !== '' &&
    record !== undefined &&
    record !== ''
    ? scriptedAdapters(script, record, real, files)
    : real;
}

/** Whether the harness's switch is on, which every adapter needs before it does anything. */
function switchedOn(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment[SWITCH] === '1';
}

/** The value of a variable when it is a non-empty text. */
function namedBy(
  environment: Readonly<Record<string, string | undefined>>,
  variable: string,
): string | undefined {
  const value = environment[variable];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * The progress the extension uses: the real one, whose every title the record also gets, when the harness's switch is
 * on and the record file is named; the real one itself in every other case. The first line is the title the progress
 * starts with, a later one is a phase with its details flag. Nothing is appended when the progress ends.
 */
export function progressFor(
  environment: Readonly<Record<string, string | undefined>>,
  real: ProgressPort,
  files: AdapterFiles,
): ProgressPort {
  const recordFile = namedBy(environment, RECORD);
  if (!switchedOn(environment) || recordFile === undefined) {
    return real;
  }
  function shown(question: string, details?: boolean): void {
    const line: RecordLine = {
      surface: 'progress',
      question,
      answer: 'shown',
      matched: true,
      ...(details === undefined ? {} : {details}),
    };
    files.append(recordFile ?? '', `${JSON.stringify(line)}\n`);
  }
  return {
    withProgress: (request, task) => {
      shown(request.title);
      return real.withProgress(request, update =>
        task((title, details) => {
          shown(title, details);
          update(title, details);
        }),
      );
    },
  };
}

/**
 * The channel port the extension opens its log over: the real one, whose every line the named file also gets, when the
 * harness's switch is on and `REMOTE_OSS_ACCEPTANCE_LOG` names a file; the real one itself in every other case. The
 * lines are the ones the logger writes, after its masking of secrets.
 */
export function channelPortFor(
  environment: Readonly<Record<string, string | undefined>>,
  real: ChannelPort,
  files: AdapterFiles,
): ChannelPort {
  const logFile = namedBy(environment, LOG_FILE_VARIABLE);
  if (!switchedOn(environment) || logFile === undefined) {
    return real;
  }
  return {
    createOutputChannel: name => {
      const channel = real.createOutputChannel(name);
      return {
        appendLine: text => {
          files.append(logFile, `${text}\n`);
          channel.appendLine(text);
        },
        show: preserveFocus => {
          channel.show(preserveFocus);
        },
        dispose: () => {
          channel.dispose();
        },
      };
    },
  };
}
