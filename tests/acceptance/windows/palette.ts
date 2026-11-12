import {startInWindow, terminalFacts, windowEvents} from './harness.ts';
import {
  chooseQuickPickRow,
  pageFocusFacts,
  pressEscape,
  quickPickOf,
  typeInQuickPick,
  waitForQuickPick,
} from './renderer.ts';

/** How long the palette's list must read the same, in milliseconds, before it counts as settled. */
const SETTLE_MILLISECONDS = 600;

/** Reads the pages' quick input and focus every 250 ms for 3 s after `sent`, into `trail`, so that a palette that shows and goes can be told from one that never shows. */
async function sampleQuickInput(sent: number, trail: string[]): Promise<void> {
  for (let reads = 0; reads < 12; reads += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
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
  await startInWindow(name, 'workbench.action.showCommands');
  const sampling = sampleQuickInput(sent, trail);
  try {
    await waitForQuickPick(name, 30_000);
  } catch (caught) {
    await sampling;
    const terminals = await terminalFacts(name);
    const events = windowEvents(name)
      .slice(-14)
      .map(
        entry =>
          `${entry.event}${entry.id === undefined ? '' : `#${entry.id.slice(-4)}`}@${String(entry.time - sent)}`,
      );
    throw new Error(
      `${String(caught)}; pages ${JSON.stringify(await pageFocusFacts())}; the quick input and focus in the first seconds (ms from the command) ${JSON.stringify(trail)}; terminals ${JSON.stringify(terminals.terminals)}, active ${JSON.stringify(terminals.active)}; the agent's events (ms from the command) ${JSON.stringify(events)}`,
      {cause: caught},
    );
  }
}

/** The labels of the items that the command palette of window `name` lists for `text`, once its list has settled. */
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
  await pressEscape(name);
  return items;
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
