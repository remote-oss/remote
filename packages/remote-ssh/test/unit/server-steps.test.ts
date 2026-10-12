import {deepStrictEqual} from 'node:assert';
import type {RecordingChannel} from 'lib-host/testing/recording-channel';
import {createServerSteps} from '../../src/pipeline/server-steps.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {
  channelAnswering,
  dependencies,
  HOST,
  leaseOn,
  lines,
  modalAnswering,
  PROFILE,
  settingsWith,
  storeOf,
} from './server-steps.fixture.ts';

const INPUT: ConnectInput = {
  target: {kind: 'plain', text: 'devbox'},
  rawHostString: 'devbox',
  attempt: 1,
  isReconnection: false,
  windowId: 'window-1',
  windowWorkspace: undefined,
};

const NEVER_CANCELLED = new AbortController().signal;

/** The failure the target check gives the validate step, for a row to compare. */
function targetFailure(
  stringId: 'S119' | 'S120' | 'S121' | 'S122',
  character: string,
) {
  return {
    kind: 'failed',
    failure: {
      kind: 'invalidSetting',
      reason: {id: stringId, values: [character]},
    },
  };
}

const PROBE_FACTS = [
  'host.os=linux',
  'host.arch=x64',
  'host.libc=glibc',
  'host.release=debian',
  'host.home=/home/alex',
  'host.tmp=/tmp',
  'host.shell=sh',
  'host.tool.tar=yes',
  'host.tool.wget=yes',
  'host.tool.curl=no',
  'host.tool.unzip=no',
  'host.tool.flock=yes',
  'host.wgetBusybox=no',
  'host.sshAuthSock=',
  'host.display=',
  'server.installDir=/home/alex/.fixture-server/bin/abc123',
  'server.installed=no',
];

const STARTED = lines(
  'Ok',
  'server.port=4321',
  'server.pid=77',
  'server.token=abcdefghijklmnopqrstuvwxyz012345',
);

describe('the server steps: probe', () => {
  it('asks the host over the lease and reads what it reports', async () => {
    const steps = createServerSteps(dependencies());
    const outcome = await steps.probe(
      INPUT,
      leaseOn(channelAnswering(lines('Ok', ...PROBE_FACTS))),
      new AbortController().signal,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? [outcome.host.operatingSystem, outcome.host.home]
        : outcome,
      ['linux', '/home/alex'],
    );
  });

  it('passes a platform the host cannot run as the probe failure', async () => {
    const steps = createServerSteps(dependencies());
    const outcome = await steps.probe(
      INPUT,
      leaseOn(
        channelAnswering(lines('UnsupportedPlatform', 'host.os=FreeBSD')),
      ),
      new AbortController().signal,
    );
    deepStrictEqual(outcome, {
      kind: 'failed',
      failure: {kind: 'unsupportedPlatform', reported: 'FreeBSD'},
    });
  });
});

describe('the server steps: plan', () => {
  it('downloads from the address the override gives, for the host platform', () => {
    const steps = createServerSteps(dependencies());
    const result = steps.plan(INPUT, HOST);
    deepStrictEqual(
      'plan' in result && result.plan.kind === 'download'
        ? [result.plan.address, result.plan.installFolder]
        : result,
      [
        'https://example.invalid/server-linux-x64-abc123.tar.gz',
        '/home/alex/.fixture-server/bin/abc123',
      ],
    );
  });

  it('names the host an Alpine one when it runs musl', () => {
    const steps = createServerSteps(dependencies());
    const result = steps.plan(INPUT, {...HOST, libc: 'musl'});
    deepStrictEqual(
      'plan' in result && result.plan.kind === 'download'
        ? result.plan.address
        : result,
      'https://example.invalid/server-alpine-x64-abc123.tar.gz',
    );
  });

  it('reuses the server that is installed', () => {
    const steps = createServerSteps(dependencies());
    const result = steps.plan(INPUT, {...HOST, installed: true});
    deepStrictEqual('plan' in result ? result.plan.kind : result, 'reuse');
  });

  it('has no source when there is no override and the product names none', () => {
    const steps = createServerSteps(dependencies({override: undefined}));
    deepStrictEqual(steps.plan(INPUT, HOST), {failure: {kind: 'noSource'}});
  });

  it('reports an override that cannot be used, with the kind of the problem', () => {
    const steps = createServerSteps(
      dependencies({
        override: {
          value: 'https://example.invalid/${nothing}',
          layer: 'defaultProfileUser',
        },
      }),
    );
    const result = steps.plan(INPUT, HOST);
    deepStrictEqual(
      'failure' in result ? result.failure.kind : result,
      'invalidOverride',
    );
  });

  it('puts the server in the folder the install path setting names', () => {
    const steps = createServerSteps(
      dependencies({
        settings: settingsWith({
          serverInstallPath: {devbox: '/data'},
          defaultExtensions: undefined,
        }),
      }),
    );
    const result = steps.plan(INPUT, HOST);
    deepStrictEqual(
      'plan' in result && result.plan.kind === 'download'
        ? result.plan.installFolder
        : result,
      '/data/.fixture-server/bin/abc123',
    );
  });
});

describe('the server steps: gate', () => {
  it('clears a server that is free of the terms without asking and sets no flag', async () => {
    const asked: string[] = [];
    const steps = createServerSteps(
      dependencies({modal: modalAnswering('accept', asked)}),
    );
    steps.plan(INPUT, HOST);
    deepStrictEqual(
      [await steps.gate(INPUT, NEVER_CANCELLED), asked],
      [{kind: 'cleared', acceptanceFlag: false, remembered: false}, []],
    );
  });

  it('asks about a reused server of a product that lists licence lines, and clears it on accept', async () => {
    const asked: string[] = [];
    const steps = createServerSteps(
      dependencies({
        profile: {...PROFILE, serverLicense: ['terms']},
        modal: modalAnswering('accept', asked),
      }),
    );
    steps.plan(INPUT, {...HOST, installed: true});
    deepStrictEqual(
      [await steps.gate(INPUT, NEVER_CANCELLED), asked.length],
      [{kind: 'cleared', acceptanceFlag: true, remembered: true}, 1],
    );
  });

  it('declines when the user cancels', async () => {
    const steps = createServerSteps(
      dependencies({
        profile: {...PROFILE, serverLicense: ['terms']},
        modal: modalAnswering('cancel', []),
      }),
    );
    steps.plan(INPUT, {...HOST, installed: true});
    deepStrictEqual(await steps.gate(INPUT, NEVER_CANCELLED), {
      kind: 'licenceDeclined',
    });
  });

  it('is a cancellation when the signal is aborted, without asking and without a flag', async () => {
    const asked: string[] = [];
    const store = storeOf();
    const controller = new AbortController();
    controller.abort();
    const steps = createServerSteps(
      dependencies({
        profile: {...PROFILE, serverLicense: ['terms']},
        store,
        modal: modalAnswering('accept', asked),
      }),
    );
    steps.plan(INPUT, {...HOST, installed: true});
    deepStrictEqual(
      [await steps.gate(INPUT, controller.signal), asked],
      [{kind: 'cancelled'}, []],
    );
  });
});

describe('the server steps: transfer and start', () => {
  it('installs on the host from the plan and reports the install folder', async () => {
    const steps = createServerSteps(dependencies());
    const result = steps.plan(INPUT, HOST);
    if (!('plan' in result) || result.plan.kind !== 'download') {
      throw new Error('the plan should download');
    }
    const outcome = await steps.transfer(
      INPUT,
      leaseOn(
        channelAnswering(
          lines(
            'Ok',
            'server.installDir=/home/alex/.fixture-server/bin/abc123',
          ),
        ),
      ),
      HOST,
      result.plan,
      () => undefined,
      new AbortController().signal,
    );
    deepStrictEqual(outcome, {
      kind: 'transferred',
      installFolder: '/home/alex/.fixture-server/bin/abc123',
    });
  });

  it('starts the server and gives its port, process and token', async () => {
    const steps = createServerSteps(dependencies());
    const outcome = await steps.start(
      INPUT,
      leaseOn(channelAnswering(STARTED)),
      HOST,
      false,
      new AbortController().signal,
    );
    deepStrictEqual(outcome.kind === 'started' ? outcome.server : outcome, {
      endpoint: {kind: 'port', port: 4321},
      processId: 77,
      connectionToken: 'abcdefghijklmnopqrstuvwxyz012345',
      reused: false,
    });
  });

  it('starts the server with the licence flag only when the gate cleared it', async () => {
    const steps = createServerSteps(dependencies());
    const withFlag = channelAnswering(STARTED);
    const without = channelAnswering(STARTED);
    await steps.start(
      INPUT,
      leaseOn(withFlag),
      HOST,
      true,
      new AbortController().signal,
    );
    await steps.start(
      INPUT,
      leaseOn(without),
      HOST,
      false,
      new AbortController().signal,
    );
    function scriptOf(channel: RecordingChannel): boolean {
      return channel.calls.some(
        call =>
          call.operation === 'runScript' &&
          call.request.script.includes('--accept-server-license-terms'),
      );
    }
    deepStrictEqual([scriptOf(withFlag), scriptOf(without)], [true, false]);
  });
});

describe('the server steps: validate and the names', () => {
  it('accepts the default install folder', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(steps.validate(INPUT), {kind: 'done', value: undefined});
  });

  it('fails an install folder the setting does not allow, as an invalid setting', () => {
    const steps = createServerSteps(
      dependencies({
        settings: settingsWith({serverInstallPath: {devbox: '/data/$HOME'}}),
      }),
    );
    deepStrictEqual(steps.validate(INPUT), {
      kind: 'failed',
      failure: {
        kind: 'invalidSetting',
        reason: {id: 'installPathProvided', values: ['/data/$HOME']},
      },
    });
  });

  it('F-2205 7.E1: a host that is an option name fails as an invalid setting', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({
        ...INPUT,
        target: {kind: 'plain', text: '-oProxyCommand=x'},
      }),
      targetFailure('S119', '-'),
    );
  });

  it('F-2205 BR-1: a host with a forbidden character names it', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({...INPUT, target: {kind: 'plain', text: 'a%b'}}),
      targetFailure('S120', '%'),
    );
  });

  it('F-2205 BR-1: a user that begins with a dash is reported', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({...INPUT, target: {kind: 'plain', text: '-u@h.invalid'}}),
      targetFailure('S121', '-'),
    );
  });

  it('F-2205 BR-1: a user with a backslash is reported', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({
        ...INPUT,
        target: {kind: 'plain', text: 'u\\x@h.invalid'},
      }),
      targetFailure('S122', '\\'),
    );
  });

  it('F-2205 BR-2: a bad user and a bad host report the host first', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({...INPUT, target: {kind: 'plain', text: '-u@-h'}}),
      targetFailure('S119', '-'),
    );
  });

  it('F-2205 BR-3: the first forbidden character in order is reported', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({
        ...INPUT,
        target: {kind: 'plain', text: "a%b'c"},
      }),
      targetFailure('S120', "'"),
    );
  });

  it('F-2205 BR-1, R-93: a control character is named by its code point', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({...INPUT, target: {kind: 'plain', text: 'a\nb'}}),
      targetFailure('S120', 'U+000A'),
    );
  });

  it('F-2205 BR-1: a structured target with a bad host name fails', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({
        ...INPUT,
        target: {kind: 'host', hostName: '-h', user: 'u'},
      }),
      targetFailure('S119', '-'),
    );
  });

  it('F-2205 POST-1: a good user, host and port pass the validate step', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({
        ...INPUT,
        target: {kind: 'plain', text: 'alex@dev:2222'},
      }),
      {kind: 'done', value: undefined},
    );
  });

  it('F-2205 BR-2: a bad host is reported before an invalid install folder', () => {
    const steps = createServerSteps(
      dependencies({
        settings: settingsWith({serverInstallPath: {devbox: '/data/$HOME'}}),
      }),
    );
    deepStrictEqual(
      steps.validate({
        ...INPUT,
        target: {kind: 'plain', text: '-oProxyCommand=x'},
      }),
      targetFailure('S119', '-'),
    );
  });

  it('F-2102: the default settings pass the connection check', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(steps.validate(INPUT), {kind: 'done', value: undefined});
  });

  it('F-2205 BR-2: a bad host is reported by the validate step', () => {
    const steps = createServerSteps(dependencies());
    deepStrictEqual(
      steps.validate({...INPUT, target: {kind: 'plain', text: '-h'}}),
      targetFailure('S119', '-'),
    );
  });

  it('names the data folder after the application when the product declares none', () => {
    const steps = createServerSteps(
      dependencies({
        profile: {...PROFILE, serverDataFolderName: ''},
      }),
    );
    const result = steps.plan(INPUT, HOST);
    deepStrictEqual(
      'plan' in result && result.plan.kind === 'download'
        ? result.plan.dataFolder
        : result,
      '/home/alex/.fixture-server',
    );
  });

  it('starts the launcher the profile names', async () => {
    const steps = createServerSteps(dependencies());
    const channel = channelAnswering(STARTED);
    await steps.start(INPUT, leaseOn(channel), HOST, false, NEVER_CANCELLED);
    deepStrictEqual(
      channel.calls.some(
        call =>
          call.operation === 'runScript' &&
          call.request.script.includes('bin/fixture-server'),
      ),
      true,
    );
  });
});

describe('the server steps: the default extensions', () => {
  it('installs the extensions the setting lists, over the lease', async () => {
    const steps = createServerSteps(
      dependencies({
        settings: settingsWith({defaultExtensions: ['publisher.name']}),
      }),
    );
    const channel = channelAnswering(
      lines('Ok', 'extension.publisher.name=installed'),
    );
    await steps.installExtensions(INPUT, leaseOn(channel), NEVER_CANCELLED);
    deepStrictEqual(
      channel.calls.some(
        call =>
          call.operation === 'runScript' &&
          call.request.script.includes('publisher.name'),
      ),
      true,
    );
  });

  it('runs nothing when the setting lists none', async () => {
    const steps = createServerSteps(dependencies());
    const channel = channelAnswering([]);
    await steps.installExtensions(INPUT, leaseOn(channel), NEVER_CANCELLED);
    deepStrictEqual(channel.calls.length, 0);
  });
});
