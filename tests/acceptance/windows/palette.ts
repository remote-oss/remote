import {startInWindow, windowEvents, windowNames} from './harness.ts';
import {
  chooseQuickPickRow,
  focusFacts,
  pressEscape,
  quickPickOf,
  typeInQuickPick,
  waitForQuickPick,
} from './renderer.ts';

/** How long the palette's list must read the same, in milliseconds, before it counts as settled. */
const SETTLE_MILLISECONDS = 600;

/** The labels of the items that the command palette of window `name` lists for `text`, once its list has settled. */
export async function paletteItems(
  name: string,
  text: string,
): Promise<string[]> {
  await startInWindow(name, 'workbench.action.showCommands');
  const seen: string[] = [];
  const began = Date.now();
  const sampler = setInterval(() => {
    void focusFacts(name)
      .then(facts => {
        const widget = /"quick":("?[a-z]+"?|null),"items":(\d+)/.exec(facts);
        seen.push(
          `${String(Date.now() - began)}ms quick=${widget?.[1] ?? '?'} items=${widget?.[2] ?? '?'}`,
        );
      })
      .catch(() => undefined);
  }, 500);
  try {
    await waitForQuickPick(name, 30_000);
    clearInterval(sampler);
  } catch (caught) {
    clearInterval(sampler);
    throw new Error(
      `${String(caught)}; FOCUS ${await focusFacts(name)}; windows ${JSON.stringify(windowNames())}; EVENTS ${JSON.stringify(
        windowEvents(name)
          .slice(-14)
          .map(
            entry =>
              `${entry.event}${entry.id === undefined ? '' : `#${entry.id.slice(-4)}`}@${String(entry.time - began)}`,
          ),
      )}; SAMPLES ${JSON.stringify([...new Set(seen.map(line => line.replace(/^\d+ms /, '')))])}`,
      {cause: caught},
    );
  }
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
  await startInWindow(name, 'workbench.action.showCommands');
  await waitForQuickPick(name, 30_000);
  await typeInQuickPick(name, `>${title}`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await chooseQuickPickRow(name, title);
}
