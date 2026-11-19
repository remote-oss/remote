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

/** `milliseconds` as seconds with a sign, to one decimal. */
function signedSeconds(milliseconds: number): string {
  return `${milliseconds < 0 ? '-' : '+'}${(Math.abs(milliseconds) / 1000).toFixed(1)} s`;
}

/**
 * What a window's page and extension host did, in a few lines that a run prints green or red alike so that the two
 * compare: the read of the page before the outage, what each page says of its focus and visibility, when the agent
 * activated or deactivated relative to the end, and the lines of the renderer log about the reconnection.
 */
export async function reconnectionGlance(
  reads: StateReads,
  endedAt: number,
): Promise<string> {
  return [
    section('the read of the window’s page before the outage', () =>
      reads.pageRead(),
    ),
    await settledSection(
      'the pages now (focus, visibility, quick input)',
      async () => (await reads.pageFacts()).join('\n'),
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
    section('the last lines of the connection log since then', () =>
      reads
        .logLines()
        .slice(mark)
        .filter(line => !line.startsWith('Searched for ssh in:'))
        .slice(-LOG_LINES)
        .join('\n'),
    ),
  ].join('\n');
}
