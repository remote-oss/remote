import {startInWindow} from './harness.ts';
import {
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
  await waitForQuickPick(name, 30_000);
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
