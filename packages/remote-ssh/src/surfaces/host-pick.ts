/**
 * @fileoverview The port behind the host pick: the rows a connect command shows when it asks for a host, and the row
 * taken. The editor's quick pick answers it the way a user does; the acceptance script answers it from its entries,
 * so the commands see neither the editor nor the harness.
 */

import type {PickerItem, PickerModel} from '../connect/picker-model.ts';

/**
 * The host pick: the rows as first shown are `initial`, the rows for the text typed so far come from `modelOf`, and it
 * gives the row taken, or nothing when the pick is closed without one.
 */
export interface HostPickPort {
  pick(
    initial: PickerModel,
    modelOf: (typedText: string) => PickerModel,
  ): Promise<PickerItem | undefined>;
}
