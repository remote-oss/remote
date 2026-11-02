import {deepStrictEqual, throws} from 'node:assert';
import {execFile, spawn, spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer, type Server} from 'node:http';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
import {
  powershellParts,
  powershellScript,
} from '../../src/scripts/powershell-script.ts';
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

/**
 * The script file and the environment of one run of the request's PowerShell script on the host; a `stub` stands in
 * for Windows-only functions, defined between the script's head and its body.
 */
function scriptRun(
  host: PowershellHost,
  request: BootstrapRequest,
  parameters: ScriptParameters,
  variables: Readonly<Record<string, string | undefined>>,
  stub = '',
): {file: string; environment: Record<string, string | undefined>} {
  const file = path.join(host.root, 'step.ps1');
  const {head, body} = powershellParts(request, parameters);
  writeFileSync(
    file,
    stub === '' ? `${head}\n${body}` : `${head}\n${stub}\n${body}`,
  );
  return {
    file,
    environment: {
      PATH: `${host.programs}:${process.env.PATH ?? ''}`,
      HOME: host.home,
      POWERSHELL_TELEMETRY_OPTOUT: '1',
      ...variables,
    },
  };
}

const PWSH_ARGUMENTS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File'];

function blockOf(output: string): ResultBlock | 'none' {
  const read = parseResult(output.split('\n'));
  return 'block' in read ? read.block : 'none';
}

/** Runs the request's PowerShell script under pwsh on the host and reads its result block. */
function runOn(
  host: PowershellHost,
  request: BootstrapRequest,
  parameters: ScriptParameters,
  variables: Readonly<Record<string, string | undefined>> = WINDOWS_VARIABLES,
  stub = '',
): ResultBlock | 'none' {
  const {file, environment} = scriptRun(
    host,
    request,
    parameters,
    variables,
    stub,
  );
  const pwshRun = spawnSync('pwsh', [...PWSH_ARGUMENTS, file], {
    encoding: 'utf8',
    env: environment,
  });
  if (pwshRun.error !== undefined) {
    throw new Error(
      `pwsh did not run (${pwshRun.error.message}): install it with tools/install-pwsh`,
    );
  }
  return blockOf(pwshRun.stdout);
}

/** Like `runOn`, but leaves the event loop free while pwsh runs, for a row that serves the download itself. */
function runOnWhileServing(
  host: PowershellHost,
  request: BootstrapRequest,
  parameters: ScriptParameters,
): Promise<ResultBlock | 'none'> {
  const {file, environment} = scriptRun(
    host,
    request,
    parameters,
    WINDOWS_VARIABLES,
  );
  return promisify(execFile)('pwsh', [...PWSH_ARGUMENTS, file], {
    encoding: 'utf8',
    env: environment,
  }).then(({stdout}) => blockOf(stdout));
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

/** Zips `folder` into `archive` with .NET's own writer, as a server archive is packed. */
function zipOf(folder: string, archive: string): void {
  spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${folder}', '${archive}')`,
    ],
    {env: {...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1'}},
  );
}

/** A server archive whose single top folder holds the launcher, as the server builds are packed. */
function serverArchive(host: PowershellHost, launcher: string): string {
  const source = path.join(host.root, 'source');
  mkdirSync(path.join(source, 'server-top', path.dirname(launcher)), {
    recursive: true,
  });
  writeFileSync(path.join(source, 'server-top', launcher), 'launcher');
  const archive = path.join(host.root, 'server.zip');
  zipOf(source, archive);
  return archive;
}

/** The parameters of an install from an archive already on the host. */
function installFrom(archive: string): ScriptParameters {
  return {...parametersFor(), archiveFormat: 'zip', archivePath: archive};
}

/** Where the install puts the server of the parameters on the host. */
function installFolder(
  host: PowershellHost,
  parameters: ScriptParameters,
): string {
  return path.join(
    host.home,
    parameters.dataFolderName,
    'bin',
    parameters.commit,
  );
}

/** The lock file the install of the parameters takes in its folder. */
function lockFile(host: PowershellHost, parameters: ScriptParameters): string {
  return path.join(
    installFolder(host, parameters),
    `${parameters.lock.filePrefix}.${parameters.commit}`,
  );
}

/** Serves `body` at every address with `status`, and gives the server's address once it listens. */
function serving(
  status: number,
  body: Buffer,
): Promise<{server: Server; address: string}> {
  const server = createServer((incoming, response) => {
    incoming.resume();
    response.writeHead(status);
    response.end(body);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const bound = server.address();
      const port = typeof bound === 'object' && bound !== null ? bound.port : 0;
      resolve({server, address: `http://127.0.0.1:${String(port)}/server.zip`});
    });
  });
}

describe('the PowerShell install, run under pwsh', function () {
  this.timeout(60000);

  it('F-2403: the archive is unpacked into the data folder, its top folder lifted', () => {
    const host = powershellHost();
    const parameters = installFrom(serverArchive(host, 'bin/launcher'));
    const outcome = factsOf(runOn(host, single('install'), parameters), [
      'server.installDir',
    ]);
    deepStrictEqual(
      [
        outcome,
        readFileSync(
          path.join(installFolder(host, parameters), 'bin', 'launcher'),
          'utf8',
        ),
      ],
      [
        {status: 'Ok', 'server.installDir': installFolder(host, parameters)},
        'launcher',
      ],
    );
  });

  it('F-2408: the lock file is gone when the install ends', () => {
    const host = powershellHost();
    const parameters = installFrom(serverArchive(host, 'bin/launcher'));
    runOn(host, single('install'), parameters);
    deepStrictEqual(existsSync(lockFile(host, parameters)), false);
  });

  it('F-2403: a server already installed is kept, and nothing is unpacked', () => {
    const host = powershellHost();
    const parameters = installFrom(path.join(host.root, 'absent.zip'));
    const launcher = path.join(
      installFolder(host, parameters),
      'bin',
      'launcher',
    );
    mkdirSync(path.dirname(launcher), {recursive: true});
    writeFileSync(launcher, 'kept');
    deepStrictEqual(
      [
        factsOf(runOn(host, single('install'), parameters), []),
        readFileSync(launcher, 'utf8'),
      ],
      [{status: 'Ok'}, 'kept'],
    );
  });

  it('F-2403: an archive that is no zip fails to unpack', () => {
    const host = powershellHost();
    const archive = path.join(host.root, 'broken.zip');
    writeFileSync(archive, 'not a zip');
    deepStrictEqual(
      factsOf(runOn(host, single('install'), installFrom(archive)), []),
      {status: 'UnpackFailed'},
    );
  });

  it('F-2403: an archive without the launcher fails to unpack', () => {
    const host = powershellHost();
    deepStrictEqual(
      factsOf(
        runOn(
          host,
          single('install'),
          installFrom(serverArchive(host, 'bin/other')),
        ),
        [],
      ),
      {status: 'UnpackFailed'},
    );
  });

  it('F-2405: an archive the step was told to remove is removed after the install', () => {
    const host = powershellHost();
    const archive = serverArchive(host, 'bin/launcher');
    runOn(host, single('install'), {
      ...installFrom(archive),
      removeArchive: true,
    });
    deepStrictEqual(existsSync(archive), false);
  });

  it('F-2408: a lock another install holds gives LockBusy, with the lock named', async () => {
    const host = powershellHost();
    const parameters = installFrom(serverArchive(host, 'bin/launcher'));
    const lock = lockFile(host, parameters);
    mkdirSync(path.dirname(lock), {recursive: true});
    const holder = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$s = [System.IO.File]::Open('${lock}', 'OpenOrCreate', 'ReadWrite', 'None'); 'held'; Start-Sleep 30`,
      ],
      {env: {...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1'}},
    );
    try {
      await new Promise<void>(resolve => {
        holder.stdout.once('data', () => {
          resolve();
        });
      });
      deepStrictEqual(
        factsOf(await runOnWhileServing(host, single('install'), parameters), [
          'server.lockPath',
        ]),
        {status: 'LockBusy', 'server.lockPath': lock},
      );
    } finally {
      holder.kill();
    }
  });

  it('F-2408: a lock that cannot be opened is a write failure, named', () => {
    const host = powershellHost();
    const parameters = installFrom(serverArchive(host, 'bin/launcher'));
    const lock = lockFile(host, parameters);
    mkdirSync(lock, {recursive: true});
    deepStrictEqual(
      factsOf(runOn(host, single('install'), parameters), [
        'server.lockPath',
        'server.writeFailedPath',
      ]),
      {
        status: 'CreateInstallDirFailed',
        'server.lockPath': lock,
        'server.writeFailedPath': lock,
      },
    );
  });

  it('F-2407: an install folder that cannot be made is a write failure, named', () => {
    const host = powershellHost();
    const parameters = installFrom(serverArchive(host, 'bin/launcher'));
    writeFileSync(path.join(host.home, parameters.dataFolderName), 'a file');
    deepStrictEqual(
      factsOf(runOn(host, single('install'), parameters), [
        'server.writeFailedPath',
      ]),
      {
        status: 'CreateInstallDirFailed',
        'server.writeFailedPath': installFolder(host, parameters),
      },
    );
  });

  it('F-2404: the environment setup runs before the download', () => {
    const host = powershellHost();
    const marker = path.join(host.root, 'setup-ran');
    const setup = path.join(host.root, 'setup.ps1');
    writeFileSync(setup, `Set-Content -LiteralPath '${marker}' -Value 'yes'\n`);
    runOn(host, single('install'), {
      ...installFrom(serverArchive(host, 'bin/launcher')),
      environmentSetup: setup,
    });
    deepStrictEqual(existsSync(marker), true);
  });

  it('F-2403: the archive is downloaded, unpacked, and the download removed', async () => {
    const host = powershellHost();
    const archive = readFileSync(serverArchive(host, 'bin/launcher'));
    const {server, address} = await serving(200, archive);
    try {
      const parameters = {
        ...parametersFor(),
        archiveFormat: 'zip' as const,
        archiveUrl: address,
      };
      deepStrictEqual(
        factsOf(await runOnWhileServing(host, single('install'), parameters), [
          'server.installDir',
        ]),
        {status: 'Ok', 'server.installDir': installFolder(host, parameters)},
      );
    } finally {
      server.close();
    }
  });

  it('F-2403: a download answered 404 fails, and says so', async () => {
    const {server, address} = await serving(404, Buffer.from('missing'));
    try {
      const host = powershellHost();
      deepStrictEqual(
        factsOf(
          await runOnWhileServing(host, single('install'), {
            ...parametersFor(),
            archiveFormat: 'zip',
            archiveUrl: address,
          }),
          ['server.downloadStatus'],
        ),
        {status: 'ServerDownloadFailed', 'server.downloadStatus': '404'},
      );
    } finally {
      server.close();
    }
  });

  it('V9: an install into a server tree is not built yet, and says so', () => {
    deepStrictEqual(
      factsOf(
        runOn(powershellHost(), single('install'), {
          ...parametersFor(),
          installTree: '/srv/tree',
        }),
        ['host.note'],
      ),
      {
        status: 'ServerFailedToStart',
        'host.note':
          'the Windows bootstrap script has no server tree install yet',
      },
    );
  });
});

/** The current user's SID the stand-ins report. */
const USER_SID = 'S-1-5-21-100-200-300-1001';

/** A token ACL entry the stand-in `Get-Acl` reports: its principal's SID, its rights, its type and its account name. */
interface StandInEntry {
  principal: string;
  rights: number;
  type: 'Allow' | 'Deny';
  name?: string;
}

/** The three principals a token may have, with full control. */
const THREE_PRINCIPALS: readonly StandInEntry[] = [
  {principal: USER_SID, rights: 2032127, type: 'Allow'},
  {principal: 'S-1-5-18', rights: 2032127, type: 'Allow'},
  {principal: 'S-1-5-32-544', rights: 2032127, type: 'Allow'},
];

/** The record the stand-in `Set-Acl` writes on the host: whether inheritance is off, the file's length, and the rules. */
function aclRecordOf(host: PowershellHost): string {
  return path.join(host.root, 'acl-record');
}

/**
 * Stand-ins for the token's Windows-only calls, so that the script's own checks and writes run: the user's SID, a
 * `Get-Acl` that reports `entries` until `Set-Acl` recorded an ACL (then that one), the three security types of
 * `New-Object` (every other type passes through), and a `Set-Acl` that records what it is given.
 */
function tokenStub(
  host: PowershellHost,
  entries: readonly StandInEntry[] = THREE_PRINCIPALS,
): string {
  const record = aclRecordOf(host);
  const entryLines = entries.map(
    entry =>
      `(New-StandInEntry '${entry.principal}' ${String(entry.rights)} '${entry.type}' '${entry.name ?? ''}')`,
  );
  return [
    `function Get-CurrentUserSid { return '${USER_SID}' }`,
    'function New-StandInEntry([string]$Principal, [long]$Rights, [string]$Type, [string]$Name) {',
    '  $Identity = [pscustomobject]@{Value = $Name; Principal = $Principal}',
    '  $Identity | Add-Member -MemberType ScriptMethod -Name Translate -Value { param($Target) return [pscustomobject]@{Value = $this.Principal} }',
    '  return [pscustomobject]@{AccessControlType = $Type; FileSystemRights = $Rights; IdentityReference = $Identity}',
    '}',
    'function Get-Acl([string]$LiteralPath) {',
    `  if (Test-Path -LiteralPath '${record}') {`,
    `    return [pscustomobject]@{Access = @(Get-Content -LiteralPath '${record}' | Where-Object { $_ -like 'rule *' } | ForEach-Object { $Fields = $_ -split ' '; New-StandInEntry $Fields[1] 2032127 $Fields[3] '' })}`,
    '  }',
    `  return [pscustomobject]@{Access = @(${entryLines.join(', ')})}`,
    '}',
    'function New-Object {',
    '  param([string]$TypeName, [object[]]$ArgumentList)',
    '  switch ($TypeName) {',
    "    'System.Security.AccessControl.FileSecurity' {",
    '      $Security = [pscustomobject]@{Protected = $false; Rules = @()}',
    '      $Security | Add-Member -MemberType ScriptMethod -Name SetAccessRuleProtection -Value { param($On, $Keep) $this.Protected = $On }',
    '      $Security | Add-Member -MemberType ScriptMethod -Name AddAccessRule -Value { param($Rule) $this.Rules += $Rule }',
    '      return $Security',
    '    }',
    "    'System.Security.AccessControl.FileSystemAccessRule' {",
    '      return [pscustomobject]@{Principal = $ArgumentList[0].Value; Rights = $ArgumentList[1]; Type = $ArgumentList[2]}',
    '    }',
    "    'System.Security.Principal.SecurityIdentifier' {",
    '      return [pscustomobject]@{Value = [string]$ArgumentList[0]}',
    '    }',
    '    default {',
    '      if ($null -eq $ArgumentList) {',
    '        return Microsoft.PowerShell.Utility\\New-Object -TypeName $TypeName',
    '      }',
    '      return Microsoft.PowerShell.Utility\\New-Object -TypeName $TypeName -ArgumentList $ArgumentList',
    '    }',
    '  }',
    '}',
    'function Set-Acl([string]$LiteralPath, $AclObject) {',
    "  $Lines = @(('protected ' + $AclObject.Protected), ('length ' + (Get-Item -LiteralPath $LiteralPath).Length))",
    "  $Lines += @($AclObject.Rules | ForEach-Object { 'rule ' + $_.Principal + ' ' + $_.Rights + ' ' + $_.Type })",
    `  Set-Content -LiteralPath '${record}' -Value $Lines`,
    '}',
  ].join('\n');
}

/** Runs the start on the host with the token's stand-ins for `entries`. */
function startOn(
  host: PowershellHost,
  parameters: ScriptParameters,
  entries: readonly StandInEntry[] = THREE_PRINCIPALS,
): ResultBlock | 'none' {
  return runOn(
    host,
    single('start'),
    parameters,
    WINDOWS_VARIABLES,
    tokenStub(host, entries),
  );
}

/** Puts a stand-in launcher with the shell `body` where the parameters' server is installed, and gives its folder. */
function standInServer(
  host: PowershellHost,
  parameters: ScriptParameters,
  body: string,
): string {
  const launcher = path.join(
    installFolder(host, parameters),
    parameters.launcher,
  );
  mkdirSync(path.dirname(launcher), {recursive: true});
  writeFileSync(launcher, `#!/bin/sh\n${body}\n`);
  chmodSync(launcher, 0o755);
  return installFolder(host, parameters);
}

/** A launcher that names its arguments, says it is ready on port 4242, and stays up a while. */
const READY_SERVER = [
  'echo "words: $#"',
  'echo "Extension host agent listening on 4242"',
  'sleep 5',
].join('\n');

/** The parameters of a start that waits at most one second for the ready line. */
function quickStart(): ScriptParameters {
  const parameters = parametersFor();
  return {...parameters, start: {...parameters.start, readySeconds: 1}};
}

describe('the PowerShell start, run under pwsh', function () {
  this.timeout(60000);

  it('F-2409: a launched server that says it is ready gives its port, its process and a new token', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(host, parameters, READY_SERVER);
    const block = startOn(host, parameters);
    const outcome = factsOf(block, [
      'server.port',
      'server.reused',
      'server.launching',
    ]);
    deepStrictEqual(
      [
        outcome,
        /^[A-Za-z0-9]{32}$/.test(
          block === 'none' ? '' : (block.serverFacts.token ?? ''),
        ),
      ],
      [
        {
          status: 'Ok',
          'server.port': '4242',
          'server.reused': 'no',
          'server.launching': 'yes',
        },
        true,
      ],
    );
  });

  it('F-2409: the server keeps running after the start, and the next start reuses it', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(host, parameters, READY_SERVER);
    startOn(host, parameters);
    deepStrictEqual(
      factsOf(startOn(host, parameters), ['server.reused', 'server.launching']),
      {status: 'Ok', 'server.reused': 'yes', 'server.launching': undefined},
    );
  });

  it('F-2409: each start word stays one word, a home with a space included', () => {
    const host = powershellHost();
    const home = path.join(host.root, 'with space');
    mkdirSync(home);
    const spaced = {...host, home};
    const parameters = quickStart();
    standInServer(spaced, parameters, READY_SERVER);
    startOn(spaced, parameters);
    deepStrictEqual(
      readFileSync(
        path.join(home, parameters.dataFolderName, `.${parameters.commit}.log`),
        'utf8',
      ).split('\n')[0],
      'words: 10',
    );
  });

  it('F-2701 7.E4: socket mode does not apply, and the server listens on a port', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(host, parameters, READY_SERVER);
    deepStrictEqual(
      factsOf(
        startOn(host, {
          ...parameters,
          start: {...parameters.start, socketMode: true},
        }),
        ['server.port'],
      ),
      {status: 'Ok', 'server.port': '4242'},
    );
  });

  it('F-2409: a server that ends before it is ready fails to start', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(host, parameters, 'echo starting');
    deepStrictEqual(factsOf(startOn(host, parameters), []), {
      status: 'ServerFailedToStart',
    });
  });

  it('F-2409: a port range with no free port is named', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(
      host,
      parameters,
      'echo "--port: Could not find free port in range: 8000-8001"',
    );
    deepStrictEqual(factsOf(startOn(host, parameters), ['server.failure']), {
      status: 'ServerFailedToStart',
      'server.failure': 'noFreePort',
    });
  });

  it('F-2409: the CVE stop is named', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(
      host,
      parameters,
      "echo '* !!!! Server terminated due to presence of CVE-2020-1416 !!!!'",
    );
    deepStrictEqual(factsOf(startOn(host, parameters), ['server.failure']), {
      status: 'ServerFailedToStart',
      'server.failure': 'cveTerminated',
    });
  });

  it('F-2409: a server that never says it is ready fails when the wait ends', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(host, parameters, 'sleep 3');
    deepStrictEqual(factsOf(startOn(host, parameters), []), {
      status: 'ServerFailedToStart',
    });
  });

  it('F-2409: a server that is not installed fails to start', () => {
    deepStrictEqual(factsOf(startOn(powershellHost(), quickStart()), []), {
      status: 'ServerFailedToStart',
    });
  });

  it('F-2407: a token file that cannot be written is a write failure, named', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(host, parameters, READY_SERVER);
    const token = path.join(
      host.home,
      parameters.dataFolderName,
      `.${parameters.commit}.token`,
    );
    mkdirSync(path.join(token, 'blocked'), {recursive: true});
    deepStrictEqual(
      factsOf(startOn(host, parameters), ['server.writeFailedPath']),
      {status: 'CreateInstallDirFailed', 'server.writeFailedPath': token},
    );
  });
});

/** The server's token file for the parameters on the host. */
function serverTokenOf(
  host: PowershellHost,
  parameters: ScriptParameters,
): string {
  return path.join(
    host.home,
    parameters.dataFolderName,
    `.${parameters.commit}.token`,
  );
}

/** A start on a new host whose token file holds `token` beforehand, with the ACL `entries`; gives the token after it. */
function tokenAfterStart(
  token: string,
  entries: readonly StandInEntry[],
): {host: PowershellHost; token: string} {
  const host = powershellHost();
  const parameters = quickStart();
  standInServer(host, parameters, READY_SERVER);
  mkdirSync(path.dirname(serverTokenOf(host, parameters)), {recursive: true});
  writeFileSync(serverTokenOf(host, parameters), token);
  startOn(host, parameters, entries);
  return {host, token: readFileSync(serverTokenOf(host, parameters), 'utf8')};
}

describe("the PowerShell start's connection token, run under pwsh", function () {
  this.timeout(60000);

  it('F-2409: a token only the user, SYSTEM and Administrators may read is reused, a deny and a non-reading entry ignored', () => {
    deepStrictEqual(
      tokenAfterStart('kept-token', [
        ...THREE_PRINCIPALS,
        {principal: 'S-1-5-32-545', rights: 2032127, type: 'Deny'},
        {principal: 'S-1-5-32-545', rights: 0x100000, type: 'Allow'},
      ]).token,
      'kept-token',
    );
  });

  it('F-2409: Administrators named in another language are still recognized by their SID', () => {
    deepStrictEqual(
      tokenAfterStart('kept-token', [
        {principal: USER_SID, rights: 2032127, type: 'Allow'},
        {
          principal: 'S-1-5-18',
          rights: 2032127,
          type: 'Allow',
          name: 'NT-AUTORITÄT\\SYSTEM',
        },
        {
          principal: 'S-1-5-32-544',
          rights: 2032127,
          type: 'Allow',
          name: 'VORDEFINIERT\\Administratoren',
        },
      ]).token,
      'kept-token',
    );
  });

  it('F-2409: a token Users may read is rewritten', () => {
    deepStrictEqual(
      /^[A-Za-z0-9]{32}$/.test(
        tokenAfterStart('loose-token', [
          ...THREE_PRINCIPALS,
          {principal: 'S-1-5-32-545', rights: 0x1, type: 'Allow'},
        ]).token,
      ),
      true,
    );
  });

  it('F-2409: a token that is a link is rewritten, and its target left', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(host, parameters, READY_SERVER);
    const token = serverTokenOf(host, parameters);
    mkdirSync(path.dirname(token), {recursive: true});
    writeFileSync(path.join(host.root, 'elsewhere'), 'linked-token');
    symlinkSync(path.join(host.root, 'elsewhere'), token);
    startOn(host, parameters);
    deepStrictEqual(
      [
        lstatSync(token).isSymbolicLink(),
        readFileSync(path.join(host.root, 'elsewhere'), 'utf8'),
      ],
      [false, 'linked-token'],
    );
  });

  it('F-2409: after a write, the token has only the three principals, inheritance off, set while the file was empty', () => {
    const {host} = tokenAfterStart('loose-token', [
      {principal: 'S-1-5-32-545', rights: 0x1, type: 'Allow'},
    ]);
    deepStrictEqual(
      readFileSync(aclRecordOf(host), 'utf8').trim().split('\n'),
      [
        'protected True',
        'length 0',
        `rule ${USER_SID} FullControl Allow`,
        'rule S-1-5-18 FullControl Allow',
        'rule S-1-5-32-544 FullControl Allow',
      ],
    );
  });

  it('F-2409: a running server whose token Users may read is not reused, and a new one starts', () => {
    const host = powershellHost();
    const parameters = quickStart();
    standInServer(host, parameters, READY_SERVER);
    startOn(host, parameters);
    rmSync(aclRecordOf(host), {force: true});
    deepStrictEqual(
      factsOf(
        startOn(host, parameters, [
          ...THREE_PRINCIPALS,
          {principal: 'S-1-5-32-545', rights: 0x1, type: 'Allow'},
        ]),
        ['server.reused'],
      ),
      {status: 'Ok', 'server.reused': 'no'},
    );
  });
});

describe('the PowerShell extension install, run under pwsh', function () {
  this.timeout(60000);

  it('F-2506: each extension gets its status and the last line it printed, in order', () => {
    const host = powershellHost();
    const parameters = parametersFor();
    standInServer(
      host,
      parameters,
      [
        'echo "installing $2"',
        'if [ "$2" = good.one ]; then echo "Extension good.one installed"; exit 0; fi',
        'echo "Extension $2 not found"',
        'exit 1',
      ].join('\n'),
    );
    deepStrictEqual(
      factsOf(
        runOn(host, single('installExtensions'), {
          ...parameters,
          start: {...parameters.start, extensions: ['good.one', 'bad.one']},
        }),
        [
          'server.extension.0.status',
          'server.extension.0.message',
          'server.extension.1.status',
          'server.extension.1.message',
        ],
      ),
      {
        status: 'Ok',
        'server.extension.0.status': 'installed',
        'server.extension.0.message': 'Extension good.one installed',
        'server.extension.1.status': 'failed',
        'server.extension.1.message': 'Extension bad.one not found',
      },
    );
  });

  it('F-2506: no extension to install is done at once', () => {
    const host = powershellHost();
    const parameters = parametersFor();
    standInServer(host, parameters, 'exit 1');
    deepStrictEqual(
      factsOf(runOn(host, single('installExtensions'), parameters), [
        'server.extension.0.status',
      ]),
      {status: 'Ok', 'server.extension.0.status': undefined},
    );
  });

  it('F-2506: a server that is not installed installs nothing', () => {
    deepStrictEqual(
      factsOf(
        runOn(powershellHost(), single('installExtensions'), parametersFor()),
        [],
      ),
      {status: 'ServerFailedToStart'},
    );
  });
});

describe('the PowerShell bootstrap script, as text', () => {
  it('F-2701: a step it does not have yet still answers with a failure', () => {
    deepStrictEqual(
      scriptFor(single('kill'), 'powershell', parametersFor()).includes(
        'status=ServerFailedToStart',
      ),
      true,
    );
  });

  it('F-2701: rendering a step it does not have is a programming error', () => {
    throws(
      () => powershellScript(single('kill'), parametersFor()),
      /no kill step/,
    );
  });

  it('F-2701: the probe stays below the Windows command-line limit', () => {
    deepStrictEqual(
      scriptFor(single('probe'), 'powershell', parametersFor()).length < 8192,
      true,
    );
  });
});
