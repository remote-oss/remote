import {deepStrictEqual, throws} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type BootstrapRequest,
  parseResult,
  type ResultBlock,
  scriptFor,
  type ScriptParameters,
  type ScriptStep,
} from '../../src/index.ts';
import {powershellScript} from '../../src/scripts/powershell-script.ts';
import {parametersFor} from './fake-host.ts';

/** A Windows host as pwsh on Linux plays it: a home, a folder of stand-in programs, and the Windows variables. */
interface PowershellHost {
  root: string;
  home: string;
  programs: string;
}

const hosts: string[] = [];

afterEach(() => {
  for (const root of hosts.splice(0)) {
    rmSync(root, {recursive: true, force: true});
  }
});

function powershellHost(programNames: readonly string[] = []): PowershellHost {
  const root = mkdtempSync(path.join(tmpdir(), 'powershell-host-'));
  hosts.push(root);
  const home = path.join(root, 'home');
  const programs = path.join(root, 'programs');
  mkdirSync(home);
  mkdirSync(programs);
  for (const name of programNames) {
    const file = path.join(programs, name);
    writeFileSync(file, '');
    chmodSync(file, 0o755);
  }
  return {root, home, programs};
}

/** The variable that names Windows' family. */
const SYSTEM_VARIABLE = 'OS';

const WINDOWS_VARIABLES = {
  [SYSTEM_VARIABLE]: 'Windows_NT',
  PROCESSOR_ARCHITECTURE: 'AMD64',
};

/** Runs the request's PowerShell script under pwsh on the host and reads its result block. */
function runOn(
  host: PowershellHost,
  request: BootstrapRequest,
  parameters: ScriptParameters,
  variables: Readonly<Record<string, string | undefined>> = WINDOWS_VARIABLES,
): ResultBlock | 'none' {
  const script = path.join(host.root, 'step.ps1');
  writeFileSync(script, scriptFor(request, 'powershell', parameters));
  const pwshRun = spawnSync(
    'pwsh',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script],
    {
      encoding: 'utf8',
      env: {
        PATH: `${host.programs}:${process.env.PATH ?? ''}`,
        HOME: host.home,
        ...variables,
      },
    },
  );
  if (pwshRun.error !== undefined) {
    throw new Error(
      `pwsh did not run (${pwshRun.error.message}): install it with tools/install-pwsh`,
    );
  }
  const read = parseResult(pwshRun.stdout.split('\n'));
  return 'block' in read ? read.block : 'none';
}

function single(step: ScriptStep): BootstrapRequest {
  return {installMode: 'singleScript', step};
}

/** The status and the named facts of a run. */
function factsOf(
  block: ResultBlock | 'none',
  names: readonly string[],
): unknown {
  if (block === 'none') {
    return 'none';
  }
  const facts: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(block.hostFacts).map(([key, value]) => [
        `host.${key}`,
        value,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(block.serverFacts).map(([key, value]) => [
        `server.${key}`,
        value,
      ]),
    ),
  };
  return {
    status: block.status,
    ...Object.fromEntries(names.map(name => [name, facts[name]])),
  };
}

describe('the PowerShell bootstrap script, run under pwsh', function () {
  this.timeout(30000);

  describe('probe', () => {
    it('F-2701: a Windows host is win32, with its programs as tools', () => {
      const host = powershellHost(['tar.exe', 'curl.exe']);
      deepStrictEqual(
        factsOf(runOn(host, single('probe'), parametersFor()), [
          'host.os',
          'host.arch',
          'host.libc',
          'host.release',
          'host.tool.tar',
          'host.tool.curl',
          'host.tool.wget',
          'host.wgetBusybox',
          'host.home',
          'server.installed',
        ]),
        {
          status: 'Ok',
          'host.os': 'win32',
          'host.arch': 'x64',
          'host.libc': 'unknown',
          'host.release': 'windows',
          'host.tool.tar': 'yes',
          'host.tool.curl': 'yes',
          'host.tool.wget': 'no',
          'host.wgetBusybox': 'no',
          'host.home': host.home,
          'server.installed': 'no',
        },
      );
    });

    it('F-2701: a 32-bit PowerShell on 64-bit Windows reports the machine, not itself', () => {
      deepStrictEqual(
        factsOf(
          runOn(powershellHost(), single('probe'), parametersFor(), {
            [SYSTEM_VARIABLE]: 'Windows_NT',
            PROCESSOR_ARCHITECTURE: 'x86',
            PROCESSOR_ARCHITEW6432: 'ARM64',
          }),
          ['host.arch'],
        ),
        {status: 'Ok', 'host.arch': 'arm64'},
      );
    });

    it('F-2401: a 32-bit Windows is an unsupported architecture, named', () => {
      deepStrictEqual(
        factsOf(
          runOn(powershellHost(), single('probe'), parametersFor(), {
            [SYSTEM_VARIABLE]: 'Windows_NT',
            PROCESSOR_ARCHITECTURE: 'x86',
          }),
          ['host.arch'],
        ),
        {status: 'UnsupportedArch', 'host.arch': 'x86'},
      );
    });

    it('F-2401: a host that is not Windows is an unsupported platform', () => {
      deepStrictEqual(
        factsOf(
          runOn(powershellHost(), single('probe'), parametersFor(), {}),
          [],
        ),
        {status: 'UnsupportedPlatform'},
      );
    });

    it('F-2403: an installed server is found by its launcher in the data folder', () => {
      const host = powershellHost();
      const parameters = parametersFor();
      const launcher = path.join(
        host.home,
        parameters.dataFolderName,
        'bin',
        parameters.commit,
        parameters.launcher,
      );
      mkdirSync(path.dirname(launcher), {recursive: true});
      writeFileSync(launcher, '');
      deepStrictEqual(
        factsOf(runOn(host, single('probe'), parameters), [
          'server.installed',
          'server.installDir',
        ]),
        {
          status: 'Ok',
          'server.installed': 'yes',
          'server.installDir': path.dirname(path.dirname(launcher)),
        },
      );
    });

    it('F-2407: an install root under ~ is under the home folder', () => {
      const host = powershellHost();
      const parameters = {...parametersFor(), installRoot: '~/srv'};
      deepStrictEqual(
        factsOf(runOn(host, single('probe'), parameters), [
          'server.installDir',
        ]),
        {
          status: 'Ok',
          'server.installDir': path.join(
            host.home,
            'srv',
            parameters.dataFolderName,
            'bin',
            parameters.commit,
          ),
        },
      );
    });

    it('V9: a complete server tree is reported', () => {
      const host = powershellHost();
      const tree = path.join(host.root, 'tree');
      const parameters = {...parametersFor(), installTree: tree};
      mkdirSync(path.join(tree, path.dirname(parameters.launcher)), {
        recursive: true,
      });
      writeFileSync(path.join(tree, parameters.launcher), '');
      deepStrictEqual(
        factsOf(runOn(host, single('probe'), parameters), [
          'server.treeComplete',
        ]),
        {status: 'Ok', 'server.treeComplete': 'yes'},
      );
    });

    it('V2: a fact holding a line break is one line in the block', () => {
      deepStrictEqual(
        factsOf(
          runOn(powershellHost(), single('probe'), parametersFor(), {
            ...WINDOWS_VARIABLES,
            SSH_AUTH_SOCK: 'one\ntwo',
          }),
          ['host.sshAuthSock'],
        ),
        {status: 'Ok', 'host.sshAuthSock': 'one two'},
      );
    });
  });

  describe('discard', () => {
    it('F-2405: an archive the step was told to remove is removed', () => {
      const host = powershellHost();
      const archive = path.join(host.root, 'server.zip');
      writeFileSync(archive, 'zip');
      const outcome = factsOf(
        runOn(host, single('discard'), {
          ...parametersFor(),
          archivePath: archive,
          removeArchive: true,
        }),
        [],
      );
      deepStrictEqual([outcome, existsSync(archive)], [{status: 'Ok'}, false]);
    });

    it('F-2405: an archive the step was not told to remove stays', () => {
      const host = powershellHost();
      const archive = path.join(host.root, 'server.zip');
      writeFileSync(archive, 'zip');
      runOn(host, single('discard'), {
        ...parametersFor(),
        archivePath: archive,
      });
      deepStrictEqual(existsSync(archive), true);
    });
  });
});

describe('the PowerShell bootstrap script, as text', () => {
  it('F-2701: a step it does not have yet still answers with a failure', () => {
    deepStrictEqual(
      scriptFor(single('install'), 'powershell', parametersFor()).includes(
        'status=ServerFailedToStart',
      ),
      true,
    );
  });

  it('F-2701: rendering a step it does not have is a programming error', () => {
    throws(
      () => powershellScript(single('install'), parametersFor()),
      /no install step/,
    );
  });

  it('F-2701: the probe stays below the Windows command-line limit', () => {
    deepStrictEqual(
      scriptFor(single('probe'), 'powershell', parametersFor()).length < 8192,
      true,
    );
  });
});
