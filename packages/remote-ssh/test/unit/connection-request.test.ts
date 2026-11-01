import {deepStrictEqual, rejects, throws} from 'node:assert';
import {
  type ConnectionHelperOptions,
  type ConnectWaitSettings,
  type EffectiveOptions,
  type RunFacts,
  sessionStartFor,
  type SshRequest,
} from 'lib-ssh';
import {
  type ConnectionRequestEnvironment,
  type ConnectionRequestSettings,
  connectionRequestOf,
  runBaseOf,
  installRequestOf,
} from '../../src/pipeline/connection-request.ts';
import type {ConnectState} from '../../src/pipeline/locate-step.ts';
import type {
  ConnectionTerms,
  ConnectWaits,
  StepResult,
} from '../../src/pipeline/steps.ts';
import {INPUT, TERMS} from './pipeline.fixture.ts';

const WAITS: ConnectWaits = {probeMilliseconds: 1000, tunnelMilliseconds: 2000};

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

const WAIT: ConnectWaitSettings = {
  connectTimeoutSeconds: 20,
  fromHost: false,
  unboundedWaitSeconds: 600,
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

/** The request built from the defaults above with `changes`, with the helper's start values and run facts prepared. */
async function requestWith(
  changes: {
    state?: ConnectState;
    settings?: Partial<ConnectionRequestSettings>;
    environment?: Partial<ConnectionRequestEnvironment>;
    text?: string;
    terms?: ConnectionTerms;
    locate?: () => Promise<StepResult<ConnectWaits>>;
  } = {},
): Promise<Built> {
  const built = connectionRequestOf(
    {...INPUT, target: {kind: 'plain', text: changes.text ?? 'alex@dev:2222'}},
    changes.terms ?? TERMS,
    changes.state ?? STATE,
    {...SETTINGS, ...changes.settings},
    {...ENVIRONMENT, ...changes.environment},
    changes.locate ?? (() => Promise.resolve({kind: 'done', value: WAITS})),
  );
  const prepared = await built.prepare();
  if (prepared.kind === 'refused') {
    throw new Error('the preparation was refused');
  }
  return {...built, ...prepared};
}

/** The request after its preparation went well. */
type Built = Omit<ReturnType<typeof connectionRequestOf>, 'prepare'> & {
  options: Omit<ConnectionHelperOptions, 'socksPort' | 'recordFile'>;
  runFacts: RunFacts;
};

/** The ssh request the helper is given, read back from its JSON. */
function sshRequestOf(built: Built): SshRequest {
  return JSON.parse(built.options.request) as SshRequest;
}

describe("the shared connection's acquire request", () => {
  it('connect-14: the ssh request is a connection to the target, with what the client step found', async () => {
    deepStrictEqual(sshRequestOf(await requestWith()), {
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

  it('F-2107: whether the remote command runs is what the terms decided', async () => {
    deepStrictEqual(
      sshRequestOf(
        await requestWith({terms: {...TERMS, remoteCommandInEffect: true}}),
      ).settings.remoteCommandInEffect,
      true,
    );
  });

  it('F-2105 BR-1: a setting that is not a whole number gives ssh the default 15', async () => {
    deepStrictEqual(
      sshRequestOf(await requestWith({settings: {connectTimeout: 'x'}}))
        .settings.connectTimeout,
      15,
    );
  });

  it("F-2105 AC-9: the setting's 0 stays 0", async () => {
    deepStrictEqual(
      sshRequestOf(await requestWith({settings: {connectTimeout: 0}})).settings
        .connectTimeout,
      0,
    );
  });

  it("ruled on #253 Q8: the helper's start values, its folder, script and end", async () => {
    const built = await requestWith();
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

  it('F-2305 3.4: the questions name the host as chosen, without user and port', async () => {
    deepStrictEqual(
      (await requestWith({text: 'alex@box.example:2200'})).options.displayHost,
      'box.example',
    );
  });

  it("F-2309: the user's own askpass applies when the setting is on and SSH_ASKPASS is set", async () => {
    deepStrictEqual(
      (
        await requestWith({
          settings: {externalAskpass: true},
          environment: {
            processEnvironment: {SSH_ASKPASS: '/usr/bin/ksshaskpass'},
          },
        })
      ).options.externalAskpass,
      true,
    );
  });

  it('F-2309: an empty SSH_ASKPASS counts as unset', async () => {
    deepStrictEqual(
      (
        await requestWith({
          settings: {externalAskpass: true},
          environment: {processEnvironment: {SSH_ASKPASS: ''}},
        })
      ).options.externalAskpass,
      false,
    );
  });

  it('F-2309: with no SSH_ASKPASS the setting alone does not apply', async () => {
    deepStrictEqual(
      (await requestWith({settings: {externalAskpass: true}})).options
        .externalAskpass,
      false,
    );
  });

  it('F-2309: with the setting off a set SSH_ASKPASS is not used', async () => {
    deepStrictEqual(
      (
        await requestWith({
          environment: {
            processEnvironment: {SSH_ASKPASS: '/usr/bin/ksshaskpass'},
          },
        })
      ).options.externalAskpass,
      false,
    );
  });

  it('connect-14: a connection asked for before the client was found is a defect, and throws', async () => {
    await rejects(requestWith({state: {}}), /before the client was found/);
  });

  it('connect-14: the options alone without the programs throw as well', async () => {
    await rejects(
      requestWith({state: {effective: EFFECTIVE}}),
      /before the client was found/,
    );
  });

  it("connect-14: the runs' shared part is the connection's request without its purpose", async () => {
    const input = {
      ...INPUT,
      target: {kind: 'plain', text: 'alex@dev:2222'},
    } as const;
    deepStrictEqual(
      {
        ...runBaseOf(input, TERMS, STATE, SETTINGS, ENVIRONMENT),
        purpose: 'connection',
      },
      sshRequestOf(await requestWith()),
    );
  });
});

describe("the install connection's request in terminal mode (card connect-17)", () => {
  function installWith(
    socksPort: number | undefined,
    state: ConnectState = STATE,
  ) {
    return installRequestOf(
      {...INPUT, target: {kind: 'plain', text: 'alex@dev:2222'}},
      TERMS,
      state,
      SETTINGS,
      ENVIRONMENT,
      socksPort,
      WAIT,
    );
  }

  it('#443: the remote program is the session start of the connect wait', () => {
    deepStrictEqual(
      installWith(undefined).remoteProgram,
      sessionStartFor(WAIT).remoteProgram,
    );
  });

  it('F-2107 BR-1: with a RemoteCommand in effect the request carries no remote program', () => {
    const request = installRequestOf(
      {...INPUT, target: {kind: 'plain', text: 'alex@dev:2222'}},
      {...TERMS, remoteCommandInEffect: true},
      STATE,
      SETTINGS,
      ENVIRONMENT,
      undefined,
      WAIT,
    );
    deepStrictEqual('remoteProgram' in request, false);
  });

  it('F-2104 6.3: with a SOCKS port it holds the dynamic forward and keeps the user forwards', () => {
    const request = installWith(41000);
    deepStrictEqual(
      [request.forwards, request.clearUserForwards],
      [[{kind: 'dynamic', localPort: 41000}], undefined],
    );
  });

  it('F-2104 6.2 step 1: without a SOCKS port it clears the user forwards and holds none', () => {
    const request = installWith(undefined);
    deepStrictEqual(
      [request.forwards, request.clearUserForwards],
      [undefined, true],
    );
  });

  it('connect-14: it starts from the same request as the shared connection', async () => {
    const {remoteProgram, clearUserForwards, ...base} = installWith(undefined);
    deepStrictEqual(
      [base, remoteProgram, clearUserForwards],
      [
        sshRequestOf(await requestWith({text: 'alex@dev:2222'})),
        sessionStartFor(WAIT).remoteProgram,
        true,
      ],
    );
  });

  it('connect-14: asking before the client step is a defect, and throws', () => {
    throws(() => installWith(undefined, {}), /before the client was found/);
  });

  it('F-2101 BR-9: the run facts are the programs and the options the client step found', async () => {
    deepStrictEqual((await requestWith()).runFacts, {
      sshProgram: '/usr/bin/ssh',
      scpProgram: '/usr/bin/scp',
      effective: EFFECTIVE,
    });
  });

  it('F-2101 BR-9: the lookup runs inside the preparation, once, and not before it', async () => {
    const calls: string[] = [];
    const built = connectionRequestOf(
      INPUT,
      TERMS,
      STATE,
      SETTINGS,
      ENVIRONMENT,
      () => {
        calls.push('locate');
        return Promise.resolve({kind: 'done', value: WAITS});
      },
    );
    const before = [...calls];
    await built.prepare();
    deepStrictEqual([before, calls], [[], ['locate']]);
  });

  it('F-2101 7.E4: a lookup that fails refuses the start with its failure', async () => {
    const failure = {
      kind: 'prerequisiteMissing' as const,
      reason: {id: 'S009'},
    };
    const built = connectionRequestOf(
      INPUT,
      TERMS,
      {},
      SETTINGS,
      ENVIRONMENT,
      () => Promise.resolve({kind: 'failed', failure}),
    );
    deepStrictEqual(await built.prepare(), {kind: 'refused', refusal: failure});
  });
});
