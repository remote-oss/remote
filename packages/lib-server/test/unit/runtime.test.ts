import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  RecordingChannel,
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {
  type HostLockLoop,
  isAcceptedBindHost,
  isExtensionIdentifier,
  rangeProblem,
  RESULT_BEGIN,
  RESULT_END,
  type RuntimeOptions,
  serverPort,
  startOrReuse,
  type StartOutcome,
} from '../../src/index.ts';
import {
  fakeHost,
  type FakeHost,
  parametersFor,
  runScript,
  single,
} from './fake-host.ts';
import {prerequisiteDetail} from '../../src/lifecycle/runtime.ts';
import {shellChannel} from './shell-channel.ts';

const NEVER_CANCELLED = new AbortController().signal;

const OPTIONS: RuntimeOptions = {
  bindHost: '127.0.0.1',
  portRange: '',
  licenceAccepted: false,
  graceSeconds: 0,
  defaultExtensions: [],
  fileWatcherPollingMilliseconds: 0,
  readySeconds: 3,
  socketMode: false,
};

/** The loop that runs the step once. */
function runOnce(step: Parameters<HostLockLoop>[0]): ReturnType<HostLockLoop> {
  return step();
}

function lines(status: string, ...facts: string[]): string[] {
  return [RESULT_BEGIN, `status=${status}`, ...facts, RESULT_END];
}

function answering(output: readonly string[]): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: () => true,
    lines: output,
    ending: {kind: 'exit', status: 0},
  };
}

function recording(
  output: readonly string[],
  hint: 'linux' | 'windows' = 'linux',
): RecordingChannel {
  return new RecordingChannel({
    identity: 'h',
    platformHint: hint,
    scripts: [
      {
        ...answering(output),
        interpreter: hint === 'windows' ? 'powershell' : 'posixShell',
      },
    ],
  });
}

const STARTED = lines(
  'Ok',
  'server.port=4321',
  'server.pid=77',
  'server.token=abcdefghijklmnopqrstuvwxyz012345',
);

function dependencies(loop: HostLockLoop = runOnce): {
  lockLoop: HostLockLoop;
  logger: ReturnType<typeof createLogger>;
  sink: MemorySink;
} {
  const sink = new MemorySink();
  return {
    lockLoop: loop,
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
    sink,
  };
}

async function start(
  channel: RecordingChannel,
  options: Partial<RuntimeOptions> = {},
  allowed: ReadonlyArray<'fileWatcherPolling' | 'useHostProxy'> = [],
  loop?: HostLockLoop,
  requirementsCheck: 'serverBundled' | 'bundledHelper' = 'serverBundled',
  extensionEntries: 'identifiersOnly' | 'asWritten' = 'identifiersOnly',
): Promise<StartOutcome> {
  return startOrReuse(
    channel,
    parametersFor(),
    {...OPTIONS, ...options},
    {allowedExtraStartOptions: allowed, extensionEntries, requirementsCheck},
    dependencies(loop),
    NEVER_CANCELLED,
  );
}

/** The script text of the only run the channel got. */
function scriptOf(channel: RecordingChannel): string {
  const call = channel.calls[0];
  return call?.operation === 'runScript' ? call.request.script : '';
}

/** A lock loop's answer after three attempts that all met a held lock. */
const EXHAUSTED = {
  kind: 'retriesExhausted' as const,
  last: {kind: 'noResultBlock' as const, exitStatus: 0},
  attempts: 3,
};

describe('the bind host check (F-2409 7.E1)', () => {
  const ACCEPTED = [
    '0.0.0.0',
    '127.0.0.1',
    'localhost',
    'my-host',
    '999.1.1.1',
    'a..b',
    '.',
    '[::1]',
    '[fe80::1]',
    '[zz]',
  ];
  for (const value of ACCEPTED) {
    it(`F-2409.7.E1: ${value} is accepted`, () => {
      deepStrictEqual(isAcceptedBindHost(value), true);
    });
  }

  const REJECTED = [
    '-a',
    '-D',
    '--help',
    '',
    'not a host!',
    '127.0.0.1 ',
    '::1',
    '1.2.3.4:5',
    'my_host',
    'ho$t',
    'host/x',
    'héllo',
    '[::1',
    '[1.2.3.4]',
  ];
  for (const value of REJECTED) {
    it(`F-2409.7.E1: ${JSON.stringify(value)} is rejected`, () => {
      deepStrictEqual(isAcceptedBindHost(value), false);
    });
  }
});

describe('the port range check (F-2409 7.E6 to 7.E8)', () => {
  const REVERSED = ['5000-4000', '10-5', '65535-1'];
  for (const range of REVERSED) {
    it(`F-2409.7.E6: ${range} is reversed`, () => {
      deepStrictEqual(rangeProblem(range), 'reversed');
    });
  }

  const MALFORMED: unknown[] = [
    'abc',
    '45030',
    '70000-70010',
    '0-10',
    '1-65536',
    'x-y',
    '5-',
    '1-2-3',
    '-5',
    45030,
    true,
    null,
    {},
    [],
  ];
  for (const entry of MALFORMED) {
    it(`F-2409.7.E7: ${JSON.stringify(entry)} is malformed`, () => {
      deepStrictEqual(rangeProblem(entry), 'malformed');
    });
  }

  const WELL_FORMED: unknown[] = [
    '4000-5000',
    '5000-5000',
    '1-1',
    '65535-65535',
    '1-65535',
    '',
    undefined,
  ];
  for (const entry of WELL_FORMED) {
    it(`F-2409.BR-2: ${JSON.stringify(entry)} passes`, () => {
      deepStrictEqual(rangeProblem(entry), undefined);
    });
  }
});

describe('the default extension shape (F-2506 BR-2)', () => {
  for (const entry of ['ms-python.python', 'a.b', '1x.2y', 'pub-.name-']) {
    it(`F-2506.BR-2: ${entry} is an identifier`, () => {
      deepStrictEqual(isExtensionIdentifier(entry), true);
    });
  }

  for (const entry of [
    'python',
    'a.b.c',
    'a.b@1.0',
    '.b',
    'a.',
    '-a.b',
    'a.-b',
    '',
    'a b.c',
  ]) {
    it(`F-2506.BR-2: ${JSON.stringify(entry)} is dropped`, () => {
      deepStrictEqual(isExtensionIdentifier(entry), false);
    });
  }
});

describe('startOrReuse (V7), answers mapped', () => {
  it('V7: the port, process and token of an Ok block are the server', async () => {
    const outcome = await start(recording(STARTED));
    deepStrictEqual(
      outcome.kind === 'started' ? outcome.server : outcome.kind,
      {
        endpoint: {kind: 'port', port: 4321},
        processId: 77,
        connectionToken: 'abcdefghijklmnopqrstuvwxyz012345',
        reused: false,
      },
    );
  });

  it('V7: a server the host says it found running is reused', async () => {
    const outcome = await start(
      recording(
        lines(
          'Ok',
          'server.port=4321',
          'server.pid=77',
          'server.token=t',
          'server.reused=yes',
        ),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'started' ? outcome.server.reused : outcome.kind,
      true,
    );
  });

  it('F-2410 5.0 step 5: a socket path in the facts is a socket endpoint', async () => {
    const outcome = await start(
      recording(
        lines(
          'Ok',
          'server.socketPath=/tmp/code-ab',
          'server.pid=77',
          'server.token=t',
        ),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'started' ? outcome.server.endpoint : outcome.kind,
      {kind: 'socket', path: '/tmp/code-ab'},
    );
  });

  it('V7: a socket path that is not absolute is unreadable facts', async () => {
    const outcome = await start(
      recording(
        lines(
          'Ok',
          'server.socketPath=code-ab',
          'server.pid=77',
          'server.token=t',
        ),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'unreadableServerFacts'},
    );
  });

  it('V7: when both a socket path and a port are given the socket decides', async () => {
    const outcome = await start(
      recording(
        lines(
          'Ok',
          'server.socketPath=/tmp/code-ab',
          'server.port=4321',
          'server.pid=77',
          'server.token=t',
        ),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'started' ? outcome.server.endpoint : outcome.kind,
      {kind: 'socket', path: '/tmp/code-ab'},
    );
  });

  const UNUSABLE_FACTS = [
    ['no facts at all', lines('Ok')],
    [
      'a port that is not a number',
      lines('Ok', 'server.port=abc', 'server.pid=77', 'server.token=t'),
    ],
    ['port 0', lines('Ok', 'server.port=0', 'server.pid=77', 'server.token=t')],
    [
      'port 65536',
      lines('Ok', 'server.port=65536', 'server.pid=77', 'server.token=t'),
    ],
    [
      'a process id of 0',
      lines('Ok', 'server.port=4321', 'server.pid=0', 'server.token=t'),
    ],
    [
      'a process id of 1',
      lines('Ok', 'server.port=4321', 'server.pid=1', 'server.token=t'),
    ],
    [
      'a process id that is not a number',
      lines('Ok', 'server.port=4321', 'server.pid=x', 'server.token=t'),
    ],
    [
      'an empty token',
      lines('Ok', 'server.port=4321', 'server.pid=77', 'server.token='),
    ],
    ['no token', lines('Ok', 'server.port=4321', 'server.pid=77')],
  ] as const;
  for (const [problem, output] of UNUSABLE_FACTS) {
    it(`V7: an Ok block with ${problem} is not a started server`, async () => {
      const outcome = await start(recording(output));
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.failure : outcome.kind,
        {kind: 'unreadableServerFacts'},
      );
    });
  }

  it('V7: the highest port and the lowest process id that are valid are accepted', async () => {
    const outcome = await start(
      recording(
        lines('Ok', 'server.port=65535', 'server.pid=2', 'server.token=t'),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'started'
        ? [outcome.server.endpoint, outcome.server.processId]
        : outcome.kind,
      [{kind: 'port', port: 65535}, 2],
    );
  });

  it('#668 R1: a start whose script could not write a path carries the write failure', async () => {
    const outcome = await start(
      recording(
        lines(
          'CreateInstallDirFailed',
          'server.writeFailedPath=/h/.s/.abc.token',
          'server.writeFailedError=Permission denied',
        ),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {
        kind: 'scriptFailed',
        status: 'CreateInstallDirFailed',
        writeFailure: {path: '/h/.s/.abc.token', error: 'Permission denied'},
      },
    );
  });

  for (const [answer, flag] of [
    ['yes', true],
    ['no', false],
  ] as const) {
    it(`#668 R7: a write failure on the lock file with the lock in the temporary folder ${answer} says so`, async () => {
      const outcome = await start(
        recording(
          lines(
            'CreateInstallDirFailed',
            'server.writeFailedPath=/h/lock',
            'server.writeFailedError=Is a directory',
            'server.lockPath=/h/lock',
            `server.lockInTemporary=${answer}`,
          ),
        ),
      );
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.failure : outcome.kind,
        {
          kind: 'scriptFailed',
          status: 'CreateInstallDirFailed',
          writeFailure: {
            path: '/h/lock',
            error: 'Is a directory',
            lockInTemporary: flag,
          },
        },
      );
    });
  }

  it('#668 R7: a write failure on another path says nothing of the lock', async () => {
    const outcome = await start(
      recording(
        lines(
          'CreateInstallDirFailed',
          'server.writeFailedPath=/h/bin/abc',
          'server.writeFailedError=denied',
          'server.lockPath=/h/lock',
          'server.lockInTemporary=no',
        ),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {
        kind: 'scriptFailed',
        status: 'CreateInstallDirFailed',
        writeFailure: {path: '/h/bin/abc', error: 'denied'},
      },
    );
  });

  it('#668 R1: a CreateInstallDirFailed block with no path has no write failure', async () => {
    const outcome = await start(recording(lines('CreateInstallDirFailed')));
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'scriptFailed', status: 'CreateInstallDirFailed'},
    );
  });

  it('#668 R4: a loop that gave up after a busy lock carries the lock file and the attempts', async () => {
    const outcome = await start(recording(STARTED), {}, [], () =>
      Promise.resolve({
        kind: 'retriesExhausted',
        attempts: 30,
        last: {
          kind: 'result',
          exitStatus: 0,
          block: {
            status: 'LockBusy',
            hostFacts: {},
            serverFacts: {lockPath: '/h/.s/bin/abc/lock'},
            cliFacts: {},
            timings: {},
          },
        },
      }),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'retriesExhausted', attempts: 30, lockPath: '/h/.s/bin/abc/lock'},
    );
  });

  it('F-2409.BR-9: a block of ServerFailedToStart is serverStart', async () => {
    const outcome = await start(recording(lines('ServerFailedToStart')));
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'serverStart'},
    );
  });

  it('F-2409.6.2: a server that found no free port in its range is serverStart with that cause', async () => {
    const outcome = await start(
      recording(lines('ServerFailedToStart', 'server.failure=noFreePort')),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'serverStart', cause: 'noFreePort'},
    );
  });

  it('F-2409.AC-30: a server that ended for CVE-2020-1416 is serverStart with that cause', async () => {
    const outcome = await start(
      recording(lines('ServerFailedToStart', 'server.failure=cveTerminated')),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'serverStart', cause: 'cveTerminated'},
    );
  });

  it('F-2409.BR-9: another value of the failure fact gives no cause', async () => {
    const outcome = await start(
      recording(lines('ServerFailedToStart', 'server.failure=something')),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'serverStart'},
    );
  });

  it('F-2703.7.E2: a block of LinuxPrereqs is prerequisitesMissing', async () => {
    const outcome = await start(recording(lines('LinuxPrereqs')));
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'prerequisitesMissing', detail: ''},
    );
  });

  it('F-0503 7.E1: LinuxPrereqs carries the lines of the helper as its detail', async () => {
    const outcome = await start(
      recording(
        lines(
          'LinuxPrereqs',
          'server.prerequisites.1=Warning: Missing GLIBC >= 2.28!',
          'server.prerequisites.2=Error: Missing required dependencies.',
        ),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {
        kind: 'prerequisitesMissing',
        detail:
          'Warning: Missing GLIBC >= 2.28!\nError: Missing required dependencies.',
      },
    );
  });

  it('F-0503 7.E1: a gap in the numbered lines ends the detail', async () => {
    const outcome = await start(
      recording(
        lines(
          'LinuxPrereqs',
          'server.prerequisites.1=A',
          'server.prerequisites.3=C',
        ),
      ),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {
        kind: 'prerequisitesMissing',
        detail: 'A',
      },
    );
  });

  it('V7: another status is scriptFailed with the status', async () => {
    const outcome = await start(recording(lines('UnpackFailed')));
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'scriptFailed', status: 'UnpackFailed'},
    );
  });

  it('V1: no block is noResultBlock', async () => {
    const outcome = await start(recording([]));
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'noResultBlock'},
    );
  });

  it('H1: a channel failure is a value', async () => {
    const channel = new RecordingChannel({
      identity: 'h',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: [],
          ending: {
            kind: 'fail',
            failure: {kind: 'channelClosed', detail: 'gone'},
          },
        },
      ],
    });
    const outcome = await start(channel);
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
      'channelFailed',
    );
  });

  it('F-2408.BR-5: a loop that gives up is retriesExhausted', async () => {
    const outcome = await start(recording(STARTED), {}, [], () =>
      Promise.resolve(EXHAUSTED),
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      {kind: 'retriesExhausted', attempts: 3},
    );
  });

  it('F-2408.BR-5: a LockBusy block is retried by the loop and the next answer is the start', async () => {
    const channel = new RecordingChannel({
      identity: 'h',
      platformHint: 'linux',
      scripts: [answering(lines('LockBusy')), answering(STARTED)],
    });
    async function retryOnce(
      step: Parameters<HostLockLoop>[0],
    ): ReturnType<HostLockLoop> {
      const first = await step();
      const busy = first.kind === 'result' && first.block.status === 'LockBusy';
      return busy ? step() : first;
    }
    const outcome = await start(channel, {}, [], retryOnce);
    deepStrictEqual(
      outcome.kind === 'started' ? outcome.server.endpoint : outcome.kind,
      {kind: 'port', port: 4321},
    );
  });
});

describe('startOrReuse (V7), what is asked of the host', () => {
  it('F-2409.7.E6: a reversed range fails before the host is asked anything', async () => {
    const channel = recording(STARTED);
    const outcome = await start(channel, {portRange: '5000-4000'});
    deepStrictEqual(
      [
        outcome.kind === 'failed' ? outcome.failure : outcome.kind,
        channel.calls.length,
      ],
      [{kind: 'invalidPortRange'}, 0],
    );
  });

  it('F-2409.BR-5: a rejected bind host is replaced by the loopback address, with a notice', async () => {
    const channel = recording(STARTED);
    const outcome = await start(channel, {bindHost: 'not a host!'});
    deepStrictEqual(
      [
        outcome.kind === 'started' ? outcome.notices : outcome.kind,
        scriptOf(channel).includes("BIND_HOST='127.0.0.1'"),
      ],
      [[{kind: 'bindHostRejected', configured: 'not a host!'}], true],
    );
  });

  it('F-2409.BR-5: an accepted bind host is passed on unchanged', async () => {
    const channel = recording(STARTED);
    await start(channel, {bindHost: '0.0.0.0'});
    deepStrictEqual(scriptOf(channel).includes("BIND_HOST='0.0.0.0'"), true);
  });

  it('F-2409.BR-2: no range asks for a random free port', async () => {
    const channel = recording(STARTED);
    await start(channel);
    deepStrictEqual(scriptOf(channel).includes("SERVER_PORT='0'"), true);
  });

  it('F-2409.BR-2: a range goes to the host as written', async () => {
    const channel = recording(STARTED);
    await start(channel, {portRange: '8000-8010'});
    deepStrictEqual(
      scriptOf(channel).includes("SERVER_PORT='8000-8010'"),
      true,
    );
  });

  it('R-68: the licence terms are accepted only when the caller says so', async () => {
    const channel = recording(STARTED);
    await start(channel);
    deepStrictEqual(
      scriptOf(channel).includes('--accept-server-license-terms'),
      false,
    );
  });

  it('R-68: an accepted licence passes the flag', async () => {
    const channel = recording(STARTED);
    await start(channel, {licenceAccepted: true});
    deepStrictEqual(
      scriptOf(channel).includes('--accept-server-license-terms'),
      true,
    );
  });

  it('F-2413.7.E5: a grace time goes to a Linux host', async () => {
    const channel = recording(STARTED);
    await start(channel, {graceSeconds: 60});
    deepStrictEqual(
      scriptOf(channel).includes('--reconnection-grace-time'),
      true,
    );
  });

  it('F-2413.7.E5: a grace time never goes to a Windows host', async () => {
    const channel = recording(STARTED, 'windows');
    await start(channel, {graceSeconds: 60});
    deepStrictEqual(
      scriptOf(channel).includes('--reconnection-grace-time'),
      false,
    );
  });

  it('F-2506.BR-2: only entries of the right shape are passed, in the order written', async () => {
    const channel = recording(STARTED);
    await start(channel, {
      defaultExtensions: ['one.alpha', 'bad', 'Two.Beta', 'x@1.2'],
    });
    deepStrictEqual(
      ['one.alpha', 'Two.Beta'].every(extension =>
        scriptOf(channel).includes(`'--install-extension' '${extension}'`),
      ),
      true,
    );
  });

  it('F-0505 BR-2, BR-4, BR-7: under asWritten every entry reaches the script as written, in order', async () => {
    const channel = recording(STARTED);
    await start(
      channel,
      {defaultExtensions: ['x.y@3.0.1', 'c.three@prerelease', 'not-an-id']},
      [],
      undefined,
      'serverBundled',
      'asWritten',
    );
    const script = scriptOf(channel);
    deepStrictEqual(
      [
        script.indexOf("'--install-extension' 'x.y@3.0.1'") <
          script.indexOf("'--install-extension' 'c.three@prerelease'"),
        script.indexOf("'--install-extension' 'c.three@prerelease'") <
          script.indexOf("'--install-extension' 'not-an-id'"),
        script.includes("'--install-extension' 'x.y@3.0.1'"),
      ],
      [true, true, true],
    );
  });

  it('F-0505 BR-7: under identifiersOnly the same entries are still dropped', async () => {
    const channel = recording(STARTED);
    await start(channel, {
      defaultExtensions: ['x.y@3.0.1', 'c.three@prerelease', 'not-an-id'],
    });
    deepStrictEqual(scriptOf(channel).includes('--install-extension'), false);
  });

  it('F-2506.BR-2: an entry of the wrong shape never reaches the script', async () => {
    const channel = recording(STARTED);
    await start(channel, {defaultExtensions: ['bad']});
    deepStrictEqual(scriptOf(channel).includes("'bad'"), false);
  });

  /** The log messages of a start with the given default extension entries. */
  async function messagesLoggedFor(
    defaultExtensions: readonly string[],
    extensionEntries: 'identifiersOnly' | 'asWritten' = 'identifiersOnly',
  ): Promise<string[]> {
    const sink = new MemorySink();
    await startOrReuse(
      recording(STARTED),
      parametersFor(),
      {...OPTIONS, defaultExtensions},
      {
        allowedExtraStartOptions: [],
        extensionEntries,
        requirementsCheck: 'serverBundled',
      },
      {
        lockLoop: runOnce,
        logger: createLogger(sink, {minimumLevel: () => 'info'}),
      },
      NEVER_CANCELLED,
    );
    return sink.lines.map(line => line.message);
  }

  it('F-2506.BR-2: an entry that is dropped is logged', async () => {
    deepStrictEqual(await messagesLoggedFor(['one.alpha', 'bad entry']), [
      'default extension: one.alpha',
      'default extension dropped, not <publisher>.<name>: bad entry',
    ]);
  });

  it('F-0505 BR-7: under asWritten each entry is logged as kept, and none as dropped', async () => {
    deepStrictEqual(
      await messagesLoggedFor(['x.y@3', 'not-an-id'], 'asWritten'),
      ['default extension: x.y@3', 'default extension: not-an-id'],
    );
  });

  it('R-79: the lock loop gets the cancellation of the start', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    function remembering(
      step: Parameters<HostLockLoop>[0],
      cancellation: AbortSignal,
    ): ReturnType<HostLockLoop> {
      received = cancellation;
      return step();
    }
    await startOrReuse(
      recording(STARTED),
      parametersFor(),
      OPTIONS,
      {
        allowedExtraStartOptions: [],
        extensionEntries: 'identifiersOnly',
        requirementsCheck: 'serverBundled',
      },
      {
        lockLoop: remembering,
        logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
      },
      controller.signal,
    );
    deepStrictEqual(received, controller.signal);
  });

  it('F-2506.Q1: each extension passed is logged by id', async () => {
    deepStrictEqual(await messagesLoggedFor(['one.alpha']), [
      'default extension: one.alpha',
    ]);
  });

  it('F-6601: the file watcher option goes when the policy allows it', async () => {
    const channel = recording(STARTED);
    await start(channel, {fileWatcherPollingMilliseconds: 500}, [
      'fileWatcherPolling',
    ]);
    deepStrictEqual(
      scriptOf(channel).includes("'--file-watcher-polling' '500'"),
      true,
    );
  });

  it('F-6601: the file watcher option stays out when the policy does not allow it', async () => {
    const channel = recording(STARTED);
    await start(channel, {fileWatcherPollingMilliseconds: 500});
    deepStrictEqual(
      scriptOf(channel).includes('--file-watcher-polling'),
      false,
    );
  });

  it('R-83: telemetry is off on every start', async () => {
    const channel = recording(STARTED);
    await start(channel);
    deepStrictEqual(
      scriptOf(channel).includes("'--telemetry-level' 'off'"),
      true,
    );
  });

  it('F-2410: socket mode reaches the start script as a parameter', async () => {
    const channel = recording(STARTED);
    await start(channel, {socketMode: true});
    deepStrictEqual(scriptOf(channel).includes("SOCKET_MODE='yes'"), true);
  });

  it('R-79: the wait for the ready line is the caller bound', async () => {
    const channel = recording(STARTED);
    await start(channel, {readySeconds: 17});
    deepStrictEqual(scriptOf(channel).includes("READY_SECONDS='17'"), true);
  });
});

describe('serverPort (V7)', () => {
  it('F-2509: the port of a started server', () => {
    deepStrictEqual(
      serverPort({
        endpoint: {kind: 'port', port: 4321},
        processId: 1,
        connectionToken: 't',
        reused: false,
      }),
      4321,
    );
  });

  it('F-2509 AC-19: none for a server that listens on a socket', () => {
    deepStrictEqual(
      serverPort({
        endpoint: {kind: 'socket', path: '/tmp/code-ab'},
        processId: 1,
        connectionToken: 't',
        reused: false,
      }),
      'none',
    );
  });

  it('F-2509: none when no server runs', () => {
    deepStrictEqual(serverPort(undefined), 'none');
  });
});

describe('startOrReuse (V7) over a real shell', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = fakeHost();
    runScript(host, single('install'), parametersFor());
  });

  afterEach(() => {
    runScript(host, single('kill'), parametersFor());
  });

  it('F-2409.BR-1: the real script starts the stand-in server and its port is read', async () => {
    const outcome = await startOrReuse(
      shellChannel(host),
      parametersFor(),
      OPTIONS,
      {
        allowedExtraStartOptions: [],
        extensionEntries: 'identifiersOnly',
        requirementsCheck: 'serverBundled',
      },
      dependencies(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'started' ? outcome.server.endpoint : outcome.kind,
      {kind: 'port', port: 4321},
    );
  });

  it('F-2410: a start in socket mode over the real shell ends on a socket endpoint', async () => {
    const outcome = await startOrReuse(
      shellChannel(host),
      parametersFor(),
      {...OPTIONS, socketMode: true},
      {
        allowedExtraStartOptions: [],
        extensionEntries: 'identifiersOnly',
        requirementsCheck: 'serverBundled',
      },
      dependencies(),
      NEVER_CANCELLED,
    );
    deepStrictEqual(
      outcome.kind === 'started' ? outcome.server.endpoint.kind : outcome.kind,
      'socket',
    );
  });

  it('F-2409.BR-8: a second start reuses the server: the same process id, and only the second says so', async () => {
    const started = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await startOrReuse(
        shellChannel(host),
        parametersFor(),
        OPTIONS,
        {
          allowedExtraStartOptions: [],
          extensionEntries: 'identifiersOnly',
          requirementsCheck: 'serverBundled',
        },
        dependencies(),
        NEVER_CANCELLED,
      );
      started.push(
        outcome.kind === 'started'
          ? [outcome.server.processId, outcome.server.reused]
          : outcome.kind,
      );
    }
    deepStrictEqual(
      [started[0]?.[0] === started[1]?.[0], started[0]?.[1], started[1]?.[1]],
      [true, false, true],
    );
  });

  it('F-0503 BR-18: the host-proxy option goes when the policy allows it', async () => {
    const channel = recording(STARTED);
    await start(channel, {}, ['useHostProxy']);
    deepStrictEqual(scriptOf(channel).includes("'--use-host-proxy'"), true);
  });

  it('F-0503 BR-18: the host-proxy option stays out when the policy does not allow it', async () => {
    const channel = recording(STARTED);
    await start(channel);
    deepStrictEqual(scriptOf(channel).includes('--use-host-proxy'), false);
  });

  it('contracts 5.0: the requirements helper runs before a launch only under the bundledHelper policy', async () => {
    const bundled = recording(STARTED);
    const own = recording(STARTED);
    await start(bundled, {}, [], undefined, 'bundledHelper');
    await start(own);
    deepStrictEqual(
      [bundled, own].map(channel =>
        scriptOf(channel).includes("REQUIREMENTS_HELPER='yes'"),
      ),
      [true, false],
    );
  });

  it('F-0503: a server with no requirements helper is started and the notice says so', async () => {
    const outcome = await start(
      recording([
        ...STARTED.slice(0, -1),
        'server.prerequisitesHelper=missing',
        STARTED.at(-1) ?? '',
      ]),
      {},
      [],
      undefined,
      'bundledHelper',
    );
    deepStrictEqual(
      outcome.kind === 'started' ? outcome.notices : outcome.kind,
      [{kind: 'requirementsHelperMissing'}],
    );
  });
});

describe('prerequisiteDetail (F-0503 7.E1)', () => {
  it('is empty for no lines, the line for one, and the lines joined for several', () => {
    deepStrictEqual(
      [
        prerequisiteDetail({}),
        prerequisiteDetail({'prerequisites.1': 'A'}),
        prerequisiteDetail({'prerequisites.1': 'A', 'prerequisites.2': 'B'}),
      ],
      ['', 'A', 'A\nB'],
    );
  });

  it('stops at the first missing number and at the twentieth line', () => {
    const facts = Object.fromEntries(
      Array.from(Array(25).keys(), index => [
        `prerequisites.${String(index + 1)}`,
        String(index + 1),
      ]),
    );
    deepStrictEqual(
      [
        prerequisiteDetail({'prerequisites.1': 'A', 'prerequisites.3': 'C'}),
        prerequisiteDetail(facts).split('\n').length,
      ],
      ['A', 20],
    );
  });
});
