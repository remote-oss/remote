/**
 * @fileoverview What the connection step asks the shared connection's helper for: the `ssh` request of this connect,
 * built from what the client step found and the terms, and the helper's start values. A field the earlier steps
 * should have filled and did not is a defect, and throws.
 */

import type {EndPolicy} from 'lib-helper';
import {
  type ClientPlatform,
  type ConnectionAcquireRequest,
  type ConnectWaitSettings,
  DEFAULT_FIRST_MESSAGE_MILLISECONDS,
  type RunBase,
  sessionStartFor,
  type SshRequest,
} from 'lib-ssh';
import {
  effectiveConnectTimeoutSeconds,
  HELPER_GRACE_MILLISECONDS,
  HOST_ZERO_TIMEOUT_SECONDS,
} from './bounds.ts';
import {hostAlias, sshTargetOf} from './host-settings.ts';
import type {ConnectState} from './locate-step.ts';
import type {
  ConnectInput,
  ConnectionTerms,
  ConnectWaits,
  StepFailure,
  StepResult,
} from './steps.ts';

/** The settings the request reads, as the editor reports them. */
export interface ConnectionRequestSettings {
  /** `remote.SSH.configFile`; empty when unset. */
  configFile: string;
  /** `remote.SSH.connectTimeout`, as written. */
  connectTimeout: unknown;
  /** `remote.SSH.permitPtyAllocation`, as written. */
  permitPtyAllocation: unknown;
  /** `remote.SSH.externalSSH_ASKPASS`. */
  externalAskpass: boolean;
}

/** Where the extension runs: its folders, its bundled files and the editor's environment. */
export interface ConnectionRequestEnvironment {
  /** The registry folder of the profile, in the extension's global storage. */
  registryFolder: string;
  /** The bundled helper script. */
  helperScript: string;
  /** The bundled askpass program. */
  askpassProgram: string;
  /** The editor's executable, which runs the helper and the askpass program. */
  runtime: string;
  /** The user's runtime folder. */
  runtimeFolder: string;
  homeFolder: string;
  platform: ClientPlatform;
  /** The editor's environment, where the user's own askpass is named. */
  processEnvironment: Readonly<Record<string, string | undefined>>;
}

/** The end of the helper: a short grace after the last window, which carries a reload. */
const HELPER_POLICY: EndPolicy = {
  kind: 'graceAfterLastLease',
  milliseconds: HELPER_GRACE_MILLISECONDS,
};

/**
 * What every `ssh` and `scp` run of one connect shares: the target, the settings, and what the client step found. A
 * field the client step should have filled and did not is a defect, and throws.
 */
export function runBaseOf(
  input: ConnectInput,
  terms: ConnectionTerms,
  state: ConnectState,
  settings: ConnectionRequestSettings,
  environment: Pick<ConnectionRequestEnvironment, 'homeFolder' | 'platform'>,
): RunBase {
  const {programs, effective} = state;
  if (programs === undefined || effective === undefined) {
    throw new Error('the connection was asked for before the client was found');
  }
  return {
    target: sshTargetOf(input.target),
    settings: {
      configFile: settings.configFile,
      connectTimeout: effectiveConnectTimeoutSeconds(
        undefined,
        settings.connectTimeout,
      ),
      permitPtyAllocation: settings.permitPtyAllocation,
      remoteCommandInEffect: terms.remoteCommandInEffect,
    },
    effective,
    programs,
    homeFolder: environment.homeFolder,
    platform: environment.platform,
  };
}

/**
 * The acquire request of one connect, apart from the host string and the cancellation. Its preparation runs only in
 * the window that starts the helper: it looks the client up with `locate`, which fills `state`, and builds the helper's
 * start values and the run facts from what was found. A lookup that fails refuses the start with its failure.
 */
export function connectionRequestOf(
  input: ConnectInput,
  terms: ConnectionTerms,
  state: ConnectState,
  settings: ConnectionRequestSettings,
  environment: ConnectionRequestEnvironment,
  locate: () => Promise<StepResult<ConnectWaits>>,
): Omit<ConnectionAcquireRequest<StepFailure>, 'hostString' | 'cancellation'> {
  return {
    folder: environment.registryFolder,
    script: environment.helperScript,
    prepare: async () => {
      const located = await locate();
      if (located.kind === 'failed') {
        return {kind: 'refused', refusal: located.failure};
      }
      const base = runBaseOf(input, terms, state, settings, environment);
      const userAskpass = environment.processEnvironment.SSH_ASKPASS ?? '';
      return {
        kind: 'ready',
        runFacts: {
          sshProgram: base.programs.sshProgram,
          scpProgram: base.programs.scpProgram,
          effective: base.effective,
        },
        options: {
          request: JSON.stringify({...base, purpose: 'connection'}),
          unboundedWaitSeconds: HOST_ZERO_TIMEOUT_SECONDS,
          runtimeFolder: environment.runtimeFolder,
          runtime: environment.runtime,
          askpassProgram: environment.askpassProgram,
          displayHost: hostAlias(input.target),
          externalAskpass: settings.externalAskpass && userAskpass !== '',
          askpassFirstMessageMilliseconds: DEFAULT_FIRST_MESSAGE_MILLISECONDS,
        },
      };
    },
    policy: HELPER_POLICY,
  };
}

/**
 * The `ssh` request of the install connection in terminal mode: the session start as the remote program, and either our
 * `-D` port when the window tunnel rides it, or, with no `-D`, the user's own forwards cleared so the run holds none.
 */
export function installRequestOf(
  input: ConnectInput,
  terms: ConnectionTerms,
  state: ConnectState,
  settings: ConnectionRequestSettings,
  environment: ConnectionRequestEnvironment,
  socksPort: number | undefined,
  connectWait: ConnectWaitSettings,
): SshRequest {
  return {
    ...runBaseOf(input, terms, state, settings, environment),
    purpose: 'connection',
    remoteProgram: sessionStartFor(connectWait).remoteProgram,
    ...(socksPort === undefined
      ? {clearUserForwards: true}
      : {forwards: [{kind: 'dynamic' as const, localPort: socksPort}]}),
  };
}
