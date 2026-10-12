import {deepStrictEqual, throws} from 'node:assert';
import type {EffectiveOptions, SshRequest} from 'lib-ssh';
import {
  type ConnectionRequestEnvironment,
  type ConnectionRequestSettings,
  connectionRequestOf,
  runBaseOf,
} from '../../src/pipeline/connection-request.ts';
import type {ConnectState} from '../../src/pipeline/locate-step.ts';
import {INPUT, TERMS} from './pipeline.fixture.ts';

const EFFECTIVE: EffectiveOptions = {
  hostName: 'dev.example',
  user: 'alex',
  port: '22',
  localForwards: [],
  clearAllForwardings: false,
};

const STATE: ConnectState = {
  programs: {sshProgram: '/usr/bin/ssh', scpProgram: '/usr/bin/scp'},
  effective: EFFECTIVE,
};

const SETTINGS: ConnectionRequestSettings = {
  configFile: '~/cfg',
  connectTimeout: 20,
  permitPtyAllocation: false,
  externalAskpass: false,
};

const ENVIRONMENT: ConnectionRequestEnvironment = {
  registryFolder: '/storage/registry',
  helperScript: '/extension/dist/connection-helper.js',
  askpassProgram: '/extension/dist/askpass.js',
  runtime: '/editor/node',
  runtimeFolder: '/run/user/1000',
  homeFolder: '/home/alex',
  platform: 'linux',
  processEnvironment: {},
};

/** The request built from the defaults above with `changes`. */
function requestWith(
  changes: {
    state?: ConnectState;
    settings?: Partial<ConnectionRequestSettings>;
    environment?: Partial<ConnectionRequestEnvironment>;
    text?: string;
  } = {},
): ReturnType<typeof connectionRequestOf> {
  return connectionRequestOf(
    {...INPUT, target: {kind: 'plain', text: changes.text ?? 'alex@dev:2222'}},
    TERMS,
    changes.state ?? STATE,
    {...SETTINGS, ...changes.settings},
    {...ENVIRONMENT, ...changes.environment},
  );
}

/** The ssh request the helper is given, read back from its JSON. */
function sshRequestOf(
  built: ReturnType<typeof connectionRequestOf>,
): SshRequest {
  return JSON.parse(built.options.request) as SshRequest;
}

describe("the shared connection's acquire request", () => {
  it('connect-14: the ssh request is a connection to the target, with what the client step found', () => {
    deepStrictEqual(sshRequestOf(requestWith()), {
      purpose: 'connection',
      target: {host: 'dev', user: 'alex', port: 2222},
      settings: {
        configFile: '~/cfg',
        connectTimeout: 20,
        permitPtyAllocation: false,
        remoteCommandInEffect: false,
      },
      effective: EFFECTIVE,
      programs: {sshProgram: '/usr/bin/ssh', scpProgram: '/usr/bin/scp'},
      homeFolder: '/home/alex',
      platform: 'linux',
    });
  });

  it('F-2107: whether the remote command runs is what the terms decided', () => {
    deepStrictEqual(
      sshRequestOf(
        connectionRequestOf(
          INPUT,
          {...TERMS, remoteCommandInEffect: true},
          STATE,
          SETTINGS,
          ENVIRONMENT,
        ),
      ).settings.remoteCommandInEffect,
      true,
    );
  });

  it('F-2105 BR-1: a setting that is not a whole number gives ssh the default 15', () => {
    deepStrictEqual(
      sshRequestOf(requestWith({settings: {connectTimeout: 'x'}})).settings
        .connectTimeout,
      15,
    );
  });

  it("F-2105 AC-9: the setting's 0 stays 0", () => {
    deepStrictEqual(
      sshRequestOf(requestWith({settings: {connectTimeout: 0}})).settings
        .connectTimeout,
      0,
    );
  });

  it("ruled on #253 Q8: the helper's start values, its folder, script and end", () => {
    const built = requestWith();
    deepStrictEqual(
      {
        folder: built.folder,
        script: built.script,
        policy: built.policy,
        options: {...built.options, request: ''},
      },
      {
        folder: '/storage/registry',
        script: '/extension/dist/connection-helper.js',
        policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
        options: {
          request: '',
          unboundedWaitSeconds: 600,
          runtimeFolder: '/run/user/1000',
          runtime: '/editor/node',
          askpassProgram: '/extension/dist/askpass.js',
          displayHost: 'dev',
          externalAskpass: false,
          askpassFirstMessageMilliseconds: 5000,
        },
      },
    );
  });

  it('F-2305 3.4: the questions name the host as chosen, without user and port', () => {
    deepStrictEqual(
      requestWith({text: 'alex@box.example:2200'}).options.displayHost,
      'box.example',
    );
  });

  it("F-2309: the user's own askpass applies when the setting is on and SSH_ASKPASS is set", () => {
    deepStrictEqual(
      requestWith({
        settings: {externalAskpass: true},
        environment: {
          processEnvironment: {SSH_ASKPASS: '/usr/bin/ksshaskpass'},
        },
      }).options.externalAskpass,
      true,
    );
  });

  it('F-2309: an empty SSH_ASKPASS counts as unset', () => {
    deepStrictEqual(
      requestWith({
        settings: {externalAskpass: true},
        environment: {processEnvironment: {SSH_ASKPASS: ''}},
      }).options.externalAskpass,
      false,
    );
  });

  it('F-2309: with no SSH_ASKPASS the setting alone does not apply', () => {
    deepStrictEqual(
      requestWith({settings: {externalAskpass: true}}).options.externalAskpass,
      false,
    );
  });

  it('F-2309: with the setting off a set SSH_ASKPASS is not used', () => {
    deepStrictEqual(
      requestWith({
        environment: {
          processEnvironment: {SSH_ASKPASS: '/usr/bin/ksshaskpass'},
        },
      }).options.externalAskpass,
      false,
    );
  });

  it('connect-14: a connection asked for before the client was found is a defect, and throws', () => {
    throws(() => requestWith({state: {}}), /before the client was found/);
  });

  it('connect-14: the options alone without the programs throw as well', () => {
    throws(
      () => requestWith({state: {effective: EFFECTIVE}}),
      /before the client was found/,
    );
  });

  it("connect-14: the runs' shared part is the connection's request without its purpose", () => {
    const input = {
      ...INPUT,
      target: {kind: 'plain', text: 'alex@dev:2222'},
    } as const;
    deepStrictEqual(
      {
        ...runBaseOf(input, TERMS, STATE, SETTINGS, ENVIRONMENT),
        purpose: 'connection',
      },
      sshRequestOf(requestWith()),
    );
  });
});
