/**
 * @fileoverview A clone with no dev container configuration: the template picker runs on the clone's files until it
 * writes one. Leaving the picker shows S414, whose Select Configuration starts the picker again from the beginning and
 * whose Cancel leaves the clone without one.
 */

import type {WizardOutcome} from '../authoring/wizard-stages.ts';

/** What the flow needs of the wizard and the editor. */
export interface VolumeConfigurationPorts {
  /** Runs the template picker on the clone's folder, from its beginning. */
  runWizard(): Promise<WizardOutcome>;
  /** Shows S414; whether Select Configuration was chosen. */
  mustSelect(): Promise<boolean>;
}

/** Whether a configuration was written, or the user left the flow. */
export async function configurationAdded(
  ports: VolumeConfigurationPorts,
): Promise<'written' | 'left'> {
  for (;;) {
    const outcome = await ports.runWizard();
    if (outcome.kind === 'written') {
      return 'written';
    }
    if (outcome.kind === 'failed' || !(await ports.mustSelect())) {
      return 'left';
    }
  }
}
