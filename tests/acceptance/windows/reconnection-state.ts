/**
 * @fileoverview What a window showed and the launch logged since its shared connection ended, as the explanation of a
 * wait for core's dialog that timed out. Each read is its own section, so one that fails is told in its place.
 */

import {section, settledSection} from './connect-failure.ts';

/** A line of what a window recorded: the surface it came from, its question and its answer, and when. */
interface RecordedLine {
  time: number;
  surface: string;
  question: string;
  answer: string;
}

/** What a window and the launch can be asked, each read apart from the others. */
export interface StateReads {
  recorded(): RecordedLine[];
  indicator(): Promise<string>;
  dialog(): Promise<{message: string; details: string} | undefined>;
  notifications(): Promise<string[]>;
  logLines(): string[];
  /** What each page of the editor says of its focus and visibility, and its quick input. */
  pageFacts(): Promise<string[]>;
  /** What the row read of the window's page before the outage: when, and how long it took. */
  pageRead(): string;
  /** When the window's agent activated and deactivated, which an extension host that started again shows. */
  agentLife(): Array<{event: string; time: number}>;
  /** The lines of the window's own renderer log, where core says what it did with the end of the reconnection. */
  rendererLines(): string[];
  /** What the window's dialog and notifications showed over the time since the end, as the changes between the reads. */
  timeline(): string[];
  /**
   * Asks the window for a dialog of core's that the reconnection's own listener does not open, and tells whether it
   * showed: it shows at once when the window's dialog queue is free, and not when an earlier dialog holds the queue.
   */
  probeDialog(): Promise<string>;
}

/** How many of the connection log's last lines the explanation keeps. */
const LOG_LINES = 60;

/** How many of the agent's last activations and of the renderer log's last matching lines the explanation keeps. */
const LIFE_LINES = 6;
const RENDERER_LINES = 10;

/** The lines of the renderer log that tell what core did with a reconnection and its end. */
const RENDERER_PATTERN =
  /reconnect|Error handled|PermanentFailure|connection (?:lost|gain)/iu;

/** The longest renderer log line the explanation keeps whole. */
const LINE_LENGTH = 240;

/**
 * How long the glance waits for the pages' facts, which each page of the launch answers through the editor's debugging
 * protocol: a page that does not answer must not hold a passing row until its test's own timeout.
 */
const PAGE_FACTS_MILLISECONDS = 10_000;

/** How long the probe of the second dialog may take, the palette and the wait for the dialog included. */
const PROBE_MILLISECONDS = 45_000;

/** What `read` gives, or a line saying it gave nothing within `milliseconds`; a late failure of it is dropped. */
async function withinMilliseconds(
  read: Promise<string>,
  milliseconds: number,
): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const silent = new Promise<string>(resolve => {
    timer = setTimeout(() => {
      resolve(`(no answer in ${String(milliseconds / 1000)} s)`);
    }, milliseconds);
  });
  read.catch(() => undefined);
  try {
    return await Promise.race([read, silent]);
  } finally {
    clearTimeout(timer);
  }
}

/** How long after the end the unfiltered renderer log is kept, and how many of its lines. */
const WINDOW_MILLISECONDS = 30_000;
const WINDOW_LINES = 80;

/**
 * The stamped lines of a log (`2026-11-20 00:03:15.909`, UTC) between `fromMs` and `toMs`, the first `capacity` of them,
 * each cut at `width` characters. The unstamped lines (the frames of a stack) are left out and the first lines are kept,
 * since what the window did right after the end is what the readout is for, and a burst of stacks would otherwise fill
 * the cap and push it out.
 */
export function logLinesBetween(
  lines: readonly string[],
  fromMs: number,
  toMs: number,
  capacity: number,
  width: number,
): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    const stamp = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)/u.exec(line);
    if (stamp === null) {
      continue;
    }
    const time = Date.parse(`${stamp[1] ?? ''}T${stamp[2] ?? ''}Z`);
    if (time >= fromMs && time <= toMs) {
      kept.push(line.slice(0, width));
    }
  }
  return kept.slice(0, capacity);
}

/** The lines of the renderer log that tell core gave a reconnection up, or what it did with the end. */
const FAILURE_PATTERN =
  /permanent failure|Will give up now|Error handled|Cannot reconnect/iu;

/**
 * The lines of a renderer log (`2026-11-20 00:03:15.909`, UTC) before `endedMs` that tell a reconnection was given up,
 * each with its time from the end, or the words that there are none and what the log held: a failure of an earlier
 * connection of the window could have made core keep its dialog back for this one.
 */
export function earlierFailureLines(
  lines: readonly string[],
  endedMs: number,
  width: number,
): string[] {
  const before: Array<{time: number; line: string}> = [];
  for (const line of lines) {
    const stamp = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)/u.exec(line);
    if (stamp === null) {
      continue;
    }
    const time = Date.parse(`${stamp[1] ?? ''}T${stamp[2] ?? ''}Z`);
    if (time < endedMs) {
      before.push({time, line});
    }
  }
  const told = before
    .filter(each => FAILURE_PATTERN.test(each.line))
    .map(
      each =>
        `[${signedSeconds(each.time - endedMs)}] ${each.line.slice(0, width)}`,
    );
  const first = before[0];
  return told.length > 0 || first === undefined
    ? told.length > 0
      ? told
      : ['none (the log holds no stamped line before the end)']
    : [
        `none (the log holds ${String(before.length)} stamped lines before the end, the first ${signedSeconds(first.time - endedMs)} from it)`,
      ];
}

/** `milliseconds` as seconds with a sign, to one decimal. */
function signedSeconds(milliseconds: number): string {
  return `${milliseconds < 0 ? '-' : '+'}${(Math.abs(milliseconds) / 1000).toFixed(1)} s`;
}

/**
 * What a window's page and extension host did, in a few lines that a run prints green or red alike so that the two
 * compare: the read of the page before the outage, what each page says of its focus and visibility, when the agent
 * activated or deactivated relative to the end, and the lines of the renderer log about the reconnection. Reading the
 * pages is bounded by `pageMilliseconds`, so that the glance cannot hold a row that passed.
 */
export async function reconnectionGlance(
  reads: StateReads,
  endedAt: number,
  pageMilliseconds = PAGE_FACTS_MILLISECONDS,
): Promise<string> {
  return [
    section('the read of the window’s page before the outage', () =>
      reads.pageRead(),
    ),
    await settledSection('the pages now (focus, visibility, quick input)', () =>
      withinMilliseconds(
        reads.pageFacts().then(facts => facts.join('\n')),
        pageMilliseconds,
      ),
    ),
    section(
      'the window’s agent, activated or deactivated (time from the end)',
      () =>
        reads
          .agentLife()
          .slice(-LIFE_LINES)
          .map(each => `[${signedSeconds(each.time - endedAt)}] ${each.event}`)
          .join('\n'),
    ),
    section(
      'the lines of the window’s renderer log about the reconnection',
      () =>
        reads
          .rendererLines()
          .filter(line => RENDERER_PATTERN.test(line))
          .slice(-RENDERER_LINES)
          .map(line => line.slice(0, LINE_LENGTH))
          .join('\n'),
    ),
  ].join('\n');
}

/**
 * What window `name` recorded since its shared connection ended at `endedAt` (a time in milliseconds), with the
 * times after the end, what it shows now, and the connection log's last lines after its first `mark`.
 */
export async function reconnectionState(
  reads: StateReads,
  name: string,
  mark: number,
  endedAt: number,
  probeMilliseconds = PROBE_MILLISECONDS,
): Promise<string> {
  return [
    section(`what ${name} recorded since the shared connection ended`, () =>
      reads
        .recorded()
        .filter(line => line.time >= endedAt)
        .map(
          line =>
            `[+${((line.time - endedAt) / 1000).toFixed(1)} s] ${line.surface}: ${line.question} (${line.answer})`,
        )
        .join('\n'),
    ),
    await settledSection('the indicator', () => reads.indicator()),
    await settledSection('the dialog now', async () => {
      const shown = await reads.dialog();
      return shown === undefined
        ? 'none'
        : `${shown.message} / ${shown.details}`;
    }),
    await settledSection('the notifications now', async () =>
      JSON.stringify(await reads.notifications()),
    ),
    await reconnectionGlance(reads, endedAt),
    section(
      'the dialog and notifications of the window, every change between reads taken every 250 ms',
      () => reads.timeline().join('\n'),
    ),
    section(
      'the window’s renderer log from the end to 30 s after it, every line',
      () =>
        logLinesBetween(
          reads.rendererLines(),
          endedAt,
          endedAt + WINDOW_MILLISECONDS,
          WINDOW_LINES,
          LINE_LENGTH,
        ).join('\n'),
    ),
    section('the last lines of the connection log since then', () =>
      reads
        .logLines()
        .slice(mark)
        .filter(line => !line.startsWith('Searched for ssh in:'))
        .slice(-LOG_LINES)
        .join('\n'),
    ),
    section(
      'the window’s renderer log before the end: every line about a reconnection given up, with its time from the end',
      () =>
        earlierFailureLines(reads.rendererLines(), endedAt, LINE_LENGTH).join(
          '\n',
        ),
    ),
    // Last, since it opens a dialog in the window: a dialog of core's that the reconnection listener does not open.
    await settledSection(
      'a second dialog asked of the window by its palette, File: Clear Recently Opened (it shows when the dialog queue is free)',
      () => withinMilliseconds(reads.probeDialog(), probeMilliseconds),
    ),
  ].join('\n');
}
