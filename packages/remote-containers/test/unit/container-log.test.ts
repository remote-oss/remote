import {deepStrictEqual} from 'node:assert';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  containerLogOf,
  type LogTerminalOptions,
} from '../../src/explorer/container-log.ts';
import type {TargetRow} from '../../src/explorer/targets-model.ts';

const CONTAINER: TargetRow = {
  id: 'target',
  label: 'proj',
  description: 'name',
  tooltip: '',
  icon: 'vm',
  viewItem: 'container dev running stop remove details inspect log',
  children: [],
};

function finished(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}

/** Show Container Log over a Docker that answers `answer`, and what it did, in order. */
function sceneOf(answer: EngineRunOutcome, engine = true) {
  const events: string[] = [];
  const terminals: LogTerminalOptions[] = [];
  const host: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      events.push(argv.join(' '));
      return Promise.resolve(answer);
    },
    spawn: () => Promise.resolve({kind: 'failed', detail: 'no spawn'}),
  };
  const showLog = containerLogOf({
    engine: () => (engine ? host : undefined),
    engineFile: () => '/usr/bin/docker',
    createTerminal: options => {
      terminals.push(options);
      events.push('created');
      return {
        show: () => {
          events.push('shown');
        },
      };
    },
    cancellation: new AbortController().signal,
  });
  return {events, terminals, showLog};
}

describe('Show Container Log of the Dev Containers view (card containers-104)', () => {
  it('F-0902 AC-12: a terminal titled with the container’s image reference follows the log, with the engine file and the id as words of the script, and is shown', async () => {
    const {events, terminals, showLog} = sceneOf(finished(0, 'alpine:3.20\n'));
    await showLog(CONTAINER);
    deepStrictEqual(
      [events, terminals],
      [
        ['inspect --format {{.Config.Image}} target', 'created', 'shown'],
        [
          {
            name: 'alpine:3.20',
            shellPath: '/bin/sh',
            shellArgs: [
              '-c',
              '"$0" logs --follow "$1"; exec tail -f /dev/null',
              '/usr/bin/docker',
              'target',
            ],
          },
        ],
      ],
    );
  });

  it('F-0902 AC-12: every call opens a terminal again', async () => {
    const {terminals, showLog} = sceneOf(finished(0, 'alpine\n'));
    await showLog(CONTAINER);
    await showLog(CONTAINER);
    deepStrictEqual(terminals.length, 2);
  });

  it('F-0902 6.7: a container whose image can not be read gives the terminal the row’s label, and a missing engine too', async () => {
    const names: string[] = [];
    for (const [answer, engine] of [
      [finished(1), true],
      [finished(0, '\n'), true],
      [finished(0, 'alpine'), false],
    ] as const) {
      const {terminals, showLog} = sceneOf(answer, engine);
      await showLog(CONTAINER);
      names.push(...terminals.map(each => each.name));
    }
    deepStrictEqual(names, ['proj', 'proj', 'proj']);
  });

  it('F-0902 AC-56: anything else than a container row does nothing at all', async () => {
    const {events, showLog} = sceneOf(finished(0, 'alpine'));
    for (const argument of [
      undefined,
      'target',
      {...CONTAINER, viewItem: 'image'},
      {id: 'g', label: 'Group', rows: []},
    ]) {
      await showLog(argument);
    }
    deepStrictEqual(events, []);
  });
});
