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
}

/** How many of the connection log's last lines the explanation keeps. */
const LOG_LINES = 60;

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
    section('the read of the window’s page before the outage', () =>
      reads.pageRead(),
    ),
    await settledSection(
      'the pages now (focus, visibility, quick input)',
      async () => (await reads.pageFacts()).join('\n'),
    ),
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
