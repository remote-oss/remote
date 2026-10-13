/**
 * @fileoverview Setup ports for the tests of a family extension: they answer from a scenario and record what the
 * setup did, in order, into `events`.
 */

import type {ProposalName} from '../gate/probe.ts';
import type {SetupPorts} from '../gate/setup.ts';

/** What the fake editor and user do. */
export interface RecordingScenario {
  extensionId: string;
  /** The proposals the probe finds missing; every other one is granted. */
  missing?: readonly ProposalName[];
  /** The proposals the probe reports at all, granted unless missing. */
  probed?: readonly ProposalName[];
}

/** The setup ports with the list of what happened: `probe`, `claim`, `notice`, and `failure <message>`. */
export function recordingSetupPorts(
  scenario: RecordingScenario,
  events: string[],
): SetupPorts {
  const missing = scenario.missing ?? [];
  const probed = scenario.probed ?? missing;
  return {
    extensionId: scenario.extensionId,
    probe: () => {
      events.push('probe');
      return Promise.resolve(
        probed.map(proposal => ({
          proposal,
          state: missing.includes(proposal) ? 'missing' : 'granted',
        })),
      );
    },
    installedFamilyIds: () => Promise.resolve([scenario.extensionId]),
    argvEnabled: () => Promise.resolve([]),
    flags: {
      dismissed: () => false,
      setDismissed: () => Promise.resolve(),
      attemptPending: () => false,
      setAttemptPending: () => Promise.resolve(),
    },
    window: {
      claim: extensionId => {
        events.push('claim');
        return Promise.resolve({holder: extensionId});
      },
    },
    showSetup: () => {
      events.push('notice');
      return Promise.resolve('notNow');
    },
    showRestart: () => Promise.resolve('later'),
    configureRuntimeArguments: () => Promise.resolve(),
    argvEdited: () => Promise.resolve(false),
    quit: () => Promise.resolve(),
    logFailure: message => {
      events.push(`failure ${message}`);
    },
  };
}
