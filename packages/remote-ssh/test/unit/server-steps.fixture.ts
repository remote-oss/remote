/**
 * @fileoverview The fakes of the server steps' tests, shared with the tests of the connect's wiring: a product
 * profile, the settings of the host `devbox`, and the steps' dependencies with a store, a licence modal and a lock
 * loop that answer at once.
 */

import {RecordingChannel} from 'lib-host/testing/recording-channel';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {BASE_PLACEHOLDERS, type ProductProfile} from 'lib-product';
import {
  type AcceptanceStore,
  type HostLockLoop,
  type LicenceModal,
  type ModalAnswer,
  type ProbedHost,
  RESULT_BEGIN,
  RESULT_END,
  SSH_POLICY,
} from 'lib-server';
import {
  hostServerSettings,
  type HostServerSettings,
  type RawServerSettings,
} from '../../src/pipeline/host-settings.ts';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import type {ConnectSurfaces} from '../../src/connect-ports.ts';
import type {ServerStepDependencies} from '../../src/pipeline/server-steps.ts';
import type {ConnectionLease} from '../../src/pipeline/steps.ts';
import {SILENT_PROMPTS} from './pipeline.fixture.ts';

/** A product whose server is `fixture-server` at commit `abc123`. */
export const PROFILE: ProductProfile = {
  applicationName: 'fixture',
  version: '1.2.3',
  commit: 'abc123',
  quality: 'stable',
  release: '',
  serverApplicationName: 'fixture-server',
  serverDataFolderName: '.fixture-server',
  dataFolderName: '.fixture',
  tunnelApplicationName: 'fixture-tunnel',
  urlProtocol: 'fixture',
  serverDownloadUrlTemplate: '',
  updateUrl: '',
  downloadUrl: '',
  serverLicense: [],
  serverLicenseUrl: '',
};

/** The user's download override, from the default profile. */
const OVERRIDE = {
  value: 'https://example.invalid/server-${os}-${arch}-${commit}.tar.gz',
  layer: 'defaultProfileUser',
} as const;

/** A lock loop that runs its step once. */
function runOnce(step: Parameters<HostLockLoop>[0]): ReturnType<HostLockLoop> {
  return step();
}

/** A store that says what was asked and answers from a set of accepted keys. */
export function storeOf(accepted: readonly string[] = []): AcceptanceStore {
  return {
    isAccepted: storeKey => accepted.includes(storeKey),
    accept: () => Promise.resolve(),
  };
}

/** A licence modal that gives `answer` and records the terms it was asked about. */
export function modalAnswering(
  answer: ModalAnswer,
  asked: string[],
): LicenceModal {
  return {
    askUser: termsUrl => {
      asked.push(termsUrl);
      return Promise.resolve(answer);
    },
  };
}

/** The settings of the host `devbox`, with the raw values given changed. */
export function settingsWith(
  changes: Partial<RawServerSettings>,
): HostServerSettings {
  return hostServerSettings(
    {
      serverInstallPath: undefined,
      bindHost: undefined,
      serverPickPortsFromRange: undefined,
      httpProxy: '',
      httpsProxy: '',
      reconnectionGraceTime: null,
      defaultExtensions: undefined,
      useFlock: true,
      lockfilesInTmp: false,
      useCurlAndWgetConfigurationFiles: false,
      ...changes,
    },
    'devbox',
  );
}

/** The server steps' dependencies for `devbox`, with `changes` applied. */
export function dependencies(
  changes: Partial<ServerStepDependencies> = {},
): ServerStepDependencies {
  return {
    profile: PROFILE,
    policy: SSH_POLICY,
    settings: settingsWith({
      serverInstallPath: undefined,
      defaultExtensions: undefined,
    }),
    useExecServer: true,
    override: OVERRIDE,
    overridePolicy: {
      settingKey: 'remote.SSH.serverDownloadUrlTemplate',
      layers: ['defaultProfileUser'],
      acceptsBaseUrl: false,
      placeholders: BASE_PLACEHOLDERS,
    },
    remoteUser: () => 'alex',
    clock: () => 1700000000000,
    bounds: {downloadSeconds: 60, readySeconds: 20},
    store: storeOf(),
    modal: modalAnswering('accept', []),
    download: {
      fetch: () => Promise.reject(new Error('no download in this test')),
    } as unknown as ServerStepDependencies['download'],
    files: {} as unknown as ServerStepDependencies['files'],
    lockLoop: runOnce,
    clientFolder: '/tmp/client',
    archiveCache: {kind: 'none'},
    downloadBounds: {
      deadlineMilliseconds: 60_000,
      stallMilliseconds: 10_000,
      maximumBytes: 500_000_000,
    },
    newTemporaryToken: () => 'token',
    discardDeadlineMilliseconds: 50,
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    ...changes,
  };
}

/** The lines of a result block with the given status and facts. */
export function lines(status: string, ...facts: string[]): string[] {
  return [RESULT_BEGIN, `status=${status}`, ...facts, RESULT_END];
}

/** A channel whose one script prints `output` and exits cleanly. */
export function channelAnswering(output: readonly string[]): RecordingChannel {
  return new RecordingChannel({
    identity: 'devbox',
    platformHint: 'linux',
    scripts: [
      {
        interpreter: 'posixShell',
        matches: () => true,
        lines: output,
        ending: {kind: 'exit', status: 0},
      },
    ],
  });
}

/** A connection lease over `channel` that answers every other call at once. */
export function leaseOn(channel: RecordingChannel): ConnectionLease {
  return {
    channel,
    socksPort: 1080,
    storeSharedRecord: () => Promise.resolve(true),
    onNotice: () => () => undefined,
    answer: () => Promise.resolve(false),
    refuse: () => Promise.resolve(false),
    release: () => undefined,
  };
}

/** A Linux host of user `alex` with no server installed, as the probe reports it. */
export const HOST: ProbedHost = {
  operatingSystem: 'linux',
  architecture: 'x64',
  libc: 'glibc',
  release: 'debian',
  home: '/home/alex',
  temporaryFolder: '/tmp',
  loginShell: 'sh',
  tools: ['wget', 'tar'],
  busyboxWget: false,
  sshAuthSock: '',
  display: '',
  installed: false,
  installFolder: '/home/alex/.fixture-server/bin/abc123',
};

/** The connect's surfaces over `settings`, showing nothing and answering every question with no; `revealLog` counts. */
export function surfacesOf(
  settings: ConnectSurfaces['settings'],
  translate: ConnectSurfaces['translate'],
  revealLog: () => void,
): ConnectSurfaces {
  return {
    settings,
    translate,
    prompts: SILENT_PROMPTS,
    terminals: new RecordingTerminals(),
    pickPlatform: () => Promise.resolve(undefined),
    writePlatform: () => Promise.resolve(),
    licenceModal: modalAnswering('accept', []),
    acceptances: storeOf(),
    presenter: {present: () => Promise.resolve('handled')},
    revealLog,
  };
}
