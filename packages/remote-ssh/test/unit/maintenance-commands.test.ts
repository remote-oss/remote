import {deepStrictEqual, rejects} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {HostListResult, SshTarget} from 'lib-ssh';
import {
  maintenanceHandlers,
  type MaintenanceEditor,
} from '../../src/maintenance/maintenance-commands.ts';
import type {MaintenanceRun} from '../../src/maintenance/maintenance-run.ts';
import type {PickerItem} from '../../src/connect/picker-model.ts';

const DEV_ROW: PickerItem = {kind: 'host', label: 'dev', keepVisible: false};

const RAN_OK: MaintenanceRun = {result: 'stepRan', cause: ''};

const FAILED: MaintenanceRun = {
  result: 'connectionFailed',
  cause: 'the connection failed: x',
};

interface Setup {
  /** What the ports did, in order: the local server ended, a notice, the switch to a local window. */
  order: string[];
  runs: string[];
  /** The target each run was given, in order. */
  targets: SshTarget[];
  notices: Array<[string, readonly string[]]>;
  commands: string[];
  revealed: number;
  /** The host strings whose local connection server was ended. */
  ended: string[];
  sink: MemorySink;
  kill(): Promise<void>;
  uninstall(): Promise<void>;
  killCurrent(): Promise<void>;
}

function setup(
  options: {
    picked?: PickerItem | undefined;
    listing?: HostListResult;
    outcome?: MaintenanceRun;
    answer?: string;
    /** The notice stays open and never answers. */
    noticeOpen?: boolean;
    /** What the window holds: its host and the mode of its connection. */
    held?: {target: SshTarget; terminalMode: boolean};
    /** The switch to a local window rejects. */
    switchFails?: boolean;
  } = {},
): Setup {
  const seen: Setup = {
    order: [],
    runs: [],
    targets: [],
    notices: [],
    commands: [],
    revealed: 0,
    ended: [],
    sink: new MemorySink(),
    kill: () => Promise.resolve(),
    uninstall: () => Promise.resolve(),
    killCurrent: () => Promise.resolve(),
  };
  const editor: MaintenanceEditor = {
    listHosts: () => options.listing ?? {hosts: [{name: 'dev', file: '/f'}]},
    pickHost: () =>
      Promise.resolve('picked' in options ? options.picked : DEV_ROW),
    runCommand: commandId => {
      seen.commands.push(commandId);
      return Promise.resolve();
    },
    switchToLocalWindow: () => {
      seen.order.push('switch');
      return options.switchFails === true
        ? Promise.reject(new Error('no window'))
        : Promise.resolve();
    },
  };
  const handlers = maintenanceHandlers({
    editor,
    perform: (action, target: SshTarget) => {
      seen.runs.push(`${action} ${target.host}`);
      seen.targets.push(target);
      return Promise.resolve(options.outcome ?? RAN_OK);
    },
    heldHost: () => options.held,
    killLocalServer: hostString => {
      seen.order.push(`end ${hostString}`);
      seen.ended.push(hostString);
      return Promise.resolve();
    },
    leaveWindow: () => {
      seen.order.push('leave');
    },
    stayInWindow: () => {
      seen.order.push('stay');
    },
    notice: {
      showInformation: (message, buttons) => {
        seen.order.push(`notice ${message}`);
        seen.notices.push([message, buttons]);
        return options.noticeOpen === true
          ? new Promise<undefined>(() => undefined)
          : Promise.resolve(options.answer);
      },
      showWarning: () => Promise.resolve(undefined),
      showError: () => Promise.resolve(undefined),
    },
    translate: template => template,
    revealLog: () => {
      seen.revealed += 1;
    },
    logger: createLogger(seen.sink, {minimumLevel: () => 'info'}),
  });
  seen.kill = () => handlers.cleanRemoteServer.execute() as Promise<void>;
  seen.uninstall = () => handlers.cleanDevBox.execute() as Promise<void>;
  seen.killCurrent = () =>
    handlers.cleanCurrentRemoteServer.execute() as Promise<void>;
  return seen;
}

describe('Kill VS Code Server on Host... (F-2411)', () => {
  it('F-2411.AC-5: the picked host is killed and the notice says so, with Open Logs', async () => {
    const scenario = setup();
    await scenario.kill();
    deepStrictEqual(
      [scenario.runs, scenario.notices],
      [['kill dev'], [['Killed VS Code Server on dev.', ['Open Logs']]]],
    );
  });

  it('F-2411.AC-4: Escape on the pick runs nothing and shows nothing', async () => {
    const scenario = setup({picked: undefined});
    await scenario.kill();
    deepStrictEqual([scenario.runs, scenario.notices], [[], []]);
  });

  it('F-2411.AC-14: a host that could not be reached says so, with Open Logs', async () => {
    const scenario = setup({outcome: FAILED});
    await scenario.kill();
    deepStrictEqual(scenario.notices, [
      ['Failed to kill VS Code Server on dev.', ['Open Logs']],
    ]);
  });

  it('F-2411.7.E1: a failed kill is logged at warn with its cause', async () => {
    const scenario = setup({outcome: FAILED});
    await scenario.kill();
    deepStrictEqual(
      scenario.sink.lines.map(line => [line.level, line.message]),
      [['warn', 'the kill failed: the connection failed: x']],
    );
  });

  it('F-2206 AC-26: Escape at the platform pick ends the kill with the kill-failed notice and no local end', async () => {
    const scenario = setup({
      outcome: {
        result: 'cancelled',
        cause: 'the platform pick was dismissed',
      },
    });
    await scenario.kill();
    deepStrictEqual(
      [scenario.notices, scenario.ended],
      [[['Failed to kill VS Code Server on dev.', ['Open Logs']]], []],
    );
  });

  it('F-2411.AC-8: Open Logs reveals the log', async () => {
    const scenario = setup({answer: 'Open Logs'});
    await scenario.kill();
    deepStrictEqual(scenario.revealed, 1);
  });

  it('F-2411.AC-8: a dismissed notice reveals nothing', async () => {
    const scenario = setup();
    await scenario.kill();
    deepStrictEqual(scenario.revealed, 0);
  });

  it('F-2411.AC-11: a typed user@host:port is killed on its host, named by the host part only', async () => {
    const scenario = setup({
      picked: {
        kind: 'typed',
        label: '➤ me@box:2222',
        text: 'me@box:2222',
        keepVisible: true,
      },
    });
    await scenario.kill();
    deepStrictEqual(
      [scenario.runs, scenario.notices[0]?.[0]],
      [['kill box'], 'Killed VS Code Server on box.'],
    );
  });

  it('F-2411 AC-11, F-2411 6.3: a typed user@host:port runs on its parsed target', async () => {
    const scenario = setup({
      picked: {
        kind: 'typed',
        label: '➤ lab@x.invalid:2222',
        text: 'lab@x.invalid:2222',
        keepVisible: true,
      },
    });
    await scenario.kill();
    deepStrictEqual(
      [scenario.runs, scenario.targets],
      [['kill x.invalid'], [{host: 'x.invalid', user: 'lab', port: 2222}]],
    );
  });

  it('F-2411 AC-12, F-2411 6.4: Configure SSH Hosts... runs the configuration command and does not kill', async () => {
    const scenario = setup({
      picked: {
        kind: 'configure',
        label: {id: 'S024', values: []},
        keepVisible: true,
      },
    });
    await scenario.kill();
    deepStrictEqual(
      [scenario.commands, scenario.runs],
      [['opensshremotes.openConfigFile'], []],
    );
  });

  it('F-2411 AC-12, F-2411 6.4: Add New SSH Host... runs the add-host command and does not kill', async () => {
    const scenario = setup({
      picked: {
        kind: 'addHost',
        label: {id: 'S167', values: ['$(plus)']},
        keepVisible: true,
      },
    });
    await scenario.kill();
    deepStrictEqual(
      [scenario.commands, scenario.runs],
      [['opensshremotes.addNewSshHost'], []],
    );
  });

  it('F-2201.AC-19: a configuration file that cannot be parsed ends the command with its error', async () => {
    const scenario = setup({
      listing: {
        parseError: {file: '/home/a/.ssh/config', reason: 'bad line 3'},
      },
    });
    await rejects(scenario.kill(), {
      message: '/home/a/.ssh/config: bad line 3',
    });
  });
});

it('F-2411 AC-25: a typed user@A in a window on A kills on the host and leaves the window', async () => {
  const scenario = setup({
    held: DEFAULT_MODE,
    picked: {
      kind: 'typed',
      label: '➤ me@dev',
      text: 'me@dev',
      keepVisible: true,
    },
  });
  await scenario.kill();
  deepStrictEqual(
    [
      scenario.runs,
      scenario.notices,
      scenario.order.includes('switch'),
      scenario.order.includes('end dev'),
    ],
    [
      ['kill dev'],
      [['Killed VS Code Server on dev.', ['Open Logs']]],
      false,
      false,
    ],
  );
});

describe('Uninstall VS Code Server from Host... (F-2412)', () => {
  it('F-2412.AC-4: the picked host is uninstalled and nothing is shown', async () => {
    const scenario = setup();
    await scenario.uninstall();
    deepStrictEqual([scenario.runs, scenario.notices], [['uninstall dev'], []]);
  });

  it('F-2206 AC-33: Escape at the platform pick ends the uninstall with no error, notice or local end', async () => {
    const scenario = setup({
      outcome: {
        result: 'cancelled',
        cause: 'the platform pick was dismissed',
      },
    });
    await scenario.uninstall();
    deepStrictEqual(
      [
        scenario.notices,
        scenario.ended,
        scenario.sink.lines.map(line => line.message),
      ],
      [[], [], []],
    );
  });

  it('F-2412.5.0: a listed host runs on its alias as the text, case kept', async () => {
    const scenario = setup({
      picked: {kind: 'host', label: 'Dev-Box', keepVisible: false},
    });
    await scenario.uninstall();
    deepStrictEqual(
      [scenario.runs, scenario.targets],
      [['uninstall Dev-Box'], [{host: 'Dev-Box'}]],
    );
  });

  it('F-2412 AC-22: a typed user@alias is uninstalled with the typed user', async () => {
    const scenario = setup({
      picked: {
        kind: 'typed',
        label: '➤ me@dev',
        text: 'me@dev',
        keepVisible: true,
      },
    });
    await scenario.uninstall();
    deepStrictEqual(
      [scenario.runs, scenario.targets],
      [['uninstall dev'], [{host: 'dev', user: 'me'}]],
    );
  });

  it('F-2412 6.5: the add-host row runs its command and the uninstall does not continue', async () => {
    const scenario = setup({
      picked: {
        kind: 'addHost',
        label: {id: 'S167', values: ['$(plus)']},
        keepVisible: true,
      },
    });
    await scenario.uninstall();
    deepStrictEqual(
      [scenario.commands, scenario.runs],
      [['opensshremotes.addNewSshHost'], []],
    );
  });

  it('F-2412 6.5: the configure row runs its command and the uninstall does not continue', async () => {
    const scenario = setup({
      picked: {
        kind: 'configure',
        label: {id: 'S024', values: []},
        keepVisible: true,
      },
    });
    await scenario.uninstall();
    deepStrictEqual(
      [scenario.commands, scenario.runs],
      [['opensshremotes.openConfigFile'], []],
    );
  });

  it('F-2412.AC-3: Escape on the pick runs nothing', async () => {
    const scenario = setup({picked: undefined});
    await scenario.uninstall();
    deepStrictEqual(scenario.runs, []);
  });

  it("F-2412.7.E1: an uninstall that could not run ends in the editor's error with the detail", async () => {
    const scenario = setup({outcome: FAILED});
    await rejects(scenario.uninstall(), {message: 'Failed to run command'});
  });

  it('F-2412.7.E1: a failed uninstall shows no notice of ours and is logged at warn', async () => {
    const scenario = setup({outcome: FAILED});
    await scenario.uninstall().catch(() => undefined);
    deepStrictEqual(
      [scenario.notices, scenario.sink.lines.map(line => line.message)],
      [[], ['the uninstall failed: the connection failed: x']],
    );
  });
});

describe('the local connection server after a maintenance run (F-2411 POST-3, F-2412 POST-3)', () => {
  it('F-2411 POST-3: after a kill that ran, the local connection server of the host is ended', async () => {
    const scenario = setup();
    await scenario.kill();
    deepStrictEqual(scenario.ended, ['dev']);
  });

  it('F-2412 POST-3: after an uninstall that ran, the local connection server of the host is ended', async () => {
    const scenario = setup();
    await scenario.uninstall();
    deepStrictEqual(scenario.ended, ['dev']);
  });

  it('F-2411 POST-3: a kill that could not connect ends nothing', async () => {
    const scenario = setup({outcome: FAILED});
    await scenario.kill();
    deepStrictEqual(scenario.ended, []);
  });

  it('F-2412 POST-3: an uninstall that could not connect ends nothing', async () => {
    const scenario = setup({outcome: FAILED});
    await scenario.uninstall().catch(() => undefined);
    deepStrictEqual(scenario.ended, []);
  });

  it('F-2411.AC-11: a typed target ends the server of its own host string', async () => {
    const scenario = setup({
      picked: {
        kind: 'typed',
        label: '➤ me@box:2222',
        text: 'me@box:2222',
        keepVisible: true,
      },
    });
    await scenario.kill();
    deepStrictEqual(scenario.ended.length, 1);
  });
});

const OWN_TARGET: SshTarget = {host: 'dev'};
const DEFAULT_MODE = {target: OWN_TARGET, terminalMode: false};
const TERMINAL_MODE = {target: OWN_TARGET, terminalMode: true};

describe('Kill Current VS Code Server (F-2411 6.1, 6.2, 6.5)', () => {
  it('F-2411.AC-22: with no held connection it does nothing at all', async () => {
    const scenario = setup();
    await scenario.killCurrent();
    deepStrictEqual(
      [scenario.order, scenario.runs, scenario.notices],
      [[], [], []],
    );
  });

  it('F-2411.AC-19: in default mode it ends the local server of the own host, says so, and switches the window to a local one', async () => {
    const scenario = setup({held: DEFAULT_MODE});
    await scenario.killCurrent();
    deepStrictEqual(
      [scenario.order, scenario.runs],
      [['end dev', 'notice Killed VS Code Server on dev.', 'switch'], []],
    );
  });

  it('F-2411.AC-19: the notice of the default mode carries Open Logs and does not hold the switch back', async () => {
    const scenario = setup({held: DEFAULT_MODE, answer: 'Open Logs'});
    await scenario.killCurrent();
    deepStrictEqual(
      [scenario.notices, scenario.revealed],
      [[['Killed VS Code Server on dev.', ['Open Logs']]], 1],
    );
  });

  it('F-2411.AC-19: a notice that stays open does not hold the switch back', async () => {
    const scenario = setup({held: DEFAULT_MODE, noticeOpen: true});
    await scenario.killCurrent();
    deepStrictEqual(scenario.order.at(-1), 'switch');
  });

  it('F-2411.AC-20: in terminal mode it kills over a new connection and says so, and the window stays', async () => {
    const scenario = setup({held: TERMINAL_MODE});
    await scenario.killCurrent();
    deepStrictEqual(
      [scenario.runs, scenario.order],
      [['kill dev'], ['end dev', 'notice Killed VS Code Server on dev.']],
    );
  });

  it('F-2411.AC-20: in terminal mode a connection that fails says the kill failed, and the window stays', async () => {
    const scenario = setup({held: TERMINAL_MODE, outcome: FAILED});
    await scenario.killCurrent();
    deepStrictEqual(scenario.order, [
      'notice Failed to kill VS Code Server on dev.',
    ]);
  });

  it('F-2206 AC-26: Kill Current with Escape at the platform pick ends no local server', async () => {
    const scenario = setup({
      held: TERMINAL_MODE,
      outcome: {
        result: 'cancelled',
        cause: 'the platform pick was dismissed',
      },
    });
    await scenario.killCurrent();
    deepStrictEqual(
      [scenario.ended, scenario.order],
      [[], ['notice Failed to kill VS Code Server on dev.']],
    );
  });

  it('F-2411.AC-21: Kill on Host picking the window’s own alias acts as Kill Current in default mode', async () => {
    const scenario = setup({held: DEFAULT_MODE});
    await scenario.kill();
    deepStrictEqual(
      [scenario.order, scenario.runs],
      [['end dev', 'notice Killed VS Code Server on dev.', 'switch'], []],
    );
  });

  it('F-2411.AC-21: Kill on Host picking another alias leaves the window and kills that host', async () => {
    const scenario = setup({
      held: {target: {host: 'other'}, terminalMode: false},
    });
    await scenario.kill();
    deepStrictEqual(scenario.runs, ['kill dev']);
  });
});

describe('Uninstall on the own host (F-2412 6.1)', () => {
  it('F-2412.6.1: in default mode it ends the local server, shows nothing and switches the window to a local one', async () => {
    const scenario = setup({held: DEFAULT_MODE});
    await scenario.uninstall();
    deepStrictEqual(
      [scenario.order, scenario.runs, scenario.notices],
      [['leave', 'end dev', 'switch'], [], []],
    );
  });

  it('F-2412 AC-17: the own-host uninstall leaves the window before it ends the local server', async () => {
    const scenario = setup({held: DEFAULT_MODE});
    await scenario.uninstall();
    deepStrictEqual(scenario.order.slice(0, 3), ['leave', 'end dev', 'switch']);
  });

  it('F-2412 AC-17: a switch that throws puts the window back and the rejection reaches the caller', async () => {
    const scenario = setup({held: DEFAULT_MODE, switchFails: true});
    const outcome = await scenario.uninstall().then(
      () => 'resolved',
      (caught: unknown) => String(caught),
    );
    deepStrictEqual(
      [scenario.order, outcome],
      [['leave', 'end dev', 'switch', 'stay'], 'Error: no window'],
    );
  });

  it('F-2412.6.1: in terminal mode it uninstalls over a new connection as for another host, and the window stays', async () => {
    const scenario = setup({held: TERMINAL_MODE});
    await scenario.uninstall();
    deepStrictEqual(
      [scenario.runs, scenario.order],
      [['uninstall dev'], ['end dev']],
    );
  });

  it('F-2412 6.1: a typed user@A in a window on A uninstalls on the host', async () => {
    const scenario = setup({
      held: DEFAULT_MODE,
      picked: {
        kind: 'typed',
        label: '➤ me@dev',
        text: 'me@dev',
        keepVisible: true,
      },
    });
    await scenario.uninstall();
    deepStrictEqual(
      [scenario.runs, scenario.order.includes('switch')],
      [['uninstall dev'], false],
    );
  });
});
