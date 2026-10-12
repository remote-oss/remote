/**
 * @fileoverview The fakes of the connect pipeline's tests: a target, a host, plans, the steps over a recording, and
 * the lease and tunnel they hand out.
 */

import type {ChannelFailure, HostChannel} from 'lib-host';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {Plan, ProbedHost, StartOutcome, TransferOutcome} from 'lib-server';
import type {ConnectionNotice, SharedRecord} from 'lib-ssh';
import type {ConnectOptions, PhaseEvent} from '../../src/pipeline/connect.ts';
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

const HOST: ProbedHost = {
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
};

const DOWNLOAD: Plan = {
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

/** The steps' calls in order, the lease releases, and the phases the window saw. */
export interface Recording {
  /** The listener the lease's `onNotice` was given last, for a test to send notices through. */
  notice?: (notice: ConnectionNotice) => void;
  calls: string[];
  releases: number;
  tunnelCloses: number;
  records: SharedRecord[];
  phases: PhaseEvent[];
}

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
  tunnelFeatures: {elevation: false},
};

/** The tunnel a step opens, counting its close in the recording. */
export function tunnelOf(
  recording: Recording,
  opened: TunnelOpening['opened'] = OPENED,
): TunnelOpening {
  return {
    opened,
    close: () => {
      recording.tunnelCloses += 1;
    },
  };
}

/** The lease a step hands out, counting its release and the records it stores in the recording. */
export function leaseOf(recording: Recording): ConnectionLease {
  return {
    channel: {} as unknown as HostChannel,
    socksPort: 1080,
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
    validate: () => note('validate', {kind: 'done', value: undefined}),
    preconnect: () =>
      Promise.resolve(note('preconnect', {kind: 'done', value: undefined})),
    locateClient: () =>
      Promise.resolve(note('locateClient', {kind: 'done', value: WAITS})),
    decideTerms: () =>
      Promise.resolve(note('decideTerms', {kind: 'done', value: TERMS})),
    openConnection: () =>
      Promise.resolve(note('openConnection', {kind: 'done', value: lease})),
    probe: () => Promise.resolve(note('probe', {kind: 'probed', host: HOST})),
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
    installExtensions: () => {
      note('installExtensions', undefined);
      return Promise.resolve();
    },
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

/** An empty recording and the options of one connect that record its phases. */
export function setup(): {recording: Recording; options: ConnectOptions} {
  const recording: Recording = {
    calls: [],
    releases: 0,
    tunnelCloses: 0,
    records: [],
    phases: [],
  };
  return {
    recording,
    options: {
      cancellation: new AbortController().signal,
      onPhase: event => {
        recording.phases.push(event);
      },
      maximumReconnectionAttempts: null,
      preconnectMilliseconds: 1000,
      logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
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
