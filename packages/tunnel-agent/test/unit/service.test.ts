import {deepStrictEqual, rejects} from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runProgram} from '../../src/process-runner.ts';
import {
  installService,
  type ProgramOutcome,
  type ServicePorts,
  UNIT_NAME,
  uninstallService,
  unitFolderOf,
  unitTextOf,
} from '../../src/service.ts';

const LAUNCHER = '/opt/agent/bin/tunnel-agent';

/** The folder of a row, removed by the suite. */
let home = '';

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'tunnel-agent-service-'));
});

afterEach(() => {
  rmSync(home, {recursive: true, force: true});
});

/** What a run printed, the programs it started with their words, and its status. */
interface Ran {
  stdout: string;
  stderr: string;
  calls: string[][];
  status: number;
}

const EXITED_OK: ProgramOutcome = {
  kind: 'exited',
  status: 0,
  stdout: '',
  stderr: '',
};

/** Runs `command` over a runner that answers each start by `answers`, which answers 0 for any it does not name. */
async function ranWith(
  command: (ports: ServicePorts) => Promise<number>,
  answers: Readonly<Record<string, ProgramOutcome>> = {},
  changes: Partial<ServicePorts> = {},
): Promise<Ran> {
  const result: Ran = {stdout: '', stderr: '', calls: [], status: 0};
  result.status = await command({
    runner: (program, programArguments) => {
      const call = [program, ...programArguments];
      result.calls.push(call);
      return Promise.resolve(answers[call.join(' ')] ?? EXITED_OK);
    },
    output: {
      stdout: text => {
        result.stdout += text;
      },
      stderr: text => {
        result.stderr += text;
      },
    },
    home,
    user: 'alice',
    launcher: LAUNCHER,
    ...changes,
  });
  return result;
}

function unitFile(): string {
  return path.join(unitFolderOf({home}), UNIT_NAME);
}

const RELOAD = 'systemctl --user daemon-reload';
const ENABLE = `systemctl --user enable --now ${UNIT_NAME}`;
const DISABLE = `systemctl --user disable --now ${UNIT_NAME}`;
const LINGER = 'loginctl show-user alice -p Linger';

/** A run of a program that ended with `status` and printed `stdout` and `stderr`. */
function ending(status: number, stdout = '', stderr = ''): ProgramOutcome {
  return {kind: 'exited', status, stdout, stderr};
}

describe('the agent as a systemd user service (card #3164)', () => {
  it('writes the unit text of the design, with no network-online target and the launcher in quotes', () => {
    deepStrictEqual(
      unitTextOf(LAUNCHER),
      [
        '[Unit]',
        'Description=Remote tunnel host agent',
        'StartLimitIntervalSec=0',
        '',
        '[Service]',
        'Type=simple',
        'ExecStart="/opt/agent/bin/tunnel-agent"',
        'Restart=always',
        'RestartSec=10',
        'UMask=0077',
        'NoNewPrivileges=true',
        '',
        '[Install]',
        'WantedBy=default.target',
        '',
      ].join('\n'),
    );
  });

  it('writes a quote, a backslash, a percent sign and a dollar sign of the launcher’s path as systemd reads them', () => {
    deepStrictEqual(
      unitTextOf('/opt/a b"c\\d%e$f/tunnel-agent')
        .split('\n')
        .find(line => line.startsWith('ExecStart=')),
      'ExecStart="/opt/a b\\"c\\\\d%%e$$f/tunnel-agent"',
    );
  });

  it('puts the unit under XDG_CONFIG_HOME when the environment names it, and under ~/.config when it does not or names nothing', () => {
    deepStrictEqual(
      [
        unitFolderOf({home: '/home/alice', configHome: '/x/config'}),
        unitFolderOf({home: '/home/alice'}),
        unitFolderOf({home: '/home/alice', configHome: ''}),
      ],
      [
        '/x/config/systemd/user',
        '/home/alice/.config/systemd/user',
        '/home/alice/.config/systemd/user',
      ],
    );
  });

  it('installs by writing the unit, reloading, enabling it now, and asking whether the user lingers, in that order, with no sudo', async () => {
    const result = await ranWith(installService, {
      [LINGER]: ending(0, 'Linger=yes\n'),
    });
    deepStrictEqual(
      [
        result.calls,
        readFileSync(unitFile(), 'utf8'),
        (statSync(unitFile()).mode & 0o777).toString(8),
        readdirSync(path.dirname(unitFile())),
        result.stdout,
        result.stderr,
        result.status,
      ],
      [
        [RELOAD.split(' '), ENABLE.split(' '), LINGER.split(' ')],
        unitTextOf(LAUNCHER),
        '644',
        [UNIT_NAME],
        `Installed and started ${UNIT_NAME}.\n`,
        '',
        0,
      ],
    );
  });

  it('gives the unit file its mode whatever the umask of the process is', async () => {
    const before = process.umask(0o077);
    try {
      await ranWith(installService);
    } finally {
      process.umask(before);
    }
    deepStrictEqual((statSync(unitFile()).mode & 0o777).toString(8), '644');
  });

  it('prints one line about logging out when the user does not linger, and none when it cannot tell', async () => {
    function lingering(answer: ProgramOutcome): Promise<string> {
      return ranWith(installService, {[LINGER]: answer}).then(
        result => result.stdout,
      );
    }
    const line =
      'The service runs only while you are logged in. Run "loginctl enable-linger" to keep it running after you log out.\n';
    deepStrictEqual(
      await Promise.all([
        lingering(ending(0, 'Linger=no\n')),
        lingering(ending(0, 'Linger=yes\n')),
        lingering(ending(1, '', 'no such user')),
        lingering({kind: 'failedToStart', message: 'ENOENT'}),
      ]),
      [
        `Installed and started ${UNIT_NAME}.\n${line}`,
        `Installed and started ${UNIT_NAME}.\n`,
        `Installed and started ${UNIT_NAME}.\n`,
        `Installed and started ${UNIT_NAME}.\n`,
      ],
    );
  });

  it('stops at a systemctl that fails with its own message and leaves no unit file, and enables nothing after a failed reload', async () => {
    const reload = await ranWith(installService, {
      [RELOAD]: ending(1, '', 'Failed to connect to bus\n'),
    });
    const enable = await ranWith(installService, {
      [ENABLE]: ending(1, 'Unit is masked\n', ''),
    });
    const silent = await ranWith(installService, {[ENABLE]: ending(5)});
    const absent = await ranWith(installService, {
      [RELOAD]: {kind: 'failedToStart', message: 'spawn systemctl ENOENT'},
    });
    deepStrictEqual(
      [
        reload.calls.length,
        reload.stderr,
        enable.stderr,
        silent.stderr,
        absent.stderr,
        [reload, enable, silent, absent].map(each => each.status),
        readdirSync(path.dirname(unitFile())),
      ],
      [
        1,
        'tunnel-agent service install: systemctl --user daemon-reload: Failed to connect to bus\n',
        `tunnel-agent service install: systemctl --user enable --now ${UNIT_NAME}: Unit is masked\n`,
        `tunnel-agent service install: systemctl --user enable --now ${UNIT_NAME}: it ended with status 5\n`,
        'tunnel-agent service install: systemctl --user daemon-reload: could not start the program: spawn systemctl ENOENT\n',
        [1, 1, 1, 1],
        [],
      ],
    );
  });

  it('puts back the unit an earlier install left when a new one fails', async () => {
    mkdirSync(path.dirname(unitFile()), {recursive: true});
    writeFileSync(unitFile(), 'earlier unit');
    await ranWith(installService, {[ENABLE]: ending(1, '', 'failed')});
    deepStrictEqual(readFileSync(unitFile(), 'utf8'), 'earlier unit');
  });

  it('fails an install whose unit path cannot be read as a file, with the system’s error', async () => {
    mkdirSync(unitFile(), {recursive: true});
    await rejects(ranWith(installService), {code: 'EISDIR'});
  });

  it('uninstalls by disabling the unit now, removing its file and reloading, in that order', async () => {
    await ranWith(installService);
    const result = await ranWith(uninstallService);
    deepStrictEqual(
      [
        result.calls,
        readdirSync(path.dirname(unitFile())),
        result.stdout,
        result.stderr,
        result.status,
      ],
      [
        [DISABLE.split(' '), RELOAD.split(' ')],
        [],
        `Stopped and removed ${UNIT_NAME}.\n`,
        '',
        0,
      ],
    );
  });

  it('says nothing is installed, runs nothing and ends with status 0 when there is no unit', async () => {
    deepStrictEqual(await ranWith(uninstallService), {
      stdout: `${UNIT_NAME} is not installed.\n`,
      stderr: '',
      calls: [],
      status: 0,
    });
  });

  it('keeps the unit file when the unit cannot be disabled, and ends with status 1 when the reload after the removal fails', async () => {
    await ranWith(installService);
    const kept = await ranWith(uninstallService, {
      [DISABLE]: ending(1, '', 'Failed to disable'),
    });
    const keptFile = readdirSync(path.dirname(unitFile()));
    const reloaded = await ranWith(uninstallService, {
      [RELOAD]: ending(1, '', 'Failed to reload'),
    });
    deepStrictEqual(
      [
        kept.stderr,
        kept.status,
        keptFile,
        reloaded.stderr,
        reloaded.status,
        readdirSync(path.dirname(unitFile())),
      ],
      [
        'tunnel-agent service uninstall: systemctl --user disable --now remote-oss-tunnel-agent.service: Failed to disable\n',
        1,
        [UNIT_NAME],
        'tunnel-agent service uninstall: systemctl --user daemon-reload: Failed to reload\n',
        1,
        [],
      ],
    );
  });

  it('installs under the folder XDG_CONFIG_HOME names', async () => {
    const configHome = path.join(home, 'xdg');
    await ranWith(installService, {}, {configHome});
    deepStrictEqual(readdirSync(path.join(configHome, 'systemd', 'user')), [
      UNIT_NAME,
    ]);
  });
});

describe('the program runner of the agent (card #3164)', () => {
  it('gives what a program printed and its status, whatever it is, and a program that cannot start as a failure to start', async () => {
    deepStrictEqual(
      await Promise.all([
        runProgram(process.execPath, [
          '-e',
          "process.stdout.write('out'); process.stderr.write('err')",
        ]),
        runProgram(process.execPath, ['-e', 'process.exit(7)']),
        runProgram(path.join(home, 'no-such-program'), []),
      ]).then(outcomes =>
        outcomes.map(outcome =>
          outcome.kind === 'exited'
            ? [outcome.status, outcome.stdout, outcome.stderr]
            : [outcome.kind, outcome.message.includes('ENOENT')],
        ),
      ),
      [
        [0, 'out', 'err'],
        [7, '', ''],
        ['failedToStart', true],
      ],
    );
  });
});
