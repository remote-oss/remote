/**
 * @fileoverview The editor adapters of the acceptance harness: they answer the connect's questions from a script the
 * test wrote and record every question. Without the harness's switch the extension uses the real adapters; this is
 * the only file that reads it. The script is read at every question, so a test may append entries at any time and
 * they count from the next question on; a window's cursor is the count of its answered record lines, so a reload
 * continues where the window left off; and an entry that names a signal waits for the run's signal file before it
 * answers, so one window may hold a question while another works.
 */

import path from 'node:path';
import type {ProgressPort, ResolverEditor} from 'lib-authority';
import {
  fileChoiceLabelOf,
  fileChoiceTextOf,
  type FileChoice,
} from '../config/file-choice.ts';
import {labelOf} from '../connect/connect-editor.ts';
import type {PickerItem, PickerModel} from '../connect/picker-model.ts';
import type {EditorAdapters} from '../editor-surfaces.ts';
import type {ChannelPort} from '../log-channel.ts';
import {textOfId} from './failure-strings.ts';
import type {FailureStringId} from './failure-strings.ts';
import type {MitigationAction} from './mitigation-picker.ts';
import {ownText} from './own-strings.ts';

/** The variables the one place reads. */
const SWITCH = 'REMOTE_OSS_ACCEPTANCE';
const SCRIPT = 'REMOTE_OSS_ACCEPTANCE_SCRIPT';
const RECORD = 'REMOTE_OSS_ACCEPTANCE_RECORD';
const LOG_FILE_VARIABLE = 'REMOTE_OSS_ACCEPTANCE_LOG';

/** The variable the run passes to every launch: the folder this launch's windows write their pid files to. */
const WINDOWS_VARIABLE = 'REMOTE_OSS_ACCEPTANCE_WINDOWS';

/** How often the adapters look for the window's pid file, in milliseconds. */
const PID_POLL_MILLISECONDS = 50;

/** How long the adapters wait for the window's pid file, in milliseconds. */
const PID_WAIT_MILLISECONDS = 10_000;
const SIGNALS = 'REMOTE_OSS_ACCEPTANCE_SIGNALS';

/** The poll of a held entry for its signal file, in milliseconds. */
const SIGNAL_POLL_MILLISECONDS = 100;

/** The shape of a signal name: letters, digits and hyphens. */
const SIGNAL_NAME = /^[A-Za-z0-9-]+$/;

/**
 * One expected question and its answer, in the order the test expects them. An entry with a `window` is answered
 * only by the window of that name; one without is answered once by each window. An entry with an `after` is a held
 * one: it answers only after the run's signal file of that name exists, and a question that ends while it waits is
 * recorded withdrawn.
 */
export type ScriptEntry = (
  | {surface: 'pick'; match: string; answer: 'yes' | 'no' | 'dismiss'}
  | {surface: 'maskedInput'; match: string; answer: {text: string} | 'dismiss'}
  | {surface: 'textInput'; match: string; answer: {text: string} | 'dismiss'}
  | {
      surface: 'platformPick';
      match: string;
      answer: 'linux' | 'windows' | 'macOS' | 'dismiss';
    }
  | {
      surface: 'hostPick';
      match: string;
      answer: {label: string} | {typed: string} | 'dismiss';
    }
  | {surface: 'filePick'; match: string; answer: {label: string} | 'dismiss'}
  | {
      surface: 'failureDialog';
      match: string;
      answer: {button: string} | 'dismiss';
    }
  | {surface: 'notice'; match: string; answer: {button: string} | 'dismiss'}
  | {
      surface: 'mitigationPick';
      match: string;
      answer: MitigationAction | 'dismiss';
    }
  | {surface: 'licenceModal'; match: string; answer: 'decline' | 'dismiss'}
) & {window?: string; after?: string};

/** One line of the record: the question as asked, and what the adapter answered. */
export interface RecordLine {
  /** A question's surface, or `progress` or `downloadProgress` for a display-only line. */
  surface: ScriptEntry['surface'] | 'progress' | 'downloadProgress';
  /** The question's text: a pick's title (or its placeholder when it has none), a masked input's placeholder, a text input's prompt (or its placeholder), a dialog's or a notice's message. */
  question: string;
  /** The answer given: the entry's answer, `'dismiss'` on fail-closed, a text input's text as typed, `'<supplied>'` for a masked input's text, `'held'` on a held entry's waiting line, and `'withdrawn'` when the question ended while it waited. */
  answer: string;
  /** Whether a script entry matched (false: failed closed). */
  matched: boolean;
  /** The line of a held entry while it waits for its signal: the answer or withdrawal line that follows it counts for the cursor, not this one. */
  held?: boolean;
  /** Whether the progress message carried the details link; only the phase lines of a `progress` surface have it. */
  details?: boolean;
  /** The name of the window that wrote the line. */
  window: string;
  /** The time of the line's append. */
  time: number;
  /** The labels the failure dialog or the notice was shown with, in order; only the lines of those surfaces have it. */
  buttons?: string[];
  /** The labels of the rows the pick was shown with, in order; only the lines of a `mitigationPick`, a `platformPick`, a `hostPick` or a `filePick` surface have it. */
  items?: string[];
  /** The label of the row that was focused when the pick opened; only the lines of a `platformPick` have it. */
  active?: string | undefined;
  /** The detail text the licence modal was shown with; only the lines of a `licenceModal` surface have it. */
  detail?: string;
}

/**
 * The surfaces a script entry has, and the only ones a record line can count for a window's cursor: a display-only
 * line never moves one. The check names `ScriptEntry`'s surfaces exactly, so a surface the set misses — or a
 * surface it names that no entry has — is a compile error, and a new surface cannot silently move every cursor.
 */
const SCRIPT_SURFACES = {
  pick: true,
  maskedInput: true,
  textInput: true,
  platformPick: true,
  hostPick: true,
  filePick: true,
  failureDialog: true,
  notice: true,
  mitigationPick: true,
  licenceModal: true,
} satisfies Record<ScriptEntry['surface'], boolean>;

/** Whether the surface has a script entry, and its lines count for the cursor. */
function countedForCursor(surface: RecordLine['surface']): boolean {
  return surface in SCRIPT_SURFACES;
}

/** The name of a window: the last segment of its first workspace folder's path, or `local` for a window without one. */
export function windowNameOf(firstFolderPath: string | undefined): string {
  const segment = firstFolderPath
    ?.split('/')
    .filter(part => part !== '')
    .at(-1);
  return segment ?? 'local';
}

/** Waits the given number of milliseconds. */
export type Sleeper = (milliseconds: number) => Promise<void>;

/** Reads a window's pid file: the name the window's agent wrote to it, or nothing until the file is there. */
export interface PidFiles {
  read(file: string): string | undefined;
}

/**
 * The name a window's agent wrote to its pid file, polled every 50 ms. When the file has not arrived within 10 s,
 * the window is named `unclaimed-<pid>`: a missing file never borrows another window's name, and the record
 * shows the window as unclaimed.
 */
export async function claimedWindowName(
  windowsFolder: string,
  processId: number,
  files: PidFiles,
  wait: Sleeper,
  now: () => number,
): Promise<string> {
  const deadline = now() + PID_WAIT_MILLISECONDS;
  for (;;) {
    const name = files.read(path.join(windowsFolder, String(processId)));
    if (name !== undefined) {
      return name;
    }
    if (now() >= deadline) {
      return `unclaimed-${String(processId)}`;
    }
    await wait(PID_POLL_MILLISECONDS);
  }
}

/**
 * The name the harness gives this window: what the window's agent claimed, from its pid file, when the launch names
 * the pid folder; the window's folder name as before when it does not.
 */
export async function windowNameFor(
  environment: Readonly<Record<string, string | undefined>>,
  processId: number,
  firstFolderPath: string | undefined,
  files: PidFiles,
  wait: Sleeper,
  now: () => number,
): Promise<string> {
  const windowsFolder = namedBy(environment, WINDOWS_VARIABLE);
  return windowsFolder === undefined
    ? windowNameOf(firstFolderPath)
    : claimedWindowName(windowsFolder, processId, files, wait, now);
}

/** The file beside the launch's pid files that holds the authority a window's extension resolves. */
function authorityFileOf(windowsFolder: string, processId: number): string {
  return path.join(windowsFolder, `${String(processId)}.authority`);
}

/**
 * The resolver's editor the harness uses: when the launch names the pid folder, every authority the resolver
 * resolves is handed to `onAuthority`, with the file it belongs to, before the resolve runs; the same editor
 * otherwise.
 */
export function authorityReportingResolverEditorOf(
  environment: Readonly<Record<string, string | undefined>>,
  processId: number,
  editor: ResolverEditor,
  onAuthority: (file: string, authority: string) => void,
): ResolverEditor {
  const windowsFolder = namedBy(environment, WINDOWS_VARIABLE);
  if (windowsFolder === undefined) {
    return editor;
  }
  return {
    ...editor,
    registerRemoteAuthorityResolver: (prefix, resolver) =>
      editor.registerRemoteAuthorityResolver(prefix, {
        ...resolver,
        resolve: (authority, context) => {
          onAuthority(authorityFileOf(windowsFolder, processId), authority);
          return resolver.resolve(authority, context);
        },
      }),
  };
}

/** The files the adapters use: the script is read, the record is appended to, and a held entry's signal file is read. */
export interface AdapterFiles {
  read(file: string): string;
  append(file: string, text: string): void;
}

/** What an answer from an entry is: the value the adapter gives, and the text the record keeps. */
interface Given<Value> {
  value: Value | undefined;
  recorded: string;
}

/** The entries of the script file for the window; a missing or unreadable file, or one with no list, holds none. */
function entriesOf(
  scriptFile: string,
  files: AdapterFiles,
  windowName: string,
): ScriptEntry[] {
  try {
    const parsed = JSON.parse(files.read(scriptFile)) as {
      entries?: ScriptEntry[];
    };
    return Array.isArray(parsed.entries)
      ? parsed.entries.filter(
          entry => entry.window === undefined || entry.window === windowName,
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * A window's cursor: the count of its record lines that are answered entries. A held line does not count — the
 * answer or withdrawal line that follows it does — and a line of a display-only surface or of another window never
 * does. A line that does not parse is skipped, so that an in-flight append of another window cannot move the
 * cursor.
 */
function answeredOf(
  files: AdapterFiles,
  recordFile: string,
  windowName: string,
): number {
  let text: string;
  try {
    text = files.read(recordFile);
  } catch {
    return 0;
  }
  let counted = 0;
  for (const line of text.split('\n')) {
    if (line === '') {
      continue;
    }
    let recordLine: RecordLine;
    try {
      recordLine = JSON.parse(line) as RecordLine;
    } catch {
      continue;
    }
    if (
      recordLine.window === windowName &&
      recordLine.matched &&
      recordLine.held !== true &&
      countedForCursor(recordLine.surface)
    ) {
      counted += 1;
    }
  }
  return counted;
}

/**
 * Adapters that answer only from the script. The script is read at every question and the cursor is counted from
 * the record, so entries appended between questions count from the next question on, and a new adapter set for the
 * same window, which is what a reload gives, continues where the record left off. A question the next entry does
 * not match, of any surface, is dismissed and does not use up an entry. A held entry fails closed — recorded
 * unmatched — when the run names no signals folder or the entry names no signal. The licence modal has no answer
 * that accepts.
 */
export function scriptedAdapters(
  scriptFile: string,
  recordFile: string,
  real: Pick<EditorAdapters, 'terminals' | 'downloadProgress'>,
  files: AdapterFiles,
  windowName: string,
  signalsFolder: string | undefined,
  sleep: (milliseconds: number) => Promise<void> = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds)),
): EditorAdapters & {unusedEntries(): number} {
  function record(line: Omit<RecordLine, 'window' | 'time'>): void {
    files.append(
      recordFile,
      `${JSON.stringify({...line, window: windowName, time: Date.now()})}\n`,
    );
  }

  /** Has the signal file been written: the harness creates it, and a read that cannot see it is not there yet. */
  function signalExists(signalFile: string): boolean {
    try {
      files.read(signalFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Waits for a held entry's signal: a poll for its file every 100 ms, ending `signalled` when the file exists and
   * `withdrawn` when the question's cancellation ends first. The wait is bounded only by the run's own end.
   */
  async function untilSignal(
    signalFile: string,
    cancellation: AbortSignal | undefined,
  ): Promise<'signalled' | 'withdrawn'> {
    for (;;) {
      if (cancellation?.aborted) {
        return 'withdrawn';
      }
      if (signalExists(signalFile)) {
        return 'signalled';
      }
      await sleep(SIGNAL_POLL_MILLISECONDS);
    }
  }

  /**
   * Asks the entry the window's cursor points at about a question of `surface`. `answerOf` turns a matching entry
   * into what to give; it gives nothing for an entry that cannot be used here, which fails closed like a question
   * nothing matches. A held entry records its held line, waits for its signal, and then answers as the entry says;
   * a question that ends while it waits is recorded withdrawn and given nothing.
   */
  async function answerFrom<Kind extends ScriptEntry['surface'], Value>(
    surface: Kind,
    question: string,
    answerOf: (
      entry: Extract<ScriptEntry, {surface: Kind}>,
    ) => Given<Value> | undefined,
    cancellation: AbortSignal | undefined,
    shown: Pick<RecordLine, 'buttons' | 'items' | 'detail' | 'active'> = {},
  ): Promise<Value | undefined> {
    const entries = entriesOf(scriptFile, files, windowName);
    const entry = entries[answeredOf(files, recordFile, windowName)];
    if (entry?.surface === surface && question.includes(entry.match)) {
      const given = answerOf(entry as Extract<ScriptEntry, {surface: Kind}>);
      if (given !== undefined) {
        const held = entry.after;
        if (held !== undefined) {
          if (signalsFolder === undefined || !SIGNAL_NAME.test(held)) {
            // A held entry the run cannot signal, or one that names no signal, fails closed: the question is
            // dismissed and the entry waits for a run that can answer it.
            record({
              ...shown,
              surface,
              question,
              answer: 'dismiss',
              matched: false,
            });
            return undefined;
          }
          record({
            ...shown,
            surface,
            question,
            answer: 'held',
            matched: true,
            held: true,
          });
          const outcome = await untilSignal(
            path.join(signalsFolder, held),
            cancellation,
          );
          if (outcome === 'withdrawn') {
            record({
              ...shown,
              surface,
              question,
              answer: 'withdrawn',
              matched: true,
            });
            return undefined;
          }
        }
        record({
          ...shown,
          surface,
          question,
          answer: given.recorded,
          matched: true,
        });
        return given.value;
      }
    }
    record({
      ...shown,
      surface,
      question,
      answer: 'dismiss',
      matched: false,
    });
    return undefined;
  }

  /** The answerer of the three notice kinds: one scripted entry for a message, whatever its kind. */
  function showNotice(
    message: string,
    buttons: readonly string[],
  ): Promise<string | undefined> {
    return answerFrom(
      'notice',
      message,
      entry => {
        if (entry.answer === 'dismiss') {
          return {value: undefined, recorded: 'dismiss'};
        }
        const button = entry.answer.button;
        return buttons.includes(button)
          ? {value: button, recorded: button}
          : undefined;
      },
      undefined,
      {buttons: [...buttons]},
    );
  }

  return {
    prompts: {
      pick: (request, cancellation) =>
        answerFrom(
          'pick',
          request.title ?? request.placeholder,
          entry => ({
            value: entry.answer === 'dismiss' ? undefined : entry.answer,
            recorded: entry.answer,
          }),
          cancellation,
        ),
      maskedInput: (request, cancellation) =>
        answerFrom(
          'maskedInput',
          request.placeholder,
          entry => ({
            value: entry.answer === 'dismiss' ? undefined : entry.answer.text,
            recorded: entry.answer === 'dismiss' ? 'dismiss' : '<supplied>',
          }),
          cancellation,
        ),
      translate: template => template,
    },
    terminals: real.terminals,
    downloadProgress: real.downloadProgress,
    hostPick: {
      pick: (initial: PickerModel, modelOf) =>
        answerFrom(
          'hostPick',
          textOfId(
            initial.placeholder.id as FailureStringId,
            template => template,
            initial.placeholder.values,
          ),
          entry => {
            if (entry.answer === 'dismiss') {
              return {value: undefined, recorded: 'dismiss'};
            }
            if ('label' in entry.answer) {
              const label = entry.answer.label;
              const taken = initial.items.find(
                item => labelOf(item, template => template) === label,
              );
              return taken === undefined
                ? undefined
                : {value: taken, recorded: label};
            }
            // The script takes the typed row of the typed model without modelling the editor's filter of the rows.
            const typed: PickerItem | undefined = modelOf(
              entry.answer.typed,
            ).items.find(item => item.kind === 'typed');
            return typed === undefined
              ? undefined
              : {value: typed, recorded: entry.answer.typed};
          },
          undefined,
          {
            items: initial.items.map(item =>
              labelOf(item, template => template),
            ),
          },
        ),
    },
    filePick: {
      pick: (choice: FileChoice) =>
        answerFrom(
          'filePick',
          fileChoiceTextOf(choice.placeholder, template => template),
          entry => {
            if (entry.answer === 'dismiss') {
              return {value: undefined, recorded: 'dismiss'};
            }
            const label = entry.answer.label;
            const taken = choice.items.find(
              item => fileChoiceLabelOf(item, template => template) === label,
            );
            return taken === undefined
              ? undefined
              : {value: taken, recorded: label};
          },
          undefined,
          {
            items: choice.items.map(item =>
              fileChoiceLabelOf(item, template => template),
            ),
          },
        ),
    },
    failureDialog: {
      showError: (text, buttons) =>
        answerFrom(
          'failureDialog',
          text,
          entry => {
            if (entry.answer === 'dismiss') {
              return {value: undefined, recorded: 'dismiss'};
            }
            const {button} = entry.answer;
            return buttons.includes(button)
              ? {value: button, recorded: button}
              : undefined;
          },
          undefined,
          {buttons: [...buttons]},
        ),
    },
    licenceDialog: {
      showModal: (message, detail, buttons) =>
        answerFrom(
          'licenceModal',
          message,
          entry => ({
            value: entry.answer === 'decline' ? buttons.at(-1) : undefined,
            recorded: entry.answer,
          }),
          undefined,
          {detail},
        ),
    },
    platformPick: {
      pick: (pick, cancellation) =>
        answerFrom(
          'platformPick',
          ownText(pick.placeholder, template => template),
          entry => ({
            value: entry.answer === 'dismiss' ? undefined : entry.answer,
            recorded: entry.answer,
          }),
          cancellation,
          {
            items: pick.items.map(item => item.label),
            active: pick.items.find(item => item.platform === pick.active)
              ?.label,
          },
        ),
    },
    mitigationPick: {
      pick: pick =>
        answerFrom(
          'mitigationPick',
          pick.placeholder,
          entry => ({
            value: entry.answer === 'dismiss' ? undefined : entry.answer,
            recorded: entry.answer,
          }),
          undefined,
          {items: pick.items.map(item => item.label)},
        ),
    },
    textInput: {
      showInputBox: request =>
        answerFrom(
          'textInput',
          request.title ?? request.prompt ?? request.placeholder ?? '',
          entry => ({
            value: entry.answer === 'dismiss' ? undefined : entry.answer.text,
            recorded:
              entry.answer === 'dismiss' ? 'dismiss' : entry.answer.text,
          }),
          undefined,
        ),
    },
    notice: {
      showInformation: showNotice,
      showWarning: showNotice,
      showError: showNotice,
    },
    unusedEntries: () =>
      entriesOf(scriptFile, files, windowName).length -
      answeredOf(files, recordFile, windowName),
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
  windowName: string,
): EditorAdapters {
  const script = environment[SCRIPT];
  const record = environment[RECORD];
  return environment[SWITCH] === '1' &&
    script !== undefined &&
    script !== '' &&
    record !== undefined &&
    record !== ''
    ? scriptedAdapters(
        script,
        record,
        real,
        files,
        windowName,
        namedBy(environment, SIGNALS),
      )
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
 * The progress the extension uses: the real one, whose every title the record also gets, when the harness's switch
 * is on and the record file is named; the real one itself in every other case. The first line is the title the
 * progress starts with, a later one is a phase with its details flag. Nothing is appended when the progress ends.
 */
export function progressFor(
  environment: Readonly<Record<string, string | undefined>>,
  real: ProgressPort,
  files: AdapterFiles,
  windowName: string,
): ProgressPort {
  const recordFile = namedBy(environment, RECORD);
  if (!switchedOn(environment) || recordFile === undefined) {
    return real;
  }
  function shown(question: string, details?: boolean): void {
    const line: Omit<RecordLine, 'time'> = {
      surface: 'progress',
      question,
      answer: 'shown',
      matched: true,
      window: windowName,
      ...(details === undefined ? {} : {details}),
    };
    files.append(
      recordFile ?? '',
      `${JSON.stringify({...line, time: Date.now()})}\n`,
    );
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
 * The channel port the extension opens its log over: the real one, whose every line the named file also gets, when
 * the harness's switch is on and `REMOTE_OSS_ACCEPTANCE_LOG` names a file; the real one itself in every other case.
 * The lines are the ones the logger writes, after its masking of secrets.
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
