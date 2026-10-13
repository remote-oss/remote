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
  runs: string[];
  notices: Array<[string, readonly string[]]>;
  commands: string[];
  revealed: number;
  sink: MemorySink;
  kill(): Promise<void>;
  uninstall(): Promise<void>;
}

function setup(
  options: {
    picked?: PickerItem | undefined;
    listing?: HostListResult;
    outcome?: MaintenanceRun;
    answer?: string;
  } = {},
): Setup {
  const seen: Setup = {
    runs: [],
    notices: [],
    commands: [],
    revealed: 0,
    sink: new MemorySink(),
    kill: () => Promise.resolve(),
    uninstall: () => Promise.resolve(),
  };
  const editor: MaintenanceEditor = {
    listHosts: () => options.listing ?? {hosts: [{name: 'dev', file: '/f'}]},
    pickHost: () =>
      Promise.resolve('picked' in options ? options.picked : DEV_ROW),
    runCommand: commandId => {
      seen.commands.push(commandId);
      return Promise.resolve();
    },
  };
  const handlers = maintenanceHandlers({
    editor,
    perform: (action, target: SshTarget) => {
      seen.runs.push(`${action} ${target.host}`);
      return Promise.resolve(options.outcome ?? RAN_OK);
    },
    notice: {
      showInformation: (message, buttons) => {
        seen.notices.push([message, buttons]);
        return Promise.resolve(options.answer);
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

  it('F-2411.AC-12: Configure SSH Hosts... runs the configuration command and does not kill', async () => {
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

  it('F-2411.AC-12: Add New SSH Host... runs the add-host command and does not kill', async () => {
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

describe('Uninstall VS Code Server from Host... (F-2412)', () => {
  it('F-2412.AC-5: the picked host is uninstalled and nothing is shown', async () => {
    const scenario = setup();
    await scenario.uninstall();
    deepStrictEqual([scenario.runs, scenario.notices], [['uninstall dev'], []]);
  });

  it('F-2412.AC-4: Escape on the pick runs nothing', async () => {
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
