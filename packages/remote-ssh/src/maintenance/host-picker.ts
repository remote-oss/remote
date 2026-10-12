/**
 * @fileoverview The host pick of the two server maintenance commands: the fixed options of the quick pick they
 * open, and the step each picked row leads to — a target to run on, or the end of the command.
 */

import type {SshTarget} from 'lib-ssh';
import {outcomeOfPick, type PickerItem} from '../connect/picker-model.ts';

/** The quick pick both maintenance commands open: no title, one pick, no Back button, the first row focused. */
export const MAINTENANCE_PICKER_OPTIONS: {
  hasTitle: false;
  canSelectMany: false;
  hasBackButton: false;
  focusFirst: true;
} = {
  hasTitle: false,
  canSelectMany: false,
  hasBackButton: false,
  focusFirst: true,
};

/** The step a picked row leads to: the target the command runs on, or the end of the command on a fixed row. */
export type MaintenanceStep =
  | {proceed: {text: string; target: SshTarget}}
  | {stop: 'addHost' | 'configure'};

/**
 * The step a picked row leads to: a host row runs on its alias and a typed row on its parsed text; the two fixed
 * rows end the command, because it does not continue after them.
 */
export function maintenanceStep(item: PickerItem): MaintenanceStep {
  if (item.kind === 'host' || item.kind === 'typed') {
    // A host row or a typed row always connects; outcomeOfPick has no hand-over for them.
    const outcome = outcomeOfPick(item) as {connect: SshTarget};
    const text = item.kind === 'host' ? item.label : item.text;
    return {proceed: {text, target: outcome.connect}};
  }
  return {stop: item.kind};
}
