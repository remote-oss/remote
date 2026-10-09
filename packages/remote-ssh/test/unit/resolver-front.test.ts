import {deepStrictEqual} from 'node:assert';
import type {
  Connected,
  ConnectInput as ResolverInput,
  DecodedTarget,
  Failed,
} from 'lib-authority';
import type {ConnectionNotice} from 'lib-ssh';
import {createLogger} from 'lib-log';
import type {Connection, ConnectOptions} from '../../src/pipeline/connect.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {createSshConnector} from '../../src/surfaces/connector.ts';
import {
  displayHostOf,
  progressTitle,
} from '../../src/surfaces/progress-titles.ts';
import {sshResolverOptions} from '../../src/surfaces/resolver-front.ts';

const CONNECTED: Connected = {
  address: {host: '127.0.0.1', port: 4000},
  connectionToken: 'token',
  extensionHostEnv: {},
  environmentTunnels: [],
  tunnelFeatures: {},
  tunnelFactory: undefined,
  trusted: false,
};

const FAILED: Failed = {
  kind: 'unreachable',
  retryable: false,
  silent: false,
  userAlreadyNotified: false,
  hints: [],
  diagnostics: [],
};

const INPUT: ResolverInput = {
  target: {kind: 'host', hostName: 'box'},
  rawHostString: 'box',
  attempt: 1,
  isReconnection: false,
  windowId: 'window-1',
  windowWorkspace: undefined,
};

function decoded(target: DecodedTarget['target']): DecodedTarget {
  return {family: 'ssh-remote', target, rawHostString: 'raw'};
}

const NO_OPTIONS: Pick<
  ConnectOptions,
  'maximumReconnectionAttempts' | 'limits' | 'logger'
> = {
  maximumReconnectionAttempts: 5,
  limits: {
    preconnectMilliseconds: 1,
    probeMilliseconds: 1,
    tunnelMilliseconds: 1,
  },
  logger: createLogger(undefined, {minimumLevel: () => 'info'}),
};

/** What one run of the stubbed pipeline saw. */
interface Run {
  input: ConnectInput;
  options: ConnectOptions;
}

/** A connector over a pipeline that answers as told and records what it was given. */
function setup(answer: () => Connection | Failed) {
  const runs: Run[] = [];
  const released: number[] = [];
  const revealed: string[] = [];
  const connector = createSshConnector({
    runPipeline: (input, options) => {
      runs.push({input, options});
      options.onPhase({kind: 'initializing'});
      options.onPhase({kind: 'serverDownloadPercent', percent: 40});
      return Promise.resolve(answer());
    },
    optionsFor: () => NO_OPTIONS,
    revealLog: () => {
      revealed.push('revealed');
    },
  });
  return {connector, runs, released, revealed};
}

function connectionOf(released: number[]): Connection {
  return {
    connected: CONNECTED,
    release: () => {
      released.push(released.length + 1);
    },
  };
}

describe('the progress title (F-2304)', () => {
  const alias = decoded({kind: 'host', hostName: 'my-alias'});

  it('F-2304: the title names the host and the phase', () => {
    deepStrictEqual(
      progressTitle({name: 'installing'}, alias, template => template),
      'Setting up SSH Host my-alias: Installing VS Code Server',
    );
  });

  it('F-2304: before any phase the title is the first phase', () => {
    deepStrictEqual(
      progressTitle(undefined, alias, template => template),
      'Setting up SSH Host my-alias: Initializing VS Code Server',
    );
  });

  it('F-2304: the percent of a download does not change the message', () => {
    deepStrictEqual(
      progressTitle(
        {name: 'serverDownloadPercent', percent: 50},
        alias,
        template => template,
      ),
      'Setting up SSH Host my-alias: Downloading VS Code Server',
    );
  });

  it('F-2304: every phase has its message in the display language', () => {
    deepStrictEqual(
      [
        'downloading',
        'downloadingLocally',
        'copyingWithScp',
        'settingUpTunnel',
        'waitingForForwarding',
      ].map(name =>
        progressTitle(
          {name: name as 'downloading'},
          alias,
          template => `(${template})`,
        ),
      ),
      [
        '(Setting up SSH Host {0}: {1})'
          .replace('{0}', 'my-alias')
          .replace('{1}', '(Downloading VS Code Server)'),
        '(Setting up SSH Host {0}: {1})'
          .replace('{0}', 'my-alias')
          .replace('{1}', '(Downloading VS Code Server locally)'),
        '(Setting up SSH Host {0}: {1})'
          .replace('{0}', 'my-alias')
          .replace('{1}', '(Copying VS Code Server to host with scp)'),
        '(Setting up SSH Host {0}: {1})'
          .replace('{0}', 'my-alias')
          .replace('{1}', '(Setting up SSH tunnel)'),
        '(Setting up SSH Host {0}: {1})'
          .replace('{0}', 'my-alias')
          .replace('{1}', '(Waiting for port forwarding to be ready)'),
      ],
    );
  });
});

describe('the host the progress names (F-2304.BR-5)', () => {
  it('F-2304.BR-5: a configured host is its alias, without the user or the port', () => {
    deepStrictEqual(
      displayHostOf(
        decoded({kind: 'host', hostName: 'my-alias', user: 'u', port: 2222}),
      ),
      'my-alias',
    );
  });

  it('F-2304.BR-5: a typed user@host:port is the bare host name', () => {
    deepStrictEqual(
      displayHostOf(decoded({kind: 'plain', text: 'user@box.example:2222'})),
      'box.example',
    );
  });

  it('F-2304.BR-5: a typed host with no user and no port is itself', () => {
    deepStrictEqual(
      displayHostOf(decoded({kind: 'plain', text: 'box'})),
      'box',
    );
  });

  it('F-2304.BR-5: an address with several colons keeps them', () => {
    deepStrictEqual(
      displayHostOf(decoded({kind: 'plain', text: 'u@2001:db8::1'})),
      '2001:db8::1',
    );
  });

  it('F-2304.BR-5: a target that is not an SSH one names no host', () => {
    deepStrictEqual(displayHostOf(decoded({distro: 'Ubuntu'})), '');
  });
});

describe('the SSH resolver options', () => {
  const options = sshResolverOptions({
    connector: setup(() => FAILED).connector,
    presenter: {present: () => Promise.resolve('handled')},
    translate: template => template,
  });

  it('F-2304.BR-2: the progress is not cancellable', () => {
    deepStrictEqual(options.cancellable, false);
  });

  it('F-2501: the resolver is for the ssh-remote family', () => {
    deepStrictEqual(options.family, 'ssh-remote');
  });

  it('F-2304: the start title and the titles of the phases name the host', () => {
    const target = decoded({kind: 'host', hostName: 'box'});
    deepStrictEqual(
      [
        options.startTitle(target),
        options.titleOf({name: 'installing'}, target),
      ],
      [
        'Setting up SSH Host box: Initializing VS Code Server',
        'Setting up SSH Host box: Installing VS Code Server',
      ],
    );
  });

  it('F-2501: a connection the connector calls trusted is not passed on as trusted', () => {
    deepStrictEqual(options.allowsTrust, false);
  });
});

describe('the SSH connector', () => {
  it('F-2501: a connect that works gives the connection to the window', async () => {
    const context = setup(() => connectionOf([]));
    deepStrictEqual(await context.connector.connect(INPUT), CONNECTED);
  });

  it('F-2501: a connect that fails gives the failure', async () => {
    const context = setup(() => FAILED);
    deepStrictEqual(await context.connector.connect(INPUT), FAILED);
  });

  it('F-2501: the pipeline is given the window and the host as the resolver has them', async () => {
    const context = setup(() => FAILED);
    await context.connector.connect(INPUT);
    deepStrictEqual(context.runs[0]?.input, {
      target: {kind: 'host', hostName: 'box'},
      rawHostString: 'box',
      attempt: 1,
      isReconnection: false,
      windowId: 'window-1',
      windowWorkspace: undefined,
    });
  });

  it('F-2304: the phases of the pipeline reach the listeners, with the percent of a download', async () => {
    const context = setup(() => FAILED);
    const heard: unknown[] = [];
    context.connector.onPhase(phase => heard.push(phase));
    await context.connector.connect(INPUT);
    deepStrictEqual(heard, [
      {name: 'initializing'},
      {name: 'serverDownloadPercent', percent: 40},
    ]);
  });

  it('F-2304: a listener that was removed hears nothing more', async () => {
    const context = setup(() => FAILED);
    const heard: unknown[] = [];
    const stop = context.connector.onPhase(phase => heard.push(phase));
    stop();
    await context.connector.connect(INPUT);
    deepStrictEqual(heard, []);
  });

  it('F-2501: a target of another family is a failure of the connector, not a crash', async () => {
    const context = setup(() => FAILED);
    const outcome = await context.connector.connect({
      ...INPUT,
      target: {distro: 'Ubuntu'},
    });
    deepStrictEqual(
      [(outcome as Failed).kind, (outcome as Failed).reason],
      ['unknown', {text: 'not an SSH target'}],
    );
  });

  it('F-2304: revealing the details shows the log', () => {
    const context = setup(() => FAILED);
    context.connector.revealDetails();
    deepStrictEqual(context.revealed, ['revealed']);
  });

  it('F-2501: a new connect gives the earlier connection back first', async () => {
    const released: number[] = [];
    const context = setup(() => connectionOf(released));
    await context.connector.connect(INPUT);
    await context.connector.connect(INPUT);
    deepStrictEqual(released, [1]);
  });

  it('F-2304.BR-8: cancelling ends the signal the pipeline was given', async () => {
    const context = setup(() => FAILED);
    await context.connector.connect(INPUT);
    context.connector.cancel();
    deepStrictEqual(context.runs[0]?.options.cancellation.aborted, true);
  });

  it('F-2304.BR-8: cancelling gives the connection back, once', async () => {
    const released: number[] = [];
    const context = setup(() => connectionOf(released));
    await context.connector.connect(INPUT);
    context.connector.cancel();
    context.connector.cancel();
    deepStrictEqual(released, [1]);
  });

  it('F-2304.BR-8: cancelling before any connect does nothing', () => {
    const context = setup(() => FAILED);
    context.connector.cancel();
    deepStrictEqual(context.runs, []);
  });

  it('F-8201: a lost transport reaches the listeners of the host', () => {
    const context = setup(() => FAILED);
    let lost = 0;
    context.connector.onTransportLost(() => {
      lost += 1;
    });
    context.connector.hear({type: 'transportLost'});
    deepStrictEqual(lost, 1);
  });

  it('F-8201: a helper that is gone is a closed transport', () => {
    const context = setup(() => FAILED);
    let closed = 0;
    context.connector.onTransportClosed(() => {
      closed += 1;
    });
    context.connector.hear({type: 'helperGone'});
    deepStrictEqual(closed, 1);
  });

  it('F-8201: the other notices change nothing', () => {
    const context = setup(() => FAILED);
    let heard = 0;
    context.connector.onTransportLost(() => {
      heard += 1;
    });
    context.connector.onTransportClosed(() => {
      heard += 1;
    });
    for (const notice of [
      {type: 'waitingForOtherWindow'},
      {type: 'ownerChanged', owner: 1},
    ] satisfies ConnectionNotice[]) {
      context.connector.hear(notice);
    }
    deepStrictEqual(heard, 0);
  });
});
