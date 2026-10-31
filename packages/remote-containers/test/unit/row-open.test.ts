import {deepStrictEqual} from 'node:assert';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {rowOpenOf, type RowOpen} from '../../src/explorer/row-open.ts';
import type {TargetRow} from '../../src/explorer/targets-model.ts';
import {settled} from './pending.ts';
import {
  CONFIG,
  FOLDER,
  linesOf,
  portsOf,
  setup,
  type Setup,
} from './reopen.fixture.ts';

/** A dev container row that offers the open commands. */
const OPEN_ROW: TargetRow = {
  id: 'target',
  label: 'p',
  description: 'name',
  tooltip: '',
  icon: 'vm',
  viewItem: 'container dev exited configuration openFolder start remove',
  children: [],
};

/** What `docker inspect` prints for a container with these labels. */
function inspected(labels: Record<string, string>): EngineRunOutcome {
  return {
    kind: 'ran',
    status: 0,
    stdout: JSON.stringify([
      {
        ['Id']: 'target',
        Name: '/name',
        Config: {Image: 'alpine', Labels: labels},
        State: {Status: 'exited'},
        Created: '2026-10-31T00:00:00Z',
      },
    ]),
    stderr: '',
  };
}

/** The labels a dev container of the folder carries. */
const LABELS = {
  'devcontainer.local_folder': FOLDER,
  'devcontainer.config_file': CONFIG,
};

/** The commands over a setup, with an engine that answers the inspect with `answer`. */
function commandsOf(
  state: Setup,
  answer: EngineRunOutcome,
  present: readonly string[] = [CONFIG],
): {commands: RowOpen; asked: string[][]; programs: string[]} {
  const {ports} = portsOf(state);
  const asked: string[][] = [];
  const programs: string[] = [];
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      asked.push([...argv]);
      return Promise.resolve(answer);
    },
    spawn: () => Promise.resolve({kind: 'failed', detail: 'no spawn'}),
  };
  const commands = rowOpenOf({
    ...ports,
    engineFor: file => {
      programs.push(file);
      return engine;
    },
    exists: file => Promise.resolve(present.includes(file)),
    cancellation: new AbortController().signal,
  });
  return {commands, asked, programs};
}

/** The window options and the configuration file of the open the setup recorded. */
function openedOf(state: Setup): unknown[] {
  return state.commands.map(each => each.parameters[1]);
}

describe('the open commands of the Dev Containers rows (card containers-103)', () => {
  it('F-0902 AC-56: a call with no row, with a value that is no container row, or with a row that offers no open does nothing', async () => {
    const state = setup();
    const {commands, asked} = commandsOf(state, inspected(LABELS));
    for (const argument of [
      undefined,
      'target',
      {},
      {...OPEN_ROW, viewItem: 'container dev running own'},
    ]) {
      await commands.current(argument);
      await commands.inNewWindow(argument);
    }
    deepStrictEqual([state.calls, state.commands, asked], [[], [], []]);
  });

  it('F-0902 AC-17: Current Window reloads this window on the row’s configuration, tells the shutdown helper, and shows no picker', async () => {
    const state = setup();
    state.existing = [CONFIG, '/w/p/.devcontainer/other/devcontainer.json'];
    const {commands, asked, programs} = commandsOf(state, inspected(LABELS));
    await commands.current(OPEN_ROW);
    await settled();
    deepStrictEqual(
      [asked, programs, state.calls, state.left, openedOf(state), state.shown],
      [
        [['inspect', '--type', 'container', 'target']],
        ['docker'],
        ['firstCheck undefined', 'readConfiguration /w/p', 'currentContext'],
        1,
        [{forceNewWindow: false, forceReuseWindow: true}],
        [],
      ],
    );
  });

  it('F-0902 AC-6: New Window opens another window and leaves the issuing window as it is: the shutdown helper is not told', async () => {
    const state = setup();
    const {commands} = commandsOf(state, inspected(LABELS));
    await commands.inNewWindow(OPEN_ROW);
    await settled();
    deepStrictEqual(
      [state.left, openedOf(state), state.order],
      [0, [{forceNewWindow: true, forceReuseWindow: false}], ['open']],
    );
  });

  it('F-0902 BR-7: the row’s configuration file is the one read, even when the folder holds several', async () => {
    const state = setup();
    const named = '/w/p/.devcontainer/other/devcontainer.json';
    state.existing = [CONFIG, named];
    const {commands} = commandsOf(
      state,
      inspected({...LABELS, 'devcontainer.config_file': named}),
      [named],
    );
    await commands.inNewWindow(OPEN_ROW);
    await settled();
    deepStrictEqual(
      state.targets.map(each => (each as {configFile: string}).configFile),
      [named],
    );
  });

  it('F-0902 BR-7: a container with no configuration label goes on with the folder’s default file, the one in .devcontainer first', async () => {
    const calls = [];
    for (const present of [
      [CONFIG, '/w/p/.devcontainer.json'],
      ['/w/p/.devcontainer.json'],
    ]) {
      const state = setup();
      state.existing = present;
      const {commands} = commandsOf(
        state,
        inspected({'devcontainer.local_folder': FOLDER}),
        present,
      );
      await commands.inNewWindow(OPEN_ROW);
      await settled();
      calls.push(
        state.targets.map(each => (each as {configFile: string}).configFile),
      );
    }
    deepStrictEqual(calls, [[CONFIG], ['/w/p/.devcontainer.json']]);
  });

  it('F-0902 BR-7: a container with no folder label, or no configuration file at all, reloads nothing and says so', async () => {
    const lines = [];
    for (const labels of [{}, {'devcontainer.local_folder': FOLDER}]) {
      const state = setup();
      const {ports, sink} = portsOf(state);
      const commands = rowOpenOf({
        ...ports,
        engineFor: () => ({
          // eslint-disable-next-line id-length -- the port's method is named run
          run: () => Promise.resolve(inspected(labels)),
          spawn: () => Promise.resolve({kind: 'failed', detail: 'none'}),
        }),
        exists: () => Promise.resolve(false),
        cancellation: new AbortController().signal,
      });
      await commands.current(OPEN_ROW);
      lines.push([state.commands, linesOf(sink)]);
    }
    deepStrictEqual(lines, [
      [
        [],
        [
          'info: Open in Container in Current Window found no folder and configuration in the row',
        ],
      ],
      [
        [],
        [
          'info: Open in Container in Current Window found no folder and configuration in the row',
        ],
      ],
    ]);
  });

  it('F-0902 BR-7: an engine that cannot inspect the container, or answers with something else, reloads nothing', async () => {
    const opened = [];
    for (const answer of [
      {kind: 'failed', detail: 'gone'},
      {kind: 'ran', status: 1, stdout: '', stderr: 'No such object'},
      {kind: 'ran', status: 0, stdout: 'not a list', stderr: ''},
    ] as const) {
      const state = setup();
      await commandsOf(state, answer).commands.inNewWindow(OPEN_ROW);
      opened.push(state.commands);
    }
    deepStrictEqual(opened, [[], [], []]);
  });

  it('F-0902 AC-6: a stopped engine check, or a gate that keeps the proposals missing, reloads nothing and inspects nothing', async () => {
    const results = [];
    const stopped = setup();
    stopped.check = 'stopped';
    const first = commandsOf(stopped, inspected(LABELS));
    await first.commands.inNewWindow(OPEN_ROW);
    results.push([stopped.commands, first.asked]);
    const gated = setup();
    gated.missing = ['resolvers'];
    gated.missingAfter = ['resolvers'];
    const second = commandsOf(gated, inspected(LABELS));
    await second.commands.inNewWindow(OPEN_ROW);
    results.push([gated.commands, second.asked, gated.calls]);
    deepStrictEqual(results, [
      [[], []],
      [[], [], ['setupAgain']],
    ]);
  });

  it('F-0902 AC-6: a configuration the CLI cannot read reloads nothing', async () => {
    const state = setup();
    state.read = {kind: 'configurationFailed', message: 'boom'};
    const {commands} = commandsOf(state, inspected(LABELS));
    await commands.inNewWindow(OPEN_ROW);
    await settled();
    deepStrictEqual(state.commands, []);
  });
  it('F-0201 AC-55: a relative dockerPath names no program for a row, whatever the check said, and reloads nothing', async () => {
    const state = setup();
    state.dockerPath = './docker';
    const {commands, asked} = commandsOf(state, inspected(LABELS));
    await commands.inNewWindow(OPEN_ROW);
    deepStrictEqual([state.commands, asked], [[], []]);
  });
});
