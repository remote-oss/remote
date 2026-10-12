/**
 * @fileoverview The "More Actions..." pick of the failure dialog: five fixed items, in the display language, whose
 * chosen one is run as an action. The content never depends on the failure, on the hints, or on any setting.
 */

import {textOfId} from './failure-strings.ts';
import {ownText} from './own-strings.ts';
import type {Translate} from './strings.ts';

/** What an item of the picker does. */
export type MitigationAction =
  | 'reloadWindow'
  | 'openRecent'
  | 'openDocumentation'
  | 'openConfigFile'
  | 'openSettings';

/** The picker as the editor shows it: a placeholder, and the items' labels in order, the first focused. */
export interface MitigationPick {
  placeholder: string;
  items: ReadonlyArray<{label: string; action: MitigationAction}>;
}

/** The picker in the display language: always the same five items. */
export function mitigationPickOf(translate: Translate): MitigationPick {
  return {
    placeholder: textOfId('S105', translate),
    items: [
      {
        label: ownText({id: 'mitigationReloadWindow', values: []}, translate),
        action: 'reloadWindow',
      },
      {label: textOfId('S102', translate), action: 'openRecent'},
      {label: textOfId('S100', translate), action: 'openDocumentation'},
      {label: textOfId('S103', translate), action: 'openConfigFile'},
      {label: textOfId('S104', translate), action: 'openSettings'},
    ],
  };
}

/** What the picker needs of the editor. */
export interface MitigationPickPort {
  /**
   * Shows the pick: single selection, no title, no Back button, an empty value, the first item focused. Gives the
   * chosen item's action, or nothing when it closed without a choice.
   */
  pick(pick: MitigationPick): PromiseLike<MitigationAction | undefined>;
}

/** What each item does; each is the editor's or another feature's operation. */
export type MitigationActions = Readonly<
  Record<MitigationAction, () => PromiseLike<unknown>>
>;

/** "More Actions...": shows the pick and runs the chosen item's action; nothing when the pick closed without one. */
export function moreActionsOf(
  port: MitigationPickPort,
  actions: MitigationActions,
  translate: Translate,
): () => Promise<void> {
  return async () => {
    const action = await port.pick(mitigationPickOf(translate));
    if (action !== undefined) {
      await actions[action]();
    }
  };
}
