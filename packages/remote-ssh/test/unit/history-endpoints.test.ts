import {deepStrictEqual} from 'node:assert';
import {
  createProtocol,
  SSH_ENDPOINTS,
  type Timers,
  type VersionMismatch,
  writeDeleteRequest,
  writeDeleteResult,
  writeEnvelope,
  writeFoldersHistory,
} from 'lib-companion';
import {createRecordingFake} from 'lib-companion/testing/recording-fake';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {MemoryFiles} from './event-files.fixture.ts';
import {legacyOf, windowOn} from './history-files.fixture.ts';
import {serveHistoryEndpoints} from '../../src/companion/history-endpoints.ts';
import {mismatchLine} from '../../src/companion/slice-endpoints.ts';

const GET_HISTORY = SSH_ENDPOINTS.getSshFoldersHistory.commandId;
const DELETE = SSH_ENDPOINTS.deleteSshFolderFromHistory.commandId;
const ENVELOPE = writeEnvelope();
const NO_TIMERS: Timers = {
  setTimer: () => undefined,
  clearTimer: () => undefined,
};
const STORED = {
  hosts: [
    {hostKey: 'zeta', entries: [{path: '/z', kind: 'folder'}]},
    {
      hostKey: 'alpha',
      entries: [
        {path: '/w.code-workspace', kind: 'workspace'},
        {path: '/a', kind: 'folder'},
      ],
    },
  ],
} as const;

/** A scene: the served endpoints over a fake bus, a store whose earlier global state holds `STORED`, and the log. */
function sceneOf() {
  const fake = createRecordingFake();
  const sink = new MemorySink();
  const mismatches: string[] = [];
  const store = windowOn(
    new MemoryFiles(),
    'aaaa',
    legacyOf(JSON.parse(JSON.stringify(STORED)) as unknown),
  );
  const protocol = createProtocol({
    // eslint-disable-next-line id-length -- the protocol's option is named bus
    bus: fake,
    timers: NO_TIMERS,
    onVersionMismatch: (mismatch: VersionMismatch) => {
      mismatches.push(mismatchLine(mismatch));
    },
  });
  const registration = serveHistoryEndpoints(protocol, store);
  return {
    fake,
    sink,
    mismatches,
    store,
    registration,
    call: (commandId: string, ...given: unknown[]): unknown =>
      fake.registered(commandId)?.(...given),
    logger: createLogger(sink, {minimumLevel: () => 'trace'}),
  };
}

describe('the history endpoints served to Remote Explorer (card ssh-provider-02)', () => {
  it('F-3906 rule 3, AC-3: the history is answered in the stored order, versioned', () => {
    const scene = sceneOf();
    const answer = scene.call(GET_HISTORY, ENVELOPE) as {
      hosts: Array<{hostKey: string}>;
    };
    deepStrictEqual(
      [answer, answer.hosts.map(host => host.hostKey)],
      [writeFoldersHistory({hosts: scene.store.stored()}), ['zeta', 'alpha']],
    );
  });

  it('F-3906 rule 5, AC-9: deleting a stored path says changed, leaves the store without it, and writes no log line', async () => {
    const scene = sceneOf();
    const result = await scene.call(
      DELETE,
      writeDeleteRequest({hostKey: 'alpha', path: '/a'}),
    );
    deepStrictEqual(
      [result, scene.store.stored()[1]?.entries, scene.sink.lines],
      [
        writeDeleteResult({changed: true}),
        [{path: '/w.code-workspace', kind: 'workspace'}],
        [],
      ],
    );
  });

  it('F-3906 rule 5: deleting a path that is not stored says not changed', async () => {
    const scene = sceneOf();
    deepStrictEqual(
      await scene.call(
        DELETE,
        writeDeleteRequest({hostKey: 'alpha', path: '/missing'}),
      ),
      writeDeleteResult({changed: false}),
    );
  });

  it('F-3906 rule 11, AC-20: no argument, a foreign one and an unknown major are not acted on, and the mismatch line comes once for the major', async () => {
    const scene = sceneOf();
    const before = JSON.stringify(scene.store.stored());
    const answers = [
      scene.call(GET_HISTORY),
      scene.call(GET_HISTORY, 'foreign'),
      await scene.call(DELETE),
      await scene.call(DELETE, {hostKey: 'alpha', path: '/a'}),
      await scene.call(DELETE, {
        interfaceVersion: {major: 2, minor: 0},
        hostKey: 'alpha',
        path: '/a',
      }),
    ];
    deepStrictEqual(
      [
        answers[0],
        answers[1],
        answers.slice(2).map(answer => answer === undefined),
        JSON.stringify(scene.store.stored()),
        scene.mismatches.length,
      ],
      [
        writeFoldersHistory({hosts: []}),
        writeFoldersHistory({hosts: []}),
        [true, true, true],
        before,
        1,
      ],
    );
  });

  it('F-3906 rule 1: disposing ends both commands, twice over', () => {
    const scene = sceneOf();
    const before = [GET_HISTORY, DELETE].map(
      commandId => typeof scene.fake.registered(commandId),
    );
    scene.registration.dispose();
    scene.registration.dispose();
    deepStrictEqual(
      [
        before,
        [GET_HISTORY, DELETE].map(commandId =>
          scene.fake.registered(commandId),
        ),
      ],
      [
        ['function', 'function'],
        [undefined, undefined],
      ],
    );
  });
});
