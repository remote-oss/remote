import {deepStrictEqual} from 'node:assert';
import {type ChildProcess, spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLogger} from 'lib-log';
import {
  downloadPortOf,
  nodeClientFiles,
  plan,
  probe,
  type ProbedHost,
  type ScriptParameters,
  transfer,
  type TransferInput,
  type TransferOutcome,
  type TransferPhase,
} from 'lib-server';
import {startHost, type RunningHost} from './host-fixture.ts';
import {STAND_IN_LAUNCHER} from './stand-in-server.ts';
import {
  freePort,
  installFolderOf,
  lockLoop,
  parametersFor,
  placeStandInArchive,
} from './support.ts';
import {
  bridgeGateway,
  type DownloadHost,
  makeCertificate,
  startDownloadHost,
} from '../../../tools/acceptance-downloads.ts';
import {runCommand} from '../../../tools/command-runner.ts';
import {fetchVariantsToRun} from '../../../tools/host-variants.ts';

const CANCELLATION = new AbortController().signal;

/** The port on the host where the stand-in archive is served, and the same port on this machine through a forward. */
const SOURCE_PORT = 8099;

/** Where the archive lies on the host, as `placeStandInArchive` puts it. */
const ARCHIVE_ON_HOST = '/tmp/stand-in-serving-wrapped.tar.gz';

/** The serving loop: BusyBox `nc` answers each connection with the archive and its length. */
const SERVING_LOOP = `while true; do
  { printf 'HTTP/1.0 200 OK\\r\\nContent-Length: %s\\r\\n\\r\\n' "$(wc -c <${ARCHIVE_ON_HOST})"; cat ${ARCHIVE_ON_HOST}; } |
    nc -l -p ${String(SOURCE_PORT)} -s 127.0.0.1 >/dev/null 2>&1
done`;

const MINUTE = 60_000;

/** A `~/.wgetrc` that sends every request to a port nothing listens on. */
const WGETRC =
  'use_proxy = on\nhttp_proxy = http://127.0.0.1:9/\nno_proxy = none\n';

/** A `~/.curlrc` that does the same. */
const CURLRC = 'proxy = 127.0.0.1:9\n';

/** What a transfer did: its outcome, and the phases it reported. */
interface Transferred {
  outcome: TransferOutcome;
  phases: TransferPhase[];
}

/** The way a transfer is asked to run. */
interface Options {
  useConfigurationFiles?: boolean;
  clientFallback?: boolean;
  /** The address the client downloads from, when the host's download is not the one under test. */
  clientAddress?: string;
}

/** The program's path on the host, or an empty text. */
function whereIs(host: RunningHost, program: string): string {
  return host.onHost('sh', '-c', `command -v ${program} || true`).trim();
}

/** The tools the host's probe lists, and whether its `wget` is BusyBox's. */
async function probed(host: RunningHost): Promise<ProbedHost> {
  const outcome = await probe(host.channel, parametersFor(), CANCELLATION);
  if (outcome.kind !== 'probed') {
    throw new Error(`no probe: ${JSON.stringify(outcome.failure)}`);
  }
  return outcome.host;
}

/** Downloads the stand-in archive to the host's install folder, the way the extension does. */
async function installFrom(
  host: RunningHost,
  address: string,
  options: Options = {},
): Promise<{parameters: ScriptParameters} & Transferred> {
  const parameters = parametersFor({
    archivePath: '',
    downloader: {
      useConfigurationFiles: options.useConfigurationFiles ?? false,
      timeoutSeconds: 20,
    },
  });
  const facts = await probed(host);
  const planned = plan({
    facts: {
      operatingSystem: 'alpine',
      architecture: facts.architecture,
      homeFolder: facts.home,
      existingLayouts: [],
    },
    commit: parameters.commit,
    serverDataFolderName: parameters.dataFolderName,
    launcher: parameters.launcher,
    installPathSetting: undefined,
    placement: {
      kind: 'hostFirst',
      mode: options.clientFallback === true ? 'auto' : 'off',
    },
    useExecServerSetting: false,
    source: {kind: 'resolved', address, redirect: {kind: 'any'}},
  });
  if ('failure' in planned || planned.plan.kind !== 'download') {
    throw new Error(`no download plan: ${JSON.stringify(planned)}`);
  }
  const clientFolder = mkdtempSync(path.join(tmpdir(), 'fetch-tools-'));
  const phases: TransferPhase[] = [];
  const input: TransferInput = {
    plan: planned.plan,
    parameters,
    clientFolder,
    cache: {kind: 'none'},
    downloadBounds: {
      deadlineMilliseconds: MINUTE,
      stallMilliseconds: MINUTE,
      maximumBytes: 10_000_000,
    },
    temporaryToken: String(process.pid),
    verification: ['lengthOnly'],
    hostFolder: facts.temporaryFolder,
    cancellation: CANCELLATION,
    discardDeadlineMilliseconds: 5000,
  };
  try {
    const outcome = await transfer(input, {
      channel: host.channel,
      credentials: {readNetrc: () => Promise.resolve(undefined)},
      download: downloadPortOf((address, init) => fetch(address, init)),
      files: nodeClientFiles,
      lockLoop: lockLoop(),
      logger: createLogger(undefined, {minimumLevel: () => 'info'}),
      onPhase: phase => phases.push(phase),
    });
    return {parameters, outcome, phases};
  } finally {
    rmSync(clientFolder, {recursive: true, force: true});
  }
}

/** The launcher of the install folder, or an empty text when nothing was installed. */
function launcherOf(host: RunningHost, parameters: ScriptParameters): string {
  return host
    .onHost(
      'sh',
      '-c',
      `ls '${installFolderOf(parameters)}/${STAND_IN_LAUNCHER}' 2>/dev/null || true`,
    )
    .trim();
}

for (const variant of fetchVariantsToRun(process.env)) {
  describe(`the download with the tool ${variant}`, function () {
    this.timeout(3 * MINUTE);
    let host: RunningHost;
    let forward: ChildProcess | undefined;
    let sourceOnClient = '';

    before(async () => {
      host = await startHost({fetch: variant});
      placeStandInArchive(host);
      host.startDetached('sh', '-c', SERVING_LOOP);
      const port = await freePort();
      forward = spawn(
        'ssh',
        [
          '-F',
          path.join(host.runFolder, 'ssh_config'),
          '-N',
          '-L',
          `127.0.0.1:${String(port)}:127.0.0.1:${String(SOURCE_PORT)}`,
          'harness',
        ],
        {stdio: 'ignore'},
      );
      sourceOnClient = `http://127.0.0.1:${String(port)}/server.tar.gz`;
    });

    after(() => {
      forward?.kill();
      host.stop();
    });

    it('contracts harness: the host has the wget this variant names', () => {
      deepStrictEqual(
        whereIs(host, 'wget') !== '',
        variant === 'busybox-wget' || variant === 'gnu-wget',
      );
    });

    it('contracts harness: the host has the curl this variant names', () => {
      deepStrictEqual(whereIs(host, 'curl') !== '', variant === 'curl');
    });

    it('contracts V2: the probe lists exactly the downloaders of this variant', async () => {
      deepStrictEqual(
        (await probed(host)).tools.filter(tool =>
          ['wget', 'curl'].includes(tool),
        ),
        {
          'busybox-wget': ['wget'],
          'gnu-wget': ['wget'],
          curl: ['curl'],
          none: [],
        }[variant],
      );
    });

    it('contracts V2: the probe tells a BusyBox wget from a GNU one', async () => {
      deepStrictEqual(
        (await probed(host)).busyboxWget,
        variant === 'busybox-wget',
      );
    });

    if (variant !== 'none') {
      it('contracts V4: the host downloads the archive and installs it', async () => {
        const {outcome} = await installFrom(
          host,
          `http://127.0.0.1:${String(SOURCE_PORT)}/server.tar.gz`,
        );
        deepStrictEqual(outcome.kind, 'transferred');
      });

      it('contracts V4: the install folder holds the launcher of the stand-in', async () => {
        const {parameters} = await installFrom(
          host,
          `http://127.0.0.1:${String(SOURCE_PORT)}/server.tar.gz`,
        );
        deepStrictEqual(
          launcherOf(host, parameters),
          `${installFolderOf(parameters)}/${STAND_IN_LAUNCHER}`,
        );
      });
    }

    if (variant === 'gnu-wget') {
      it('F-2403 AC-15: a wgetrc with an unreachable proxy is kept out with --no-config', async () => {
        host.onHost('sh', '-c', `printf '%s' '${WGETRC}' > ~/.wgetrc`);
        const {outcome} = await installFrom(
          host,
          `http://127.0.0.1:${String(SOURCE_PORT)}/server.tar.gz`,
        );
        deepStrictEqual(outcome.kind, 'transferred');
      });

      it('contracts V4: the same wgetrc is read when the configuration files are used', async () => {
        host.onHost('sh', '-c', `printf '%s' '${WGETRC}' > ~/.wgetrc`);
        const {outcome} = await installFrom(
          host,
          `http://127.0.0.1:${String(SOURCE_PORT)}/server.tar.gz`,
          {
            useConfigurationFiles: true,
          },
        );
        deepStrictEqual(outcome.kind, 'failed');
      });
    }

    if (variant === 'curl') {
      it('F-2403 AC-15: a curlrc with an unreachable proxy is kept out with -q', async () => {
        host.onHost('sh', '-c', `printf '%s' '${CURLRC}' > ~/.curlrc`);
        const {outcome} = await installFrom(
          host,
          `http://127.0.0.1:${String(SOURCE_PORT)}/server.tar.gz`,
        );
        deepStrictEqual(outcome.kind, 'transferred');
      });

      it('contracts V4: the same curlrc is read when the configuration files are used', async () => {
        host.onHost('sh', '-c', `printf '%s' '${CURLRC}' > ~/.curlrc`);
        const {outcome} = await installFrom(
          host,
          `http://127.0.0.1:${String(SOURCE_PORT)}/server.tar.gz`,
          {
            useConfigurationFiles: true,
          },
        );
        deepStrictEqual(outcome.kind, 'failed');
      });
    }

    if (variant !== 'none') {
      describe('against the download host that fails', () => {
        let failingHost: RunningHost;
        let downloads: DownloadHost;
        let folder = '';

        before(async () => {
          folder = mkdtempSync(path.join(tmpdir(), 'fetch-tools-downloads-'));
          writeFileSync(path.join(folder, 'archive.tar.gz'), 'archive');
          writeFileSync(path.join(folder, 'requests.log'), '');
          downloads = await startDownloadHost({
            addresses: ['127.0.0.1', bridgeGateway(runCommand)],
            archiveFile: path.join(folder, 'archive.tar.gz'),
            ...makeCertificate(folder),
            templatesFolder: path.join(folder, 'templates'),
            controlFolder: path.join(folder, 'control'),
            logFile: path.join(folder, 'requests.log'),
            tlsLogFile: path.join(folder, 'tls.log'),
          });
          failingHost = await startHost({fetch: variant, downloads: true});
        });

        after(async () => {
          failingHost.stop();
          await downloads.stop();
          rmSync(folder, {recursive: true, force: true});
        });

        const configurations =
          variant === 'busybox-wget' ? [false] : [false, true];
        for (const useConfigurationFiles of configurations) {
          const label = useConfigurationFiles
            ? 'with the configuration files'
            : 'without the configuration files';

          it(`#670 R3: a 404 ${label} is ServerDownloadFailed with status 404`, async () => {
            const {outcome} = await installFrom(
              failingHost,
              `http://downloads:${String(downloads.httpPort)}/missing/x`,
              {useConfigurationFiles},
            );
            deepStrictEqual(outcome, {
              kind: 'failed',
              failure: {
                kind: 'serverDownload',
                cause: 'downloadFailed',
                status: 404,
              },
            });
          });

          it(`#670 R3: a 503 ${label} is ServerDownloadFailed with no status`, async () => {
            const {outcome} = await installFrom(
              failingHost,
              `http://downloads:${String(downloads.httpPort)}/busy/x`,
              {useConfigurationFiles},
            );
            deepStrictEqual(outcome, {
              kind: 'failed',
              failure: {kind: 'serverDownload', cause: 'downloadFailed'},
            });
          });
        }
      });
    }

    if (variant === 'none') {
      it('contracts V4: with no downloader and the client as a fallback the client downloads and copies', async () => {
        const {outcome, phases} = await installFrom(host, sourceOnClient, {
          clientFallback: true,
        });
        deepStrictEqual(
          [
            outcome.kind,
            phases
              .map(phase => phase.kind)
              .filter(
                kind => kind === 'downloadingLocally' || kind === 'copying',
              ),
          ],
          ['transferred', ['downloadingLocally', 'copying']],
        );
      });

      it('contracts V4: with no downloader and no fallback the install fails as no downloader', async () => {
        const {outcome} = await installFrom(host, sourceOnClient);
        deepStrictEqual(outcome, {
          kind: 'failed',
          failure: {kind: 'serverDownload', cause: 'noDownloader'},
        });
      });
    }
  });
}
