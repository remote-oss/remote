import {deepStrictEqual, strictEqual} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLogger} from 'lib-log';
import {
  OVERRIDE_POLICIES,
  type OverridePolicy,
  type ProductProfile,
  readProfile,
  resolveServerArchive,
  serverDataFolderNameOrDefault,
} from 'lib-product';
import {
  downloadPortOf,
  kill,
  nodeClientFiles,
  plan,
  type Plan,
  probe,
  type ProbedHost,
  type ScriptParameters,
  sha256Of,
  SSH_POLICY,
  startOrReuse,
  type StartOutcome,
  transfer,
  type TransferOutcome,
  type TransferPhase,
} from 'lib-server';
import {startHost, type RunningHost} from './host-fixture.ts';
import {lockLoop, parametersFor, portOfStarted} from './support.ts';

const ENABLED = process.env.REMOTE_OSS_REAL_SERVER === '1';

const REPOSITORY = path.join(import.meta.dirname, '..', '..', '..');

/** The product the real server comes from: VSCodium's, as its reduced product.json says. */
const PRODUCT_FIXTURE = path.join(
  REPOSITORY,
  'packages',
  'lib-product',
  'test',
  'fixtures',
  'vscodium-reduced.json',
);

const CANCELLATION = new AbortController().signal;

/** The hosts a download of the VSCodium archive may meet; with these names unreachable the host cannot download. */
const DOWNLOAD_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
];

const MINUTE = 60_000;

/** Points the names a download meets at the host's own loopback, so that the host cannot download. */
function cutNetwork(host: RunningHost): void {
  host.asRoot(
    'sh',
    '-c',
    `printf '127.0.0.1 %s\\n' ${DOWNLOAD_HOSTS.join(' ')} >> /etc/hosts`,
  );
}

/** The download override policy of Remote - SSH. */
function overridePolicy(): OverridePolicy {
  const policy = OVERRIDE_POLICIES['remote-ssh'];
  if (policy === undefined) {
    throw new Error('no download override policy for remote-ssh');
  }
  return policy;
}

/**
 * Whether a transfer failed on a channel timeout: the one failure the host-download rows answer with an infrastructure
 * retry (athena's ruling on #420: a transient failure may re-run the install once, labelled; the product never
 * retries). The harness channel's bound is 60 s, and the host's download from the CDN normally ends in a few seconds,
 * so a timeout is a stalled or very slow connection. Any other failure, and a second timeout, is reported as it is.
 */
function timedOut(transferred: TransferOutcome): boolean {
  return (
    transferred.kind === 'failed' &&
    transferred.failure.kind === 'channelFailed' &&
    transferred.failure.failure.kind === 'timeout'
  );
}

interface Installation {
  phases: TransferPhase[];
  transferred: TransferOutcome;
  host: ProbedHost;
  parameters: ScriptParameters;
  plan: Extract<Plan, {kind: 'download'}>;
}

describe('F-2403 the real server on the Alpine host (VSCodium, musl)', function () {
  this.timeout(10 * MINUTE);
  let profile: ProductProfile;
  let archiveCache = '';
  let counter = 0;

  before(function () {
    if (!ENABLED) {
      this.skip();
    }
    const reading = readProfile(readFileSync(PRODUCT_FIXTURE, 'utf8'));
    if (reading.kind !== 'profile') {
      throw new Error(`unreadable product: ${reading.reason}`);
    }
    profile = reading.profile;
    archiveCache = mkdtempSync(path.join(tmpdir(), 'real-server-archives-'));
  });

  after(() => {
    rmSync(archiveCache, {recursive: true, force: true});
  });

  /** The archive in the cache for the product and the host's platform. */
  function cachedArchive(host: ProbedHost): string {
    return path.join(
      archiveCache,
      `${profile.applicationName}-reh-alpine-${host.architecture}-${profile.version}.tar.gz`,
    );
  }

  function parametersOf(): ScriptParameters {
    return parametersFor({
      dataFolderName: serverDataFolderNameOrDefault(profile),
      launcher: `bin/${profile.serverApplicationName}`,
      commit: profile.commit,
      archivePath: '',
      downloader: {useConfigurationFiles: false, timeoutSeconds: 120},
    });
  }

  /** Probes the host, plans the install as the SSH policy says, and transfers the archive. */
  async function install(host: RunningHost): Promise<Installation> {
    const parameters = parametersOf();
    const probed = await probe(host.channel, parameters, CANCELLATION);
    if (probed.kind !== 'probed') {
      throw new Error(`no probe: ${JSON.stringify(probed.failure)}`);
    }
    const platform = {
      operatingSystem: probed.host.libc === 'musl' ? 'alpine' : 'linux',
      architecture: probed.host.architecture,
    };
    const resolution = resolveServerArchive(
      profile,
      platform,
      overridePolicy(),
    );
    if (resolution.kind !== 'resolved') {
      throw new Error(`no archive: ${resolution.kind}`);
    }
    const planned = plan({
      facts: {
        operatingSystem: 'alpine',
        architecture: probed.host.architecture,
        homeFolder: probed.host.home,
        existingLayouts: [],
      },
      commit: profile.commit,
      serverDataFolderName: parameters.dataFolderName,
      launcher: parameters.launcher,
      installPathSetting: undefined,
      placement: SSH_POLICY.downloadPlacement,
      useExecServerSetting: false,
      source: {kind: 'resolved', address: resolution.address},
    });
    if ('failure' in planned || planned.plan.kind !== 'download') {
      throw new Error(`no download plan: ${JSON.stringify(planned)}`);
    }
    const phases: TransferPhase[] = [];
    const clientFolder = mkdtempSync(path.join(tmpdir(), 'real-server-'));
    counter += 1;
    const transferred = await transfer(
      {
        plan: planned.plan,
        parameters,
        clientFolder,
        cache: {kind: 'kept', archivePath: cachedArchive(probed.host)},
        downloadBounds: {
          deadlineMilliseconds: 5 * MINUTE,
          stallMilliseconds: MINUTE,
          maximumBytes: 500_000_000,
        },
        temporaryToken: `${String(process.pid)}-${String(counter)}`,
        verification: ['headerHash', 'lengthOnly'],
        hostFolder: probed.host.temporaryFolder,
        cancellation: CANCELLATION,
        discardDeadlineMilliseconds: 5000,
      },
      {
        channel: host.channel,
        download: downloadPortOf(fetch),
        files: nodeClientFiles,
        lockLoop: lockLoop(),
        logger: createLogger(undefined, {minimumLevel: () => 'info'}),
        onPhase: phase => phases.push(phase),
      },
    );
    rmSync(clientFolder, {recursive: true, force: true});
    return {
      phases,
      transferred,
      host: probed.host,
      parameters,
      plan: planned.plan,
    };
  }

  function start(
    host: RunningHost,
    parameters: ScriptParameters,
  ): Promise<StartOutcome> {
    return startOrReuse(
      host.channel,
      parameters,
      {
        bindHost: '127.0.0.1',
        portRange: '',
        licenceAccepted: true,
        graceSeconds: 0,
        defaultExtensions: [],
        fileWatcherPollingMilliseconds: 0,
        readySeconds: 120,
        socketMode: false,
      },
      [],
      {
        lockLoop: lockLoop(),
        logger: createLogger(undefined, {minimumLevel: () => 'info'}),
      },
      CANCELLATION,
    );
  }

  /** What the server of the host answers to `GET /version`: the commit it was built from. */
  function versionOf(host: RunningHost, port: number): string {
    return host
      .onHost('wget', '-qO-', `http://127.0.0.1:${String(port)}/version`)
      .trim();
  }

  function commitOfInstall(
    host: RunningHost,
    installation: Installation,
  ): string {
    const installFolder = `${installation.host.home}/${installation.parameters.dataFolderName}/bin/${installation.parameters.commit}`;
    const product = JSON.parse(
      host.onHost('cat', `${installFolder}/product.json`),
    ) as {commit: string};
    return product.commit;
  }

  function phaseKinds(installation: Installation): string[] {
    return [...new Set(installation.phases.map(phase => phase.kind))];
  }

  describe('a download on the host', () => {
    let host: RunningHost;
    let installation: Installation;
    let started: StartOutcome;

    before(async () => {
      host = await startHost();
      installation = await install(host);
      if (timedOut(installation.transferred)) {
        // an infrastructure retry, not a product one (athena's ruling on #420); see `timedOut`
        console.log(
          `      infrastructure retry: the host's download timed out (${JSON.stringify(installation.transferred)}); once more on a fresh host`,
        );
        host.stop();
        host = await startHost();
        installation = await install(host);
      }
      started = await start(host, installation.parameters);
    });

    after(() => {
      host.stop();
    });

    it('F-2403 AC-5: the host downloads the archive itself and unpacks it where the plan says', () => {
      deepStrictEqual(
        [
          installation.transferred.kind === 'failed'
            ? `failed: ${JSON.stringify(installation.transferred.failure)}`
            : installation.transferred.kind,
          phaseKinds(installation).includes('downloading'),
          phaseKinds(installation).includes('downloadingLocally'),
        ],
        ['transferred', true, false],
      );
    });

    it('contracts V4: the unpacked server has its folders and an executable launcher', () => {
      deepStrictEqual(
        host
          .onHost(
            'sh',
            '-c',
            `cd '${installation.plan.installFolder}' && ls | sort`,
          )
          .split('\n')
          .filter(name =>
            ['bin', 'extensions', 'node', 'out', 'product.json'].includes(name),
          ),
        ['bin', 'extensions', 'node', 'out', 'product.json'],
      );
    });

    it('F-2401 AC-2: the real server starts on musl and reports its port', () => {
      strictEqual(
        started.kind === 'started' && portOfStarted(started.server) > 0,
        true,
      );
    });

    it('F-3902 AC-1: the server answers with the commit it was built from', () => {
      strictEqual(
        started.kind === 'started'
          ? versionOf(host, portOfStarted(started.server))
          : started.kind,
        commitOfInstall(host, installation),
      );
    });

    it('F-2411: kill stops the server and removes the install', async () => {
      await kill(host.channel, installation.parameters, CANCELLATION);
      deepStrictEqual(
        host
          .onHost(
            'sh',
            '-c',
            `test -e '${installation.plan.installFolder}' && echo there || echo gone`,
          )
          .trim(),
        'gone',
      );
    });
  });

  describe('the host with its network cut', () => {
    let host: RunningHost;
    let installation: Installation;
    let started: StartOutcome;

    before(async () => {
      host = await startHost();
      cutNetwork(host);
      installation = await install(host);
      started = await start(host, installation.parameters);
    });

    after(() => {
      host.stop();
    });

    it('F-2403 AC-11: the host cannot download, so the client downloads and the archive is copied to the host', () => {
      deepStrictEqual(
        [
          installation.transferred.kind,
          phaseKinds(installation).filter(kind => kind !== 'progress'),
        ],
        [
          'transferred',
          ['downloading', 'downloadingLocally', 'copying', 'installing'],
        ],
      );
    });

    it('F-3902 AC-1: the archive the client kept is the one the product published', async () => {
      const published = await fetch(`${installation.plan.address}.sha256`, {
        signal: AbortSignal.timeout(30_000),
      });
      const expected = (await published.text()).trim().split(/\s+/)[0];
      strictEqual(await sha256Of(cachedArchive(installation.host)), expected);
    });

    it('contracts V4: the copy on the host is gone after the install', () => {
      deepStrictEqual(
        host.onHost('sh', '-c', "ls /tmp | grep -c '^server-' || true").trim(),
        '0',
      );
    });

    it('F-2403 AC-11: the server installed from the copy starts and answers with its commit', () => {
      strictEqual(
        started.kind === 'started'
          ? versionOf(host, portOfStarted(started.server))
          : started.kind,
        commitOfInstall(host, installation),
      );
    });
  });

  describe('a second host with its network cut and the archive already kept', () => {
    let host: RunningHost;
    let installation: Installation;

    before(async () => {
      // A first host leaves the archive in the cache, whatever ran before this suite.
      const first = await startHost();
      try {
        cutNetwork(first);
        await install(first);
      } finally {
        first.stop();
      }
      host = await startHost();
      cutNetwork(host);
      installation = await install(host);
    });

    after(() => {
      host.stop();
    });

    it('F-6301.BR-4: the kept archive is used without a download on the client', () => {
      deepStrictEqual(
        [
          installation.transferred.kind,
          phaseKinds(installation).includes('downloadingLocally'),
        ],
        ['transferred', false],
      );
    });

    it('F-6301.BR-4: the kept archive is still in the cache afterwards', async () => {
      strictEqual(
        await nodeClientFiles.exists(cachedArchive(installation.host)),
        true,
      );
    });
  });
});
