import {deepStrictEqual} from 'node:assert';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {
  RecordingChannel,
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {
  cleanup,
  kill,
  type MaintenanceOutcome,
  probe,
  type ProbedHost,
  type ProbeOutcome,
  RESULT_BEGIN,
  RESULT_END,
  runStep,
  templatePlatformOf,
  uninstall,
} from '../../src/index.ts';
import {
  fakeHost,
  type FakeHost,
  installFolder,
  parametersFor,
  runScript,
  single,
} from './fake-host.ts';
import {shellChannel} from './shell-channel.ts';

const NEVER_CANCELLED = new AbortController().signal;

/** A scripted answer to any script, with the given output lines and a clean exit. */
function answering(
  lines: readonly string[],
  interpreter: ScriptAnswer['interpreter'] = 'posixShell',
): ScriptAnswer {
  return {
    interpreter,
    matches: () => true,
    lines,
    ending: {kind: 'exit', status: 0},
  };
}

/** The lines of a result block with the given status and facts. */
function block(status: string, ...facts: string[]): string[] {
  return [RESULT_BEGIN, `status=${status}`, ...facts, RESULT_END];
}

const LINUX_FACTS = [
  'host.os=linux',
  'host.arch=arm64',
  'host.libc=musl',
  'host.release=alpine',
  'host.home=/home/dev',
  'host.tmp=/tmp',
  'host.shell=ash',
  'host.tool.tar=yes',
  'host.tool.wget=yes',
  'host.tool.curl=no',
  'host.tool.unzip=no',
  'host.tool.flock=yes',
  'host.wgetBusybox=yes',
  'host.sshAuthSock=/tmp/agent',
  'host.display=:0',
  'server.installDir=/home/dev/.data/bin/abc123',
  'server.installed=yes',
];

function recording(
  lines: readonly string[],
  hint: 'linux' | 'windows' = 'linux',
): RecordingChannel {
  return new RecordingChannel({
    identity: 'h',
    platformHint: hint,
    scripts: [
      answering(lines, hint === 'windows' ? 'powershell' : 'posixShell'),
    ],
  });
}

/** A channel whose every script ends in a failure of the given kind. */
function failing(kind: 'channelClosed' | 'timeout'): RecordingChannel {
  return new RecordingChannel({
    identity: 'h',
    platformHint: 'linux',
    scripts: [
      {
        interpreter: 'posixShell',
        matches: () => true,
        lines: [],
        ending: {kind: 'fail', failure: {kind, detail: 'ended'}},
      },
    ],
  });
}

/** The failure kind of a failed probe, or the outcome's own kind. */
function failureOf(outcome: ProbeOutcome): string {
  return outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind;
}

describe('runStep (a step over the host channel)', () => {
  it('V1: a block in the output is the result', async () => {
    const result = await runStep(
      recording(block('Ok', 'server.port=1')),
      single('probe'),
      parametersFor(),
      {cancellation: NEVER_CANCELLED},
    );
    deepStrictEqual(
      result.kind === 'result' ? result.block.serverFacts : result.kind,
      {port: '1'},
    );
  });

  it('V1: output without a block is noResultBlock', async () => {
    const result = await runStep(
      recording(['nothing useful']),
      single('probe'),
      parametersFor(),
      {cancellation: NEVER_CANCELLED},
    );
    deepStrictEqual(result.kind, 'noResultBlock');
  });

  it('H1: a channel failure is a value', async () => {
    const channel = failing('channelClosed');
    const result = await runStep(channel, single('probe'), parametersFor(), {
      cancellation: NEVER_CANCELLED,
    });
    deepStrictEqual(
      result.kind === 'channelFailed' ? result.failure.kind : result.kind,
      'channelClosed',
    );
  });

  it('V1: every output line reaches onLine, in order', async () => {
    const seen: string[] = [];
    await runStep(
      recording(['first', ...block('Ok')]),
      single('probe'),
      parametersFor(),
      {cancellation: NEVER_CANCELLED, onLine: line => seen.push(line)},
    );
    deepStrictEqual(seen[0], 'first');
  });

  /** The interpreters the channel was asked for after a probe run on it. */
  async function interpretersAfterProbe(
    channel: RecordingChannel,
  ): Promise<string[]> {
    await runStep(channel, single('probe'), parametersFor(), {
      cancellation: NEVER_CANCELLED,
    });
    return channel.calls.map(call =>
      call.operation === 'runScript' ? call.request.interpreter : 'copy',
    );
  }

  it('F-2701: a Windows host gets the PowerShell script', async () => {
    deepStrictEqual(
      await interpretersAfterProbe(recording(block('Ok'), 'windows')),
      ['powershell'],
    );
  });

  it('F-2703: any other host gets the POSIX script', async () => {
    deepStrictEqual(await interpretersAfterProbe(recording(block('Ok'))), [
      'posixShell',
    ]);
  });
});

describe('probe (V2)', () => {
  it('F-2401.BR-2: the facts of a Linux host with musl are read', async () => {
    const outcome = await probe(
      recording(block('Ok', ...LINUX_FACTS)),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? [
            outcome.host.operatingSystem,
            outcome.host.architecture,
            outcome.host.libc,
            outcome.host.release,
            outcome.host.home,
          ]
        : outcome.kind,
      ['linux', 'arm64', 'musl', 'alpine', '/home/dev'],
    );
  });

  it('F-2402: the tools the host has are read, and the BusyBox wget', async () => {
    const outcome = await probe(
      recording(block('Ok', ...LINUX_FACTS)),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? [outcome.host.tools, outcome.host.busyboxWget]
        : outcome.kind,
      [['wget', 'tar', 'flock'], true],
    );
  });

  it("F-2311: the session's agent socket and display are read", async () => {
    const outcome = await probe(
      recording(block('Ok', ...LINUX_FACTS)),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? [outcome.host.sshAuthSock, outcome.host.display]
        : outcome.kind,
      ['/tmp/agent', ':0'],
    );
  });

  it('F-3902.10: an installed server and its folder are read', async () => {
    const outcome = await probe(
      recording(block('Ok', ...LINUX_FACTS)),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? [outcome.host.installed, outcome.host.installFolder]
        : outcome.kind,
      [true, '/home/dev/.data/bin/abc123'],
    );
  });

  it('F-2401.BR-2: a macOS host with few facts reads with empty values', async () => {
    const outcome = await probe(
      recording(
        block('Ok', 'host.os=darwin', 'host.arch=x64', 'host.tool.tar=yes'),
      ),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? [
            outcome.host.operatingSystem,
            outcome.host.architecture,
            outcome.host.libc,
            outcome.host.release,
            outcome.host.installed,
          ]
        : outcome.kind,
      ['darwin', 'x64', 'unknown', '', false],
    );
  });

  it('F-2401.BR-2: an armhf host with glibc is read', async () => {
    const outcome = await probe(
      recording(
        block(
          'Ok',
          'host.os=linux',
          'host.arch=armhf',
          'host.libc=glibc',
          'host.tool.tar=yes',
        ),
      ),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? [outcome.host.architecture, outcome.host.libc]
        : outcome.kind,
      ['armhf', 'glibc'],
    );
  });

  for (const token of [
    'x64',
    'arm64',
    'armhf',
    'ppc64le',
    'riscv64',
    'loong64',
    's390x',
  ]) {
    it(`#670 R1: a host of the architecture ${token} is read`, async () => {
      const outcome = await probe(
        recording(
          block(
            'Ok',
            'host.os=linux',
            `host.arch=${token}`,
            'host.tool.tar=yes',
          ),
        ),
        parametersFor(),
        NEVER_CANCELLED,
      );
      deepStrictEqual(
        outcome.kind === 'probed' ? outcome.host.architecture : outcome.kind,
        token,
      );
    });
  }

  it('#670 R1: x86 is not an architecture token, so the facts are unreadable', async () => {
    const outcome = await probe(
      recording(block('Ok', 'host.os=linux', 'host.arch=x86')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unreadableFacts', field: 'arch'},
    );
  });

  it('F-2401.7.E5: an unsupported platform with no fact names nothing', async () => {
    const outcome = await probe(
      recording(block('UnsupportedPlatform')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unsupportedPlatform', reported: ''},
    );
  });

  it('F-2401.AC-10: an unsupported architecture with no fact names nothing', async () => {
    const outcome = await probe(
      recording(block('UnsupportedArch')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unsupportedArch', reported: '', libc: 'unknown'},
    );
  });

  it('F-2401.7.E5: UnsupportedPlatform names the platform it found', async () => {
    const outcome = await probe(
      recording(block('UnsupportedPlatform', 'host.os=FreeBSD')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unsupportedPlatform', reported: 'FreeBSD'},
    );
  });

  it('F-2401.AC-10: UnsupportedArch names the machine it found', async () => {
    const outcome = await probe(
      recording(block('UnsupportedArch', 'host.arch=i686')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unsupportedArch', reported: 'i686', libc: 'unknown'},
    );
  });

  it('F-2401.AC-10: UnsupportedArch names the C library it found', async () => {
    const outcome = await probe(
      recording(block('UnsupportedArch', 'host.arch=armv7l', 'host.libc=musl')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unsupportedArch', reported: 'armv7l', libc: 'musl'},
    );
  });

  it('F-2401: a host is named for the templates by its system and architecture, and a musl Linux is alpine', () => {
    function host(libc: 'glibc' | 'musl' | 'unknown'): ProbedHost {
      return {
        operatingSystem: 'linux',
        architecture: 'arm64',
        libc,
        release: '',
        home: '/home/u',
        temporaryFolder: '/tmp',
        loginShell: 'sh',
        tools: [],
        busyboxWget: false,
        sshAuthSock: '',
        display: '',
        installed: false,
        installFolder: '',
        treeComplete: false,
      };
    }
    deepStrictEqual(
      (['glibc', 'musl', 'unknown'] as const).map(libc =>
        templatePlatformOf(host(libc)),
      ),
      [
        {operatingSystem: 'linux', architecture: 'arm64'},
        {operatingSystem: 'alpine', architecture: 'arm64'},
        {operatingSystem: 'linux', architecture: 'arm64'},
      ],
    );
  });

  it('F-2401.BR-2: an operating system this library cannot run is unreadable, not Linux', async () => {
    const outcome = await probe(
      recording(block('Ok', 'host.os=plan9', 'host.arch=x64')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unreadableFacts', field: 'os'},
    );
  });

  it('F-2401.BR-2: an architecture this library cannot run is unreadable, not x64', async () => {
    const outcome = await probe(
      recording(block('Ok', 'host.os=linux', 'host.arch=mips')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unreadableFacts', field: 'arch'},
    );
  });

  it('F-2703: a host that has gzip reports it among its tools', async () => {
    const outcome = await probe(
      recording(
        block(
          'Ok',
          'host.os=linux',
          'host.arch=x64',
          'host.tool.tar=yes',
          'host.tool.gzip=yes',
        ),
      ),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed' ? outcome.host.tools : outcome.kind,
      ['tar', 'gzip'],
    );
  });

  it('F-2401.BR-1: a host without tar lacks a prerequisite', async () => {
    const outcome = await probe(
      recording(
        block(
          'Ok',
          ...LINUX_FACTS.map(fact =>
            fact === 'host.tool.tar=yes' ? 'host.tool.tar=no' : fact,
          ),
        ),
      ),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'prerequisiteMissing', missing: ['tar']},
    );
  });

  it('V2: another status is probeFailed, with the status', async () => {
    const outcome = await probe(
      recording(block('ServerFailedToStart')),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'probeFailed', status: 'ServerFailedToStart'},
    );
  });

  it('V1: a probe without a result block is noResultBlock', async () => {
    deepStrictEqual(
      failureOf(await probe(recording([]), parametersFor(), NEVER_CANCELLED)),
      'noResultBlock',
    );
  });

  it('H1: a probe whose channel failed says so', async () => {
    const channel = failing('timeout');
    deepStrictEqual(
      failureOf(await probe(channel, parametersFor(), NEVER_CANCELLED)),
      'channelFailed',
    );
  });

  it('F-2701: the Windows stand-in answers as a failed probe, not a crash', async () => {
    const channel = recording(
      block('ServerFailedToStart', 'host.note=not available'),
      'windows',
    );
    deepStrictEqual(
      failureOf(await probe(channel, parametersFor(), NEVER_CANCELLED)),
      'probeFailed',
    );
  });
});

describe('the lifecycle over a real shell', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = fakeHost();
  });

  afterEach(() => {
    runScript(host, single('kill'), parametersFor());
  });

  it('F-2401: probing a fake Linux host finds it, and no server yet', async () => {
    const outcome = await probe(
      shellChannel(host),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? [outcome.host.operatingSystem, outcome.host.installed]
        : failureOf(outcome),
      ['linux', false],
    );
  });

  it('F-2703.BR-9: a probe whose script arrives on standard input finds the host', async () => {
    const outcome = await probe(
      shellChannel(host, 'linux', 'stdin'),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed'
        ? outcome.host.operatingSystem
        : failureOf(outcome),
      'linux',
    );
  });

  it('F-2401: probing finds a server that is installed', async () => {
    runScript(host, single('install'), parametersFor());
    const outcome = await probe(
      shellChannel(host),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed' ? outcome.host.installed : failureOf(outcome),
      true,
    );
  });

  it('F-2401: the probe reads the home folder of the host', async () => {
    const outcome = await probe(
      shellChannel(host),
      parametersFor(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'probed' ? outcome.host.home : failureOf(outcome),
      host.home,
    );
  });

  function maintained(action: typeof kill): Promise<MaintenanceOutcome> {
    return action(shellChannel(host), parametersFor(), NEVER_CANCELLED);
  }

  it('F-2411.BR-3: kill removes bin/ and is done', async () => {
    runScript(host, single('install'), parametersFor());
    const outcome = await maintained(kill);
    deepStrictEqual(
      [outcome.kind, existsSync(path.join(installFolder(host), 'bin'))],
      ['done', false],
    );
  });

  it('F-2412.BR-3: uninstall removes the data folder and is done', async () => {
    runScript(host, single('install'), parametersFor());
    const outcome = await maintained(uninstall);
    deepStrictEqual(
      [outcome.kind, existsSync(path.join(host.home, '.server-data'))],
      ['done', false],
    );
  });

  it('F-2413.BR-9: cleanup is done on a host with one install', async () => {
    runScript(host, single('install'), parametersFor());
    deepStrictEqual((await maintained(cleanup)).kind, 'done');
  });
});

describe('maintenance outcomes', () => {
  it('H1: a channel failure of kill is a value', async () => {
    const channel = failing('channelClosed');
    deepStrictEqual(
      (await kill(channel, parametersFor(), NEVER_CANCELLED)).kind,
      'channelFailed',
    );
  });

  it('V8: a script that reports another status than Ok is scriptFailed', async () => {
    deepStrictEqual(
      await uninstall(
        recording(block('ServerFailedToStart')),
        parametersFor(),
        NEVER_CANCELLED,
      ),
      {kind: 'scriptFailed', status: 'ServerFailedToStart'},
    );
  });

  it('V8: a script that prints no block is noResultBlock', async () => {
    deepStrictEqual(
      (await cleanup(recording([]), parametersFor(), NEVER_CANCELLED)).kind,
      'noResultBlock',
    );
  });

  for (const [fact, expected] of [
    [['server.treeComplete=yes'], true],
    [['server.treeComplete=no'], false],
    [[], false],
  ] as const) {
    it(`F-0503 BR-4: the probe reads ${fact.length === 0 ? 'no tree fact' : fact[0]} as treeComplete ${String(expected)}`, async () => {
      const outcome = await probe(
        recording(block('Ok', ...LINUX_FACTS, ...fact)),
        parametersFor(),
        NEVER_CANCELLED,
      );
      deepStrictEqual(
        outcome.kind === 'probed' ? outcome.host.treeComplete : outcome.kind,
        expected,
      );
    });
  }
});
