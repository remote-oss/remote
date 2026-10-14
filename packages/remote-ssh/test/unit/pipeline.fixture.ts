/**
 * @fileoverview The fakes of the connect pipeline's tests: a target, a host, plans, the steps over a recording, and
 * the lease and tunnel they hand out.
 */

import type {Failed} from 'lib-authority';
import type {ChannelFailure, HostChannel} from 'lib-host';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {Plan, ProbedHost, StartOutcome, TransferOutcome} from 'lib-server';
import {
  fakeCli,
  type CliScript,
  type FakeCli,
} from 'lib-server/testing/fake-cli';
import type {CliBridgeLoss} from '../../src/cli/cli-bridge.ts';
import type {DownloadProgressPort} from '../../src/cli/server-download-progress.ts';
import type {AgentLinkPlan} from '../../src/environment/agent-link.ts';
import type {ForwardingPlans} from '../../src/environment/forwarding.ts';
import type {ConnectionNotice, SharedRecord} from 'lib-ssh';
import type {ConnectOptions, PhaseEvent} from '../../src/pipeline/connect.ts';
import type {PromptEditor} from '../../src/surfaces/prompt-surface.ts';
import type {
  ConnectInput,
  ConnectionLease,
  ConnectionTerms,
  ConnectSteps,
  ConnectWaits,
  TunnelOpening,
} from '../../src/pipeline/steps.ts';

/** A first connect of window 1 to the plain host `dev`. */
export const INPUT: ConnectInput = {
  target: {kind: 'plain', text: 'dev'},
  rawHostString: 'dev',
  attempt: 1,
  isReconnection: false,
  windowId: 'window-1',
  windowWorkspace: undefined,
};

/** The host every connect of the fixture probes. */
export const HOST: ProbedHost = {
  operatingSystem: 'linux',
  architecture: 'x64',
  libc: 'glibc',
  release: 'debian',
  home: '/home/dev',
  temporaryFolder: '/tmp',
  loginShell: 'sh',
  tools: ['wget', 'tar'],
  busyboxWget: false,
  sshAuthSock: '',
  display: '',
  installed: false,
  installFolder: '/home/dev/.server/bin/abc',
  treeComplete: false,
};

/** The plan of a server that is not on the host: a download. */
export const DOWNLOAD: Plan = {
  kind: 'download',
  where: 'host',
  clientFallback: true,
  address: 'https://example.invalid/server.tar.gz',
  installFolder: '/home/dev/.server/bin/abc',
  dataFolder: '/home/dev/.server',
  launcher: 'bin/launcher',
  lockPlace: 'folder',
  notes: [],
} as unknown as Plan;

/** A plan that reuses the server already installed on the host. */
export const REUSE: Plan = {
  kind: 'reuse',
  layout: {kind: 'bin', commit: 'abc', path: '/home/dev/.server/bin/abc'},
  dataFolder: '/home/dev/.server',
  launcher: 'bin/launcher',
  lockPlace: 'folder',
  notes: [],
} as unknown as Plan;

/** A server started on port 4321, not reused. */
export const STARTED = {
  kind: 'started',
  server: {
    endpoint: {kind: 'port', port: 4321},
    processId: 77,
    connectionToken: 'secret-token',
    reused: false,
  },
  notices: [],
} satisfies StartOutcome;

/** A CLI that started and listens on its own port of the host. */
const CLI_STARTED = {
  kind: 'started',
  server: {
    endpoint: {kind: 'port', port: 5432},
    processId: 88,
    connectionToken: 'host-connection-token',
    reused: false,
  },
  notices: [],
} satisfies StartOutcome;

/** The steps' calls in order, the lease releases, and the phases the window saw. */
export interface Recording {
  /** The listener the lease's `onNotice` was given last, for a test to send notices through. */
  notice?: (notice: ConnectionNotice) => void;
  /** The listener the tunnel's `onClosed` was given last, for a test to end the tunnel through. */
  tunnelClosed?: (detail: string) => void;
  calls: string[];
  releases: number;
  tunnelCloses: number;
  records: SharedRecord[];
  phases: PhaseEvent[];
  /** The fake CLI the last control connection reached. */
  program?: FakeCli;
  /** The listener the bridge's `onLost` was given last, for a test to end the bridge through. */
  bridgeLost?: (cause: CliBridgeLoss) => void;
  /** The failures shown after the window resolved. */
  presented: Failed[];
  /** How many secrets the steps made: the n-th is `secret-<n>`. */
  secrets: number;
  /** The agent link plans the connect started a link for, in order. */
  links: AgentLinkPlan[];
}

/** The plans of a connect whose session forwards an agent and a display. */
export const LINKED: ForwardingPlans = {
  agentLink: {
    kind: 'link',
    linkPath: '/tmp/vscode-ssh-auth-sock-42',
    target: '/tmp/ssh-x/agent.1',
  },
  display: {kind: 'display', value: 'localhost:10.0'},
};

/** The plans of a connect whose settings turn both forwardings off. */
export const NO_FORWARDING: ForwardingPlans = {
  agentLink: {kind: 'none', reason: 'settingOff'},
  display: {kind: 'none', reason: 'settingOff'},
};

/** The error a CLI that requires its token gives to another token. */
const BAD_TOKEN = 'CodeError(AuthChallengeBadToken)';

/** The control token of a connect over the fixture's steps: its first secret. */
export const CONTROL_TOKEN = 'secret-1';

/** A CLI that requires `token`: the challenge with any other is refused, and every `serve` succeeds. */
export function requiringToken(token: string): CliScript {
  return request => {
    if (request.method === 'challenge_issue') {
      return (request.params as {token: string}).token === token
        ? [{id: request.id, result: {challenge: 'challenge-text'}}]
        : [{id: request.id, error: {code: -1, message: BAD_TOKEN}}];
    }
    return [{id: request.id, result: {}}];
  };
}

/** The bridge the fixture's `openBridge` gives: its listener's address. */
export const BRIDGE_ADDRESS = {host: '127.0.0.1', port: 51000} as const;

/** Terms decided before ssh runs: the platform still unknown, no remote command. */
export const TERMS: ConnectionTerms = {
  platform: 'unknown',
  remoteCommandInEffect: false,
};

/** The waits a located client gives: a second each for the probe and the tunnel. */
export const WAITS: ConnectWaits = {
  probeMilliseconds: 1000,
  tunnelMilliseconds: 1000,
};

/** A located client whose host gives `waits`. */
export function waitsOf(waits: ConnectWaits): ConnectSteps['locateClient'] {
  return () => Promise.resolve({kind: 'done', value: waits});
}

/** The window tunnel's address and the facts it gives the window. */
export const OPENED = {
  address: {host: '127.0.0.1', port: 50000},
  extensionHostEnv: {FLAG: 'yes'},
  environmentTunnels: [],
};

/** The tunnel a step opens, counting its close in the recording, with its end kept for a test. */
export function tunnelOf(
  recording: Recording,
  opened: TunnelOpening['opened'] = OPENED,
): TunnelOpening {
  return {
    opened,
    close: () => {
      recording.tunnelCloses += 1;
    },
    onClosed: listener => {
      recording.tunnelClosed = listener;
    },
  };
}

/** Ends the fixture tunnel without being asked to, the way a failed listener would. */
export function endTunnel(recording: Recording, detail: string): void {
  recording.tunnelClosed?.(detail);
}

/** The lease a step hands out, counting its release and the records it stores in the recording. */
export function leaseOf(recording: Recording): ConnectionLease {
  return {
    channel: {} as unknown as HostChannel,
    socksPort: 1080,
    storedRecord: undefined,
    storeSharedRecord: record => {
      recording.records.push(record);
      return Promise.resolve(true);
    },
    onNotice: listener => {
      recording.notice = listener;
      return () => {
        delete recording.notice;
      };
    },
    answer: () => Promise.resolve(false),
    refuse: () => Promise.resolve(false),
    release: () => {
      recording.releases += 1;
    },
  };
}

/** The steps of a connect that works, recording each call; `changes` replaces some of them. */
export function steps(
  recording: Recording,
  changes: Partial<ConnectSteps> = {},
): ConnectSteps {
  const lease = leaseOf(recording);
  function note<Value>(name: string, value: Value): Value {
    recording.calls.push(name);
    return value;
  }
  return {
    checkStartSettings: () =>
      note('checkStartSettings', {kind: 'done', value: undefined}),
    validate: () => note('validate', {kind: 'done', value: undefined}),
    checkInstallFolder: () =>
      note('checkInstallFolder', {kind: 'done', value: undefined}),
    preconnect: () =>
      Promise.resolve(note('preconnect', {kind: 'done', value: undefined})),
    locateClient: () =>
      Promise.resolve(note('locateClient', {kind: 'done', value: WAITS})),
    decideTerms: () =>
      Promise.resolve(note('decideTerms', {kind: 'done', value: TERMS})),
    openConnection: () =>
      Promise.resolve(note('openConnection', {kind: 'done', value: lease})),
    probe: () => Promise.resolve(note('probe', {kind: 'probed', host: HOST})),
    planForwarding: () => Promise.resolve(NO_FORWARDING),
    linkAgent: (lease, plan) => {
      recording.links.push(plan);
    },
    plan: () => note('plan', {plan: DOWNLOAD}),
    gate: () =>
      Promise.resolve(
        note('gate', {
          kind: 'cleared',
          acceptanceFlag: true,
          remembered: true,
        }),
      ),
    transfer: () =>
      Promise.resolve(
        note<TransferOutcome>('transfer', {
          kind: 'transferred',
          installFolder: '/home/dev/.server/bin/abc',
        }),
      ),
    start: () => Promise.resolve(note('start', STARTED)),
    installCli: () =>
      Promise.resolve(
        note('installCli', {
          kind: 'placed' as const,
          path: '/home/dev/.server/fixture-abc',
        }),
      ),
    startCli: () => Promise.resolve(note('startCli', CLI_STARTED)),
    stopCli: (input, lease, host, plan, processId) => {
      note(`stopCli ${String(processId)}`, undefined);
      return Promise.resolve();
    },
    connectControl: () => {
      const program = fakeCli(requiringToken(CONTROL_TOKEN));
      recording.program = program;
      return Promise.resolve(note('connectControl', program.stream));
    },
    openBridge: () =>
      Promise.resolve(
        note('openBridge', {
          address: BRIDGE_ADDRESS,
          onLost: listener => {
            recording.bridgeLost = listener;
          },
          close: () => {
            recording.calls.push('closeBridge');
          },
        }),
      ),
    newSecret: () => {
      recording.secrets += 1;
      return `secret-${String(recording.secrets)}`;
    },
    presentLateFailure: failed => {
      recording.presented.push(failed);
    },
    maintain: (input, lease, action) => {
      note(action, undefined);
      return Promise.resolve({kind: 'done'});
    },
    installExtensions: () => {
      note('installExtensions', undefined);
      return Promise.resolve();
    },
    tunnelPath: () => 'socks',
    openTunnel: () =>
      Promise.resolve(
        note('openTunnel', {kind: 'done', value: tunnelOf(recording)}),
      ),
    rememberPlatform: () => {
      note('rememberPlatform', undefined);
      return Promise.resolve();
    },
    ...changes,
  };
}

/** A recording with nothing in it yet. */
export function emptyRecording(): Recording {
  return {
    calls: [],
    releases: 0,
    tunnelCloses: 0,
    records: [],
    phases: [],
    presented: [],
    secrets: 0,
    links: [],
  };
}

/** An empty recording and the options of one connect that record its phases, with the sink its log writes to. */
export function setup(): {
  recording: Recording;
  options: ConnectOptions;
  logSink: MemorySink;
} {
  const logSink = new MemorySink();
  const recording = emptyRecording();
  return {
    recording,
    logSink,
    options: {
      cancellation: new AbortController().signal,
      onPhase: event => {
        recording.phases.push(event);
      },
      maximumReconnectionAttempts: null,
      preconnectMilliseconds: 1000,
      logger: createLogger(logSink, {minimumLevel: () => 'info'}),
      serve: {commit: 'c1', quality: 'insider'},
      useExecServer: true,
    },
  };
}

/** A promise that never settles, for a step that hangs. */
export function never<Value>(): Promise<Value> {
  return new Promise<Value>(() => undefined);
}

/** A tunnel step that fails with a closed channel. */
export function tunnelFails(): ReturnType<ConnectSteps['openTunnel']> {
  return Promise.resolve({
    kind: 'failed',
    failure: {kind: 'channelClosed', reason: {text: 'gone'}},
  });
}

/** A failure of the host channel: it closed. */
export const CHANNEL_CLOSED: ChannelFailure = {
  kind: 'channelClosed',
  detail: 'gone',
};

/** Download notifications that show nothing. */
export const SILENT_PROGRESS: DownloadProgressPort = {
  show: () => ({report: () => undefined, close: () => undefined}),
};

/** A prompt editor that shows nothing: every question is dismissed at once. */
export const SILENT_PROMPTS: PromptEditor = {
  pick: () => Promise.resolve(undefined),
  maskedInput: () => Promise.resolve(undefined),
  translate: template => template,
};
