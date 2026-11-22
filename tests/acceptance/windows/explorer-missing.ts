/**
 * @fileoverview What a window shows of the Remote Explorer and of Remote-SSH's connect pick when the explorer is not
 * installed or is disabled (F-5301 AC-10, AC-24).
 */

import {
  appendScript,
  hostAliases,
  recordLines,
  startInWindow,
  waitFor,
} from './harness.ts';
import {activityBarItems, notifications, paletteRows} from './renderer.ts';

/** The question of Remote-SSH's connect pick. */
const HOST_QUESTION = 'Select configured SSH host or enter user@host';

/** What a window shows of the explorer and of Remote-SSH's connect pick. */
export interface ExplorerSurfaces {
  /** Whether the activity bar has the Remote Explorer item. */
  item: boolean;
  /** Whether the palette lists "View: Show Remote Explorer". */
  command: boolean;
  /** The notifications the window shows. */
  toasts: string[];
  /** Whether the connect pick lists every configured host. */
  hosts: boolean;
}

/** What {@link explorerSurfaces} reads in a window without the explorer, whose connect pick lists the hosts. */
export const NO_EXPLORER: ExplorerSurfaces = {
  item: false,
  command: false,
  toasts: [],
  hosts: true,
};

/** What window `name` shows of the explorer and of Remote-SSH's connect pick, which is closed again. */
export async function explorerSurfaces(
  name: string,
): Promise<ExplorerSurfaces> {
  const item = (await activityBarItems(name)).some(label =>
    label.includes('Remote Explorer'),
  );
  const command = (await paletteRows(name, 'Show Remote Explorer')).some(
    label => label.includes('Show Remote Explorer'),
  );
  const asked = recordLines('hostPick', name).length;
  appendScript([
    {
      surface: 'hostPick',
      match: HOST_QUESTION,
      answer: 'dismiss',
      window: name,
    },
  ]);
  await startInWindow(name, 'opensshremotes.openEmptyWindow');
  await waitFor(
    `the connect pick of window ${name}`,
    () => Promise.resolve(recordLines('hostPick', name).length > asked),
    30_000,
  );
  const listed = recordLines('hostPick', name)[asked]?.items ?? [];
  return {
    item,
    command,
    toasts: await notifications(name),
    hosts: hostAliases().every(host => listed.includes(host)),
  };
}
