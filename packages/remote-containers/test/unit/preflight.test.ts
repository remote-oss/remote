import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  EngineHost,
  EngineOptions,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  currentContext,
  type EngineDialogPort,
  firstCheck,
  type PreflightDependencies,
  secondCheck,
} from '../../src/engine/preflight.ts';

const NEVER_ABORTED = new AbortController().signal;

const GOOD_REPLY = '{"Server":{"ApiVersion":"1.51"}}';
const OLD_REPLY = '{"Server":{"ApiVersion":"1.30"}}';

/** How the scripted engine answers an argv: a finished run, a failed spawn, or a run that never ends on its own. */
type Answer = EngineRunOutcome | 'never';

/** A run that finished with `status`. */
function finished(
  status: number | undefined,
  stdout = '',
  stderr = '',
): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr};
}

const VERSION = ['--version'];
const STRUCTURED = ['version', '--format', '{{json .}}'];

/** The scripted surroundings, and everything they saw. */
interface Scene {
  dependencies: PreflightDependencies;
  files: string[];
  argvs: string[][];
  aborted: boolean[];
  dialogs: Array<[string, string, readonly string[]]>;
  opened: string[];
  logRevealed: number;
  lines: string[];
  timers: Array<{milliseconds: number; callback: () => void; stopped: boolean}>;
}

/** Surroundings whose engine answers each argv as `answers` says, and whose dialog answers `choices` in turn. */
function sceneOf(
  answers: Readonly<Record<string, Answer>>,
  options: {
    values?: unknown[];
    choices?: Array<string | undefined>;
    environmentSecret?: string;
  } = {},
): Scene {
  const sink = new MemorySink();
  const scene: Scene = {
    dependencies: undefined as unknown as PreflightDependencies,
    files: [],
    argvs: [],
    aborted: [],
    dialogs: [],
    opened: [],
    logRevealed: 0,
    lines: [],
    timers: [],
  };
  const values = [...(options.values ?? ['docker'])];
  const choices = [...(options.choices ?? [])];
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the method of the EngineHost port is named run
    run: (argv: readonly string[], input, runOptions: EngineOptions) => {
      scene.argvs.push([...argv]);
      const answer = answers[argv.join(' ')] ?? finished(1, '', 'unscripted');
      if (answer !== 'never') {
        return Promise.resolve(answer);
      }
      return new Promise(resolve => {
        runOptions.cancellation.addEventListener('abort', () => {
          scene.aborted.push(true);
          resolve(finished(undefined));
        });
      });
    },
    spawn: () => Promise.resolve({kind: 'failed', detail: 'not used'}),
  };
  const dialogs: EngineDialogPort = {
    showError: (message, detail, items) => {
      scene.dialogs.push([message, detail, items]);
      return Promise.resolve(choices.shift());
    },
    openExternal: address => {
      scene.opened.push(address);
      return Promise.resolve(undefined);
    },
    revealLog: () => {
      scene.logRevealed += 1;
    },
  };
  scene.dependencies = {
    engineFor: file => {
      scene.files.push(file);
      return engine;
    },
    dockerPath: () => (values.length > 1 ? values.shift() : values[0]),
    dialogs,
    translate: template => template,
    setTimer: (milliseconds, callback) => {
      const timer = {milliseconds, callback, stopped: false};
      scene.timers.push(timer);
      return () => {
        timer.stopped = true;
      };
    },
    clock: () => 0,
    logger: createLogger(sink, {minimumLevel: () => 'debug'}),
    searchPath: () => '/usr/bin:/bin',
  };
  Object.defineProperty(scene, 'lines', {
    get: () => sink.lines.map(line => `${line.level}: ${line.message}`),
  });
  return scene;
}

const PASSING: Record<string, Answer> = {
  [VERSION.join(' ')]: finished(0),
  [STRUCTURED.join(' ')]: finished(0, GOOD_REPLY),
};

function notFoundDialog(detail: string): [string, string, readonly string[]] {
  return [
    'Docker version 17.12.0 or later required.',
    detail,
    ['Install', 'License'],
  ];
}

const ERROR_DIALOG: [string, string, readonly string[]] = [
  'Docker returned an error.',
  'Make sure the Docker daemon is running.',
  ['Show Log'],
];

describe('the first check', () => {
  it('F-0201 AC-48: two queries, and nothing else, pass the check', async () => {
    const scene = sceneOf(PASSING);
    deepStrictEqual(
      [
        await firstCheck(scene.dependencies, undefined, NEVER_ABORTED),
        scene.argvs,
      ],
      ['proceed', [VERSION, STRUCTURED]],
    );
  });

  it('F-0201 AC-2: a program that is not there shows the dialog with the value as written, and no third query is made', async () => {
    const scene = sceneOf(
      {
        '--version': {
          kind: 'failed',
          detail: 'spawn no-such-docker-cli-0201 ENOENT',
        },
      },
      {values: ['no-such-docker-cli-0201'], choices: [undefined]},
    );
    deepStrictEqual(
      [
        await firstCheck(scene.dependencies, undefined, NEVER_ABORTED),
        scene.dialogs,
        scene.argvs,
      ],
      [
        'stopped',
        [
          notFoundDialog(
            "Command not found: 'no-such-docker-cli-0201'. Check the license for details.",
          ),
        ],
        [VERSION],
      ],
    );
  });

  for (const [button, address] of [
    ['Install', 'https://docs.docker.com/engine/install/'],
    [
      'License',
      'https://www.docker.com/legal/docker-subscription-service-agreement/',
    ],
  ] as const) {
    it(`F-0201 AC-3: ${button} opens its address once and stops`, async () => {
      const scene = sceneOf(
        {'--version': {kind: 'failed', detail: 'spawn dk ENOENT'}},
        {values: ['dk'], choices: [button]},
      );
      deepStrictEqual(
        [
          await firstCheck(scene.dependencies, undefined, NEVER_ABORTED),
          scene.opened,
        ],
        ['stopped', [address]],
      );
    });
  }

  for (const value of ['docker', undefined]) {
    it(`F-0201 AC-15: dockerPath ${String(value)} shows only the license hint in the detail`, async () => {
      const scene = sceneOf(
        {'--version': {kind: 'failed', detail: 'spawn docker ENOENT'}},
        {values: [value]},
      );
      await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
      deepStrictEqual(scene.dialogs, [
        notFoundDialog('Check the license for details.'),
      ]);
    });
  }

  it('F-0201 AC-7, AC-32: permission denied names docker whatever the value, and Documentation opens its address', async () => {
    const scene = sceneOf(
      {
        '--version': finished(0),
        [STRUCTURED.join(' ')]: finished(1, '', 'Error: Permission Denied'),
      },
      {values: ['dk-0201'], choices: ['Documentation']},
    );
    deepStrictEqual(
      [
        await firstCheck(scene.dependencies, undefined, NEVER_ABORTED),
        scene.dialogs,
        scene.opened,
      ],
      [
        'stopped',
        [
          [
            "Current user does not have permission to run 'docker'.",
            "Try adding the user to the 'docker' group.",
            ['Documentation'],
          ],
        ],
        ['https://docs.docker.com/engine/install/linux-postinstall/'],
      ],
    );
  });

  it('F-0201 AC-21, AC-31: an old engine offers Ignore, which proceeds; the other buttons stop; every call asks again', async () => {
    const oldEngine: Record<string, Answer> = {
      '--version': finished(0),
      [STRUCTURED.join(' ')]: finished(0, OLD_REPLY),
    };
    const scene = sceneOf(oldEngine, {
      choices: ['Ignore', 'Install', undefined, 'Ignore'],
    });
    const results = [];
    for (let call = 0; call < 4; call++) {
      results.push(
        await firstCheck(scene.dependencies, undefined, NEVER_ABORTED),
      );
    }
    deepStrictEqual(
      [results, scene.dialogs[0]?.[2], scene.dialogs.length, scene.opened],
      [
        ['proceed', 'stopped', 'stopped', 'proceed'],
        ['Install', 'License', 'Ignore'],
        4,
        ['https://docs.docker.com/engine/install/'],
      ],
    );
  });

  it('F-0201 AC-8: a reply that names no version passes without a dialog', async () => {
    const scene = sceneOf({
      '--version': finished(0),
      [STRUCTURED.join(' ')]: finished(0, 'not-a-version-string'),
    });
    deepStrictEqual(
      [
        await firstCheck(scene.dependencies, undefined, NEVER_ABORTED),
        scene.dialogs,
      ],
      ['proceed', []],
    );
  });

  for (const code of ['EACCES', 'ENOTDIR']) {
    it(`F-0201 AC-16: a spawn that fails with ${code} shows the engine error dialog`, async () => {
      const scene = sceneOf({
        '--version': {kind: 'failed', detail: `spawn dk ${code}`},
      });
      await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
      deepStrictEqual(scene.dialogs, [ERROR_DIALOG]);
    });
  }

  it('F-0201 AC-16: Show Log reveals the log once and stops', async () => {
    const scene = sceneOf(
      {'--version': {kind: 'failed', detail: 'spawn dk EACCES'}},
      {choices: ['Show Log']},
    );
    deepStrictEqual(
      [
        await firstCheck(scene.dependencies, undefined, NEVER_ABORTED),
        scene.logRevealed,
      ],
      ['stopped', 1],
    );
  });

  it('F-0201 AC-25: an engine that is not running shows the engine error dialog', async () => {
    const scene = sceneOf({
      '--version': finished(0),
      [STRUCTURED.join(' ')]: finished(
        1,
        '',
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
      ),
    });
    await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    deepStrictEqual(scene.dialogs, [ERROR_DIALOG]);
  });

  it('F-0408 AC-7: a check whose signal was aborted stops with no dialog, whatever the killed queries printed', async () => {
    const scene = sceneOf({
      '--version': finished(0),
      [STRUCTURED.join(' ')]: finished(undefined),
    });
    const answer = await firstCheck(
      scene.dependencies,
      undefined,
      AbortSignal.abort(),
    );
    deepStrictEqual([answer, scene.dialogs], ['stopped', []]);
  });

  it('F-0201 AC-20: a query that never ends is ended at 60 000 ms, and only then is the dialog shown', async () => {
    const scene = sceneOf({'--version': 'never'});
    const checking = firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    await Promise.resolve();
    const before = [scene.dialogs.length, scene.aborted.length];
    scene.timers[0]?.callback();
    await checking;
    deepStrictEqual(
      [before, scene.timers[0]?.milliseconds, scene.aborted, scene.dialogs],
      [[0, 0], 60_000, [true], [ERROR_DIALOG]],
    );
  });

  it('F-0201 AC-22: the setting is read at every call', async () => {
    const scene = sceneOf(
      {'--version': {kind: 'failed', detail: 'spawn x ENOENT'}},
      {values: ['missing-a', 'missing-b']},
    );
    await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    deepStrictEqual(
      scene.dialogs.map(dialog => dialog[1]),
      [
        "Command not found: 'missing-a'. Check the license for details.",
        "Command not found: 'missing-b'. Check the license for details.",
      ],
    );
  });

  for (const value of ['~/bin/dk', '/usr/bin/docker --debug']) {
    it(`F-0201 AC-38: ${value} is named as written`, async () => {
      const scene = sceneOf(
        {'--version': {kind: 'failed', detail: 'spawn x ENOENT'}},
        {values: [value]},
      );
      await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
      deepStrictEqual(
        scene.dialogs[0]?.[1],
        `Command not found: '${value}'. Check the license for details.`,
      );
    });
  }

  it('F-0201 BR-1, AC-55: a relative value with no base names the value and runs no query', async () => {
    const scene = sceneOf({}, {values: ['tools/dk']});
    await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    deepStrictEqual(
      [scene.dialogs[0]?.[1], scene.argvs],
      ["Command not found: 'tools/dk'. Check the license for details.", []],
    );
  });

  it('contracts 6: a value with spaces and quotes reaches the engine unchanged', async () => {
    const scene = sceneOf(PASSING, {values: ["/opt/my docker/dk 'q'"]});
    await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    deepStrictEqual(scene.files, [
      "/opt/my docker/dk 'q'",
      "/opt/my docker/dk 'q'",
    ]);
  });

  it('contracts 6, R-26: no argv holds a secret of the environment', async () => {
    const scene = sceneOf(PASSING);
    process.env.CONTAINERS_TEST_TOKEN = 'secret-0201';
    await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    delete process.env.CONTAINERS_TEST_TOKEN;
    deepStrictEqual(
      scene.argvs.flat().filter(word => word.includes('secret-0201')),
      [],
    );
  });

  it('F-0201 7.E1: a spawn that fails with ENOENT is logged with the PATH searched', async () => {
    const scene = sceneOf(
      {'--version': {kind: 'failed', detail: 'spawn dk ENOENT'}},
      {values: ['dk']},
    );
    await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    deepStrictEqual(scene.lines, [
      'debug: docker: --version → ENOENT (0 ms)',
      'warn: dk was not found; PATH: /usr/bin:/bin',
    ]);
  });
});

describe('the second check', () => {
  for (const [name, answer, expected] of [
    ['an exit of 0', finished(0), {kind: 'passed'}],
    [
      'a spawn failure',
      {kind: 'failed', detail: 'spawn dk ENOENT'},
      {kind: 'failed', detail: 'S339'},
    ],
    [
      'permission denied',
      finished(
        1,
        '',
        'permission denied while trying to connect to the docker API at unix:///var/run/docker.sock',
      ),
      {kind: 'failed', detail: 'S104'},
    ],
    ['another exit', finished(1, '', 'boom'), {kind: 'failed', detail: 'S144'}],
  ] as ReadonlyArray<[string, EngineRunOutcome, unknown]>) {
    it(`F-0201 7.E14, 7.E16: ${name} is ${JSON.stringify(expected)} and shows no dialog`, async () => {
      const scene = sceneOf({version: answer});
      deepStrictEqual(
        [
          await secondCheck(scene.dependencies, undefined, NEVER_ABORTED),
          scene.dialogs,
        ],
        [expected, []],
      );
    });
  }

  it('F-0201 AC-36, AC-46: a query that never ends fails with S144 at 60 000 ms', async () => {
    const scene = sceneOf({version: 'never'});
    const checking = secondCheck(scene.dependencies, undefined, NEVER_ABORTED);
    await Promise.resolve();
    scene.timers[0]?.callback();
    deepStrictEqual(
      [await checking, scene.timers[0]?.milliseconds],
      [{kind: 'failed', detail: 'S144'}, 60_000],
    );
  });

  it('F-0201 BR-1: a relative value with no base fails with S339 and runs nothing', async () => {
    const scene = sceneOf({}, {values: ['tools/dk']});
    deepStrictEqual(
      [
        await secondCheck(scene.dependencies, undefined, NEVER_ABORTED),
        scene.argvs,
      ],
      [{kind: 'failed', detail: 'S339'}, []],
    );
  });
});

describe('the first check, when the version reply names no server (card containers-108)', () => {
  /** `podman version --format '{{json .}}'` as Podman 5.8.9 rootless answered it: a client and no server. */
  const PODMAN_REPLY =
    '{"Client":{"APIVersion":"5.8.9","Version":"5.8.9","GoVersion":"go1.26.9-X:nodwarf5","GitCommit":"40030f4073bd4e1bf4f2fd9df2f6952b4d9d350a","BuiltTime":"Mon Oct 12 00:00:00 2026","Built":1791763200,"OsArch":"linux/amd64","Os":"linux"}}';

  /** What the first check gave over this reply to the structured query, and the lines it logged about the API check. */
  async function checked(reply: string) {
    const scene = sceneOf({
      [VERSION.join(' ')]: finished(0),
      [STRUCTURED.join(' ')]: finished(0, reply),
    });
    return {
      result: await firstCheck(scene.dependencies, undefined, NEVER_ABORTED),
      lines: scene.lines.filter(line => line.includes('API check')),
      dialogs: scene.dialogs.length,
    };
  }

  it('F-0201 AC-4, containers-108: the reply of Podman passes, and the skipped API check is logged once at info', async () => {
    deepStrictEqual(await checked(PODMAN_REPLY), {
      result: 'proceed',
      lines: [
        "info: the engine's version reply names no server API version; the API check was skipped",
      ],
      dialogs: 0,
    });
  });

  it('F-0201 BR-5, containers-108: the reply of Docker, which names a server, logs nothing of the API check', async () => {
    deepStrictEqual(await checked(GOOD_REPLY), {
      result: 'proceed',
      lines: [],
      dialogs: 0,
    });
  });

  it('containers-108: a first check whose client query failed has no version reply to say anything about', async () => {
    const scene = sceneOf({
      [VERSION.join(' ')]: finished(1),
      [STRUCTURED.join(' ')]: finished(0, PODMAN_REPLY),
    });
    await firstCheck(scene.dependencies, undefined, NEVER_ABORTED);
    deepStrictEqual(
      scene.lines.filter(line => line.includes('API check')),
      [],
    );
  });
});

describe('the current context', () => {
  for (const [name, answer, expected] of [
    ['default', finished(0, 'default\n'), undefined],
    ['a named context', finished(0, 'desktop-linux\n'), 'desktop-linux'],
    ['an empty answer', finished(0, ''), undefined],
  ] as ReadonlyArray<[string, EngineRunOutcome, string | undefined]>) {
    it(`F-0501 BR-2a: ${name} gives ${String(expected)}`, async () => {
      const scene = sceneOf({'context show': answer});
      deepStrictEqual(
        await currentContext(scene.dependencies, undefined, NEVER_ABORTED),
        expected,
      );
    });
  }

  for (const [name, answer, line] of [
    [
      'an exit of 125, as Podman answers a command it does not have',
      finished(125),
      'debug: the Docker context could not be read: 125',
    ],
    [
      'an exit of 1',
      finished(1),
      'debug: the Docker context could not be read: 1',
    ],
    [
      'a query that did not finish',
      finished(undefined),
      'warn: the Docker context could not be read: signal',
    ],
    [
      'a spawn that fails',
      {kind: 'failed', detail: 'spawn dk ENOENT'},
      'warn: the Docker context could not be read: ENOENT',
    ],
  ] as ReadonlyArray<[string, EngineRunOutcome, string]>) {
    it(`F-0501 BR-2a: ${name} gives no context and is logged`, async () => {
      const scene = sceneOf({'context show': answer});
      deepStrictEqual(
        [
          await currentContext(scene.dependencies, undefined, NEVER_ABORTED),
          scene.lines.filter(entry => entry.includes('could not be read')),
        ],
        [undefined, [line]],
      );
    });
  }

  it('F-0501 BR-2a: a relative value with no base gives no context and is logged', async () => {
    const scene = sceneOf({}, {values: ['tools/dk']});
    deepStrictEqual(
      [
        await currentContext(scene.dependencies, undefined, NEVER_ABORTED),
        scene.lines,
      ],
      [undefined, ['warn: the Docker context could not be read: not found']],
    );
  });
});
