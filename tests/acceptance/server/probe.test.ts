import {deepStrictEqual} from 'node:assert';
import {probe, type ProbedHost, type ScriptParameters} from 'lib-server';
import {startHost, type RunningHost} from './host-fixture.ts';

const PARAMETERS: ScriptParameters = {
  installRoot: '',
  dataFolderName: '.stand-in-data',
  launcher: 'bin/stand-in-server',
  commit: 'acceptancecommit',
  archiveUrl: 'https://example.invalid/server.tar.gz',
  archivePath: '',
  removeArchive: false,
  archiveFormat: 'tar.gz',
  epochMilliseconds: 1700000000000,
  installTree: '',
  proxy: {http: '', https: ''},
  downloader: {useConfigurationFiles: false, timeoutSeconds: 30},
  lock: {
    method: 'link',
    inTemporaryFolder: false,
    filePrefix: 'boot-lock.user',
  },
  environmentSetup: '',
  installUmask: 'inherit',
  cleanup: {kind: 'keepNewest', count: 5},
  start: {
    bindHost: '127.0.0.1',
    port: '0',
    licenceAccepted: false,
    graceSeconds: 0,
    extensions: [],
    fileWatcherPollingMilliseconds: 0,
    useHostProxy: false,
    requirementsHelper: false,
    readySeconds: 10,
    socketMode: false,
  },
};

describe('F-2401 the probe of a host', function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
  });

  after(() => {
    host.stop();
  });

  async function probed(): Promise<ProbedHost> {
    const outcome = await probe(
      host.channel,
      PARAMETERS,
      new AbortController().signal,
    );
    if (outcome.kind !== 'probed') {
      throw new Error(`no probe: ${JSON.stringify(outcome.failure)}`);
    }
    return outcome.host;
  }

  it('contracts V2: finds an Alpine host to be a musl Linux with the tools of BusyBox', async () => {
    const {operatingSystem, libc, release, tools, busyboxWget} = await probed();
    deepStrictEqual(
      {operatingSystem, libc, release, tools, busyboxWget},
      {
        operatingSystem: 'linux',
        libc: 'musl',
        release: 'alpine',
        tools: ['wget', 'tar', 'unzip', 'flock', 'gzip'],
        busyboxWget: true,
      },
    );
  });

  it("contracts V2: reads the user's home, the login shell and the temporary folder", async () => {
    const {home, loginShell, temporaryFolder} = await probed();
    deepStrictEqual(
      {home, loginShell, temporaryFolder},
      {home: '/home/harness', loginShell: 'sh', temporaryFolder: '/tmp'},
    );
  });

  it("F-2401 AC-11: reads the host's architecture as the editor names it", async () => {
    const machine = host.onHost('uname', '-m').trim();
    deepStrictEqual(
      (await probed()).architecture,
      machine === 'x86_64' ? 'x64' : 'arm64',
    );
  });

  it('F-2407: finds no server installed on a fresh host, and where it would go', async () => {
    const {installed, installFolder, treeComplete} = await probed();
    deepStrictEqual(
      {installed, installFolder, treeComplete},
      {
        installed: false,
        installFolder: '/home/harness/.stand-in-data/bin/acceptancecommit',
        treeComplete: false,
      },
    );
  });
});

describe('F-2402 the prerequisites of a host', function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
  });

  after(() => {
    host.stop();
  });

  it('F-2402: refuses a host without tar and names the tool', async () => {
    host.asRoot('rm', '/bin/tar');
    const outcome = await probe(
      host.channel,
      PARAMETERS,
      new AbortController().signal,
    );
    deepStrictEqual(outcome, {
      kind: 'failed',
      failure: {kind: 'prerequisiteMissing', missing: ['tar']},
    });
  });
});
