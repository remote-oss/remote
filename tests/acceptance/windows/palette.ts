import {activeWindowName} from './display.ts';
import {startInWindow, terminalFacts, windowEvents} from './harness.ts';
import {
  chooseQuickPickRow,
  moveQuickPickFocus,
  pageFocusFacts,
  pressEscape,
  quickPickOf,
  typeInQuickPick,
  waitForQuickPick,
} from './renderer.ts';

/** How long the palette's list must read the same, in milliseconds, before it counts as settled. */
const SETTLE_MILLISECONDS = 600;

/** How often the pages' quick input and focus are read while a palette is awaited, in milliseconds. */
const SAMPLE_INTERVAL_MILLISECONDS = 250;

/** How many reads at most, so that the trail of a palette that does not show covers about 3 s. */
const SAMPLE_COUNT = 12;

/**
 * Reads the pages' quick input and focus every `SAMPLE_INTERVAL_MILLISECONDS` after `sent`, into `trail`, until
 * `state.shown` is set or `SAMPLE_COUNT` reads are made, so that a palette that shows and goes can be told from one that
 * never shows. A palette that shows stops it: it costs at most the read in flight.
 */
async function sampleQuickInput(
  sent: number,
  trail: string[],
  state: {shown: boolean},
): Promise<void> {
  for (let reads = 0; reads < SAMPLE_COUNT; reads += 1) {
    await new Promise(resolve =>
      setTimeout(resolve, SAMPLE_INTERVAL_MILLISECONDS),
    );
    if (state.shown) {
      return;
    }
    const facts = await pageFocusFacts().catch((caught: unknown) => [
      String(caught),
    ]);
    trail.push(`@${String(Date.now() - sent)} ${facts.join(' | ')}`);
  }
}

/**
 * Opens the Command Palette of window `name` and waits for its list. When it does not show, the error says what the
 * pages' focus and quick input were and what the window's agent did with the command, so that a palette that has no
 * effect can be told from one that never got the command.
 */
async function showedPalette(name: string): Promise<void> {
  const sent = Date.now();
  const trail: string[] = [];
  const state = {shown: false};
  await startInWindow(name, 'workbench.action.showCommands');
  const sampling = sampleQuickInput(sent, trail, state);
  try {
    await waitForQuickPick(name, 30_000);
    state.shown = true;
  } catch (caught) {
    await sampling;
    // The pages and the events come first: asking for the terminals focuses and clears one, and adds events of its own.
    const pages = await pageFocusFacts().catch((reading: unknown) => [
      `unreadable: ${String(reading)}`,
    ]);
    const events = windowEvents(name)
      .slice(-14)
      .map(
        entry =>
          `${entry.event}${entry.id === undefined ? '' : `#${entry.id.slice(-4)}`}${entry.terminal === undefined ? '' : `:${String(entry.terminal)}`}@${String(entry.time - sent)}`,
      );
    // A window that does not answer must not replace the palette's own error.
    const terminals = await terminalFacts(name).catch(() => undefined);
    // The taker of the focus is a window the pages' states cannot see: the display's active window says who it is.
    const displayWindowName = await activeWindowName().catch(
      (reading: unknown) => String(reading),
    );
    throw new Error(
      `${String(caught)}; pages ${JSON.stringify(pages)}, the display's active window ${JSON.stringify(displayWindowName)}; the quick input and focus in the first seconds (ms from the command) ${JSON.stringify(trail)}; terminals ${JSON.stringify(terminals?.terminals ?? '(unreadable)')}, active ${JSON.stringify(terminals?.active ?? '(unreadable)')}; the agent's events, with the terminals it saw open or become active (ms from the command, which was sent at 0) ${JSON.stringify(events)}`,
      {cause: caught},
    );
  }
}

/** The labels of the items that the command palette of window `name` lists for `text`, once its list has settled, whose launch has the palette's history of run commands switched off (`PALETTE_HISTORY_OFF` in `tools/acceptance-launches.ts`), so a row that reads the order of the list finds the alphabetical one. */
export async function paletteItems(
  name: string,
  text: string,
): Promise<string[]> {
  await showedPalette(name);
  await typeInQuickPick(name, `>${text}`);
  let items: string[] = [];
  for (let reads = 0; reads < 40; reads += 1) {
    await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
    const next = (await quickPickOf(name))?.items ?? [];
    if (reads > 0 && next.join('\n') === items.join('\n')) {
      break;
    }
    items = next;
  }
  items = await withTheRowsBelow(name, items);
  await pressEscape(name);
  return items;
}

/**
 * `above`, the rows the palette's list renders at its top, and the rows it renders at its end: the list draws only the
 * rows that fit the window, and an ArrowUp from the first row moves the focus to the last and scrolls it into view. The
 * two reads overlap, or meet, and are joined at that overlap.
 */
async function withTheRowsBelow(
  name: string,
  above: readonly string[],
): Promise<string[]> {
  if (above.length === 0) {
    return [...above];
  }
  await moveQuickPickFocus(name, 'ArrowUp');
  await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
  const bottom = (await quickPickOf(name))?.items ?? [];
  if (above.join('\n') === bottom.join('\n')) {
    // Every row fits the window: the end of the list is the top.
    return [...above];
  }
  for (
    let shared = Math.min(above.length, bottom.length);
    shared >= 1;
    shared -= 1
  ) {
    if (
      above.slice(above.length - shared).join('\n') ===
      bottom.slice(0, shared).join('\n')
    ) {
      return [...above, ...bottom.slice(shared)];
    }
  }
  // Joined with no row in common the reads could have a row between them, which would be dropped without a word.
  throw new Error(
    `the two reads of the palette of window ${name} share no row: the top reads ${JSON.stringify(above)} and the end reads ${JSON.stringify(bottom)}`,
  );
}

/** Runs the command of the Command Palette whose title is exactly `title` in window `name`, not the first match. */
export async function runFromPalette(
  name: string,
  title: string,
): Promise<void> {
  await showedPalette(name);
  await typeInQuickPick(name, `>${title}`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await chooseQuickPickRow(name, title);
}
