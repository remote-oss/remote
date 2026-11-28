/**
 * @fileoverview start-display: the apt sources its install reads, and its attempts. Each row runs the script itself,
 * under its own shell options, with stand-ins for sudo, apt-get, apt-cache, dpkg and sleep on a PATH of their own, and
 * with a display socket already served, so only the key driver and xprop are missing.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {createServer, type Server} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {REPOSITORY_ROOT} from './repository.ts';

/** The script the rows run. */
const SCRIPT = path.join(REPOSITORY_ROOT, 'tools', 'start-display');

/** The programs of the machine the script runs, linked into the rows' PATH as they are. */
const MACHINE_PROGRAMS = [
  'bash',
  'basename',
  'cat',
  'cp',
  'grep',
  'mkdir',
  'rm',
  'sed',
  'tail',
  'tee',
  'timeout',
  'tr',
];

/**
 * The stand-ins, each a bash script that writes its arguments as one line of the call log. apt-get fails the first
 * $STAND_IN_FAILED_UPDATES updates; sleep returns at once.
 */
const STAND_INS: Readonly<Record<string, string>> = {
  sudo: 'while [[ $1 == *=* ]]; do export "$1"; shift; done\nexec "$@"',
  'apt-get': [
    'echo "apt-get $*" >>"$STAND_IN_CALLS"',
    'if [[ " $* " == *" update "* ]]; then',
    '  count=$(($(cat "$STAND_IN_CALLS.updates" 2>/dev/null || echo 0) + 1))',
    '  echo "$count" >"$STAND_IN_CALLS.updates"',
    '  [ "$count" -gt "${STAND_IN_FAILED_UPDATES:-0}" ] || { echo "E: Failed to fetch"; exit 100; }',
    'fi',
  ].join('\n'),
  'apt-cache': 'echo "apt-cache $*" >>"$STAND_IN_CALLS"',
  dpkg: 'echo "dpkg $*" >>"$STAND_IN_CALLS"\n[ "$1" != --print-architecture ] || echo amd64',
  sleep: 'echo "sleep $*" >>"$STAND_IN_CALLS"',
};

/** A machine for one row: its apt folder, its release file, the logs folder and the call log. */
interface Machine {
  base: string;
  aptFolder: string;
  release: string;
  logs: string;
  calls: string;
}

/** What one run of the script gave. */
interface DisplayRun {
  status: number | null;
  output: string;
  calls: string[];
}

/** The machine of a row, with the files of its apt folder (`sources.list.d/<name>` and the like) as given. */
function machineWith(
  aptFiles: Readonly<Record<string, string>>,
  release = 'ID=ubuntu\nVERSION_CODENAME=noble\n',
): Machine {
  const base = mkdtempSync(path.join(tmpdir(), 'start-display-'));
  const programs = path.join(base, 'bin');
  mkdirSync(programs);
  for (const program of MACHINE_PROGRAMS) {
    const found = spawnSync('bash', ['-c', `command -v ${program}`], {
      encoding: 'utf8',
    }).stdout.trim();
    symlinkSync(found, path.join(programs, program));
  }
  for (const [name, text] of Object.entries(STAND_INS)) {
    writeFileSync(path.join(programs, name), `#!/bin/bash\n${text}\n`);
    chmodSync(path.join(programs, name), 0o755);
  }
  const aptFolder = path.join(base, 'apt');
  mkdirSync(path.join(aptFolder, 'sources.list.d'), {recursive: true});
  for (const [name, text] of Object.entries(aptFiles)) {
    writeFileSync(path.join(aptFolder, name), text.replaceAll('<base>', base));
  }
  writeFileSync(path.join(base, 'os-release'), release);
  mkdirSync(path.join(base, 'logs'));
  return {
    base,
    aptFolder,
    release: path.join(base, 'os-release'),
    logs: path.join(base, 'logs'),
    calls: path.join(base, 'calls.log'),
  };
}

/** Starts a listener on a socket in the machine's folder, so the script finds its display served. */
async function servedDisplay(machine: Machine): Promise<Server> {
  const server = createServer();
  await new Promise<void>(resolve => {
    server.listen(path.join(machine.base, 'X99'), resolve);
  });
  return server;
}

/** Runs the script on `machine`, with `failedUpdates` updates failing first. */
async function displayRun(
  machine: Machine,
  failedUpdates = 0,
): Promise<DisplayRun> {
  const server = await servedDisplay(machine);
  try {
    const outcome = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: path.join(machine.base, 'bin'),
        RUNNER_TEMP: machine.logs,
        START_DISPLAY_SOCKET: path.join(machine.base, 'X99'),
        START_DISPLAY_APT_SOURCES: machine.aptFolder,
        START_DISPLAY_OS_RELEASE: machine.release,
        STAND_IN_CALLS: machine.calls,
        STAND_IN_FAILED_UPDATES: String(failedUpdates),
      },
    });
    return {
      status: outcome.status,
      output: `${outcome.stdout}${outcome.stderr}`,
      calls: existsSync(machine.calls)
        ? readFileSync(machine.calls, 'utf8').trim().split('\n')
        : [],
    };
  } finally {
    server.close();
  }
}

/** The files of the install's own sources folder. */
function ownSources(machine: Machine): string[] {
  return readdirSync(
    path.join(machine.logs, 'start-display-apt', 'sources.list.d'),
  ).sort();
}

/** The `-o` options that point apt at the install's own folder, as the calls carry them. */
function ownOptions(machine: Machine): string {
  const folder = path.join(machine.logs, 'start-display-apt');
  return [
    `-o Dir::Etc::sourcelist=${folder}/sources.list`,
    `-o Dir::Etc::sourceparts=${folder}/sources.list.d`,
  ].join(' ');
}

/** The apt-get call of `command` as the script makes it, with the options that point at the install's own folder. */
function aptCall(machine: Machine, command: string): string {
  const fixed =
    '-o DPkg::Lock::Timeout=300 -o Acquire::Retries=3 -o Dpkg::Use-Pty=0';
  return `apt-get ${command} ${fixed} ${ownOptions(machine)}${command === 'install' ? ' -y xdotool x11-utils wmctrl' : ''}`;
}

/** A hosted image's Ubuntu source, which names its archive through the mirror list in the machine's folder. */
const MIRROR_SOURCE = [
  'Types: deb',
  'URIs: mirror+file:<base>/apt-mirrors.txt',
  'Suites: noble noble-updates noble-backports',
  'Components: main universe restricted multiverse',
].join('\n');

/** The image's packages.microsoft.com source, which the display needs nothing from. */
const MICROSOFT_SOURCE =
  'deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n';

describe('start-display (card #3235)', () => {
  let machine: Machine | undefined;

  afterEach(() => {
    if (machine !== undefined) {
      rmSync(machine.base, {recursive: true, force: true});
      machine = undefined;
    }
  });

  it("#3235: on a hosted image the install reads the Ubuntu mirror's source alone, not packages.microsoft.com, from a folder of its own", async () => {
    machine = machineWith({
      'sources.list.d/ubuntu.sources': MIRROR_SOURCE,
      'sources.list.d/microsoft-prod.list': MICROSOFT_SOURCE,
    });
    writeFileSync(
      path.join(machine.base, 'apt-mirrors.txt'),
      'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n',
    );
    const outcome = await displayRun(machine);
    deepStrictEqual(
      {
        status: outcome.status,
        sources: ownSources(machine),
        calls: outcome.calls.filter(call => call.startsWith('apt-get')),
        imageSources: readdirSync(
          path.join(machine.aptFolder, 'sources.list.d'),
        ).sort(),
      },
      {
        status: 0,
        sources: ['ubuntu.sources'],
        calls: [aptCall(machine, 'update'), aptCall(machine, 'install')],
        imageSources: ['microsoft-prod.list', 'ubuntu.sources'],
      },
    );
  });

  it("#2832, #3235: with packages.microsoft.com alone, or a mirror list that names no Ubuntu archive, the release's standard sources are written into the install's own folder, never the image's", async () => {
    const written: unknown[] = [];
    for (const files of [
      {'sources.list.d/microsoft-prod.list': MICROSOFT_SOURCE},
      {'sources.list.d/other.sources': MIRROR_SOURCE},
    ]) {
      machine = machineWith(files);
      writeFileSync(
        path.join(machine.base, 'apt-mirrors.txt'),
        'https://mirror.example.com/debian/\n',
      );
      const outcome = await displayRun(machine);
      written.push({
        status: outcome.status,
        sources: ownSources(machine),
        suites: readFileSync(
          path.join(
            machine.logs,
            'start-display-apt',
            'sources.list.d',
            'start-display-ubuntu.sources',
          ),
          'utf8',
        )
          .split('\n')
          .filter(
            line => line.startsWith('URIs:') || line.startsWith('Suites:'),
          ),
        imageSources: readdirSync(
          path.join(machine.aptFolder, 'sources.list.d'),
        ),
      });
      rmSync(machine.base, {recursive: true, force: true});
      machine = undefined;
    }
    const standard = {
      status: 0,
      sources: ['start-display-ubuntu.sources'],
      suites: [
        'URIs: http://archive.ubuntu.com/ubuntu/',
        'Suites: noble noble-updates noble-security',
      ],
    };
    deepStrictEqual(written, [
      {...standard, imageSources: ['microsoft-prod.list']},
      {...standard, imageSources: ['other.sources']},
    ]);
  });

  it('#3235: an update that fails is tried again after 15 s, then a third time after 180 s', async () => {
    machine = machineWith({
      'sources.list':
        'deb http://archive.ubuntu.com/ubuntu noble main universe\n',
    });
    const outcome = await displayRun(machine, 2);
    deepStrictEqual(
      {
        status: outcome.status,
        sources: ownSources(machine),
        calls: outcome.calls.filter(
          call => call.startsWith('apt-get') || call.startsWith('sleep'),
        ),
        attempts: outcome.output
          .split('\n')
          .filter(line => line.includes('(attempt')),
      },
      {
        status: 0,
        sources: ['sources.list'],
        calls: [
          aptCall(machine, 'update'),
          'sleep 15',
          aptCall(machine, 'update'),
          'sleep 180',
          aptCall(machine, 'update'),
          aptCall(machine, 'install'),
        ],
        attempts: [
          'start-display: installing xdotool x11-utils wmctrl failed (attempt 1 of 3)',
          'start-display: installing xdotool x11-utils wmctrl failed (attempt 2 of 3)',
        ],
      },
    );
  });

  it("#3235: when the third attempt fails too, the step fails and prints the candidates from the install's own sources", async () => {
    machine = machineWith({
      'sources.list.d/ubuntu.sources':
        'Types: deb\nURIs: http://archive.ubuntu.com/ubuntu/\nSuites: noble\nComponents: main\n',
    });
    const outcome = await displayRun(machine, 3);
    deepStrictEqual(
      {
        status: outcome.status,
        updates: outcome.calls.filter(call => call.startsWith('apt-get update'))
          .length,
        policy: outcome.calls.filter(call => call.startsWith('apt-cache')),
        last: outcome.output.includes(
          'start-display: could not install xdotool x11-utils wmctrl; their candidates and the sources:',
        ),
      },
      {
        status: 1,
        updates: 3,
        policy: [
          `apt-cache ${ownOptions(machine)} policy xdotool x11-utils wmctrl`,
        ],
        last: true,
      },
    );
  });

  it('#3235: a machine that is not Ubuntu keeps its own sources', async () => {
    machine = machineWith(
      {'sources.list.d/microsoft-prod.list': MICROSOFT_SOURCE},
      'ID=debian\nVERSION_CODENAME=trixie\n',
    );
    const outcome = await displayRun(machine);
    deepStrictEqual(
      {
        status: outcome.status,
        calls: outcome.calls.filter(call => call.startsWith('apt-get')),
        ownFolder: existsSync(path.join(machine.logs, 'start-display-apt')),
      },
      {
        status: 0,
        calls: [
          'apt-get update -o DPkg::Lock::Timeout=300 -o Acquire::Retries=3 -o Dpkg::Use-Pty=0',
          'apt-get install -o DPkg::Lock::Timeout=300 -o Acquire::Retries=3 -o Dpkg::Use-Pty=0 -y xdotool x11-utils wmctrl',
        ],
        ownFolder: false,
      },
    );
  });
});
