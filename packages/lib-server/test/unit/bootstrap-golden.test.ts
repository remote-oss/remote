import {strictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  type BootstrapRequest,
  scriptFor,
  type ScriptParameters,
} from '../../src/index.ts';
import {parametersFor} from './fake-host.ts';

/** The key of the CLI's place in the parameters. */
const CLI_PARAMETERS = 'cli';

const GOLDEN_FOLDER = path.join(import.meta.dirname, 'golden', 'posix');

/** Set to rewrite the golden files from the renderer instead of comparing, after a change meant to show in review. */
const REWRITE = process.env.GOLDEN_REWRITE === '1';

const SINGLE_SCRIPT_STEPS = [
  'probe',
  'install',
  'discard',
  'start',
  'installExtensions',
  'installCli',
  'startCli',
  'stopCli',
  'kill',
  'uninstall',
  'cleanup',
] as const;

const STEPWISE_ACTIONS = ['prepare', 'unpack', 'activate'] as const;

function fullParameters(): ScriptParameters {
  const base = parametersFor();
  return {
    ...base,
    installRoot: '/opt/root dir',
    archivePath: '/tmp/a b.tar.gz',
    removeArchive: true,
    installTree: '/srv/tree',
    proxy: {http: 'http://proxy:3128', https: "http://it's:3129"},
    downloader: {useConfigurationFiles: true, timeoutSeconds: 45},
    lock: {method: 'flock', inTemporaryFolder: true, filePrefix: 'lock.u'},
    environmentSetup: '/etc/profile.d/x.sh',
    installUmask: '022',
    cleanup: {kind: 'keepNewest', count: 2},
    start: {
      ...base.start,
      port: '8000-9000',
      licenceAccepted: true,
      graceSeconds: 10800,
      extensions: ['a.b', 'c.d'],
      fileWatcherPollingMilliseconds: 500,
      useHostProxy: true,
      forceDisableUserEnv: true,
      requirementsHelper: true,
      socketMode: true,
    },
    [CLI_PARAMETERS]: {
      name: 'codium-abc1230000000000000000000000000000000000',
      dataFolder: '/home/u/.cli',
      stopProcessId: 4242,
    },
  };
}

function goldenRow(
  file: string,
  request: BootstrapRequest,
  parameters: () => ScriptParameters,
): void {
  it(file, () => {
    const rendered = scriptFor(request, 'posixShell', parameters());
    const golden = path.join(GOLDEN_FOLDER, file);
    if (REWRITE) {
      writeFileSync(golden, rendered);
    }
    strictEqual(rendered, readFileSync(golden, 'utf8'));
  });
}

describe('the POSIX bootstrap script, as rendered', () => {
  for (const [label, parameters] of [
    ['base', parametersFor],
    ['full', fullParameters],
  ] as const) {
    for (const step of SINGLE_SCRIPT_STEPS) {
      goldenRow(
        `${label}-${step}.sh`,
        {installMode: 'singleScript', step},
        parameters,
      );
    }
    for (const step of STEPWISE_ACTIONS) {
      goldenRow(
        `${label}-stepwise-${step}.sh`,
        {installMode: 'stepwise', step},
        parameters,
      );
    }
  }
});
