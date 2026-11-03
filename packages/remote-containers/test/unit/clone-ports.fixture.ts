/**
 * @fileoverview The shared fake of the clone commands' tests: the ports of the clone command a scene steers,
 * logging its calls in the given list and answering as the given answers say.
 */

import {createLogger} from 'lib-log';
import type {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  CloneCommandPorts,
  CloneTrustAnswer,
} from '../../src/volumes/clone-command.ts';
import type {PrecheckOutcome} from '../../src/volumes/precheck.ts';
import {volumeTargetOf} from '../../src/volumes/volume-payload.ts';

/** How a scene's ports answer the clone command's shared steps. */
export interface CloneAnswers {
  accepted: boolean;
  trust: CloneTrustAnswer;
  engineReady: boolean;
  typed: string | undefined;
  precheck: PrecheckOutcome;
  currentRepository: string | undefined;
}

/** The answers a scene holds when it changes none. */
export const DEFAULT_CLONE_ANSWERS: CloneAnswers = {
  accepted: true,
  trust: 'gotIt',
  engineReady: true,
  typed: 'https://github.com/o/r/tree/main',
  precheck: 'reachable',
  currentRepository: undefined,
};

/** The clone command's ports that log their calls in `calls` and answer as `answers` says. */
export function cloneCommandPortsOf(
  answers: CloneAnswers,
  calls: string[],
  sink: MemorySink,
): CloneCommandPorts {
  return {
    trust: {
      accepted: () => answers.accepted,
      confirm: () => {
        calls.push('trust');
        return Promise.resolve(answers.trust);
      },
      remember: () => {
        calls.push('remember');
        return Promise.resolve();
      },
      learnMore: () => {
        calls.push('learnMore');
      },
    },
    engineReady: () => {
      calls.push('engine');
      return Promise.resolve(answers.engineReady);
    },
    pickSource: () => {
      calls.push('pick');
      return Promise.resolve(answers.typed);
    },
    precheck: source => {
      calls.push(`precheck ${source.urlToClone}`);
      return Promise.resolve(answers.precheck);
    },
    cannotAccess: repository => {
      calls.push(`cannotAccess ${repository}`);
      return Promise.resolve();
    },
    currentRepository: () => answers.currentRepository,
    engine: () => ({context: 'ctx1'}),
    recordTyped: payload => {
      calls.push(`typed ${JSON.stringify(volumeTargetOf(payload))}`);
      return Promise.resolve();
    },
    reload: uri => {
      const [authority, folder] = uri
        .slice('vscode-remote://dev-container+'.length)
        .split('/workspaces/');
      calls.push(
        `reload ${String(folder)} ${JSON.stringify(volumeTargetOf(authority ?? ''))}`,
      );
      return Promise.resolve();
    },
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  };
}
