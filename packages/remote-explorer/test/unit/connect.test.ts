import {deepStrictEqual} from 'node:assert';
import {
  type CallOutcome,
  type DeleteResult,
  writeEnvelope,
} from 'lib-companion';
import {buildSshRows} from '../../src/model/ssh-group.ts';
import type {
  CompanionCalls,
  FolderToOpen,
  WindowTarget,
} from '../../src/view/companion-calls.ts';
import {type ConnectHandlers, connectHandlers} from '../../src/view/connect.ts';
import type {
  FolderNode,
  HostNode,
  ViewSession,
} from '../../src/view/targets.ts';

const [HOST_ROW] = buildSshRows(['F5103-Upper'], new Map(), undefined);
if (HOST_ROW === undefined) {
  throw new Error('no host row');
}
const HOST: HostNode = {
  kind: 'sshHost',
  hostRow: HOST_ROW,
  connected: false,
  folders: [],
};

/** The folder nodes of a host `devbox` with these recorded paths. */
function folderNodesOf(...paths: string[]): FolderNode[] {
  const [hostRow] = buildSshRows(
    ['devbox'],
    new Map([['devbox', paths]]),
    undefined,
  );
  return (hostRow?.folders ?? []).map(folderRow => ({
    kind: 'sshFolder',
    folderRow,
  }));
}

const [WORKSPACE, FOLDER, BARE] = folderNodesOf(
  '/w/team.code-workspace',
  '/w/proj',
  '/w/.code-workspace',
);

const ANSWERED: CallOutcome<ReturnType<typeof writeEnvelope>> = {
  status: 'answered',
  value: writeEnvelope(),
};

/** A session whose targets know `HOST` alone, whose `open` records its calls, and whose other calls must not happen. */
/** A call the connect commands never make. */
function forbidden(): never {
  throw new Error('a call the connect commands never make');
}

function sessionOf(
  outcome: Awaited<ReturnType<CompanionCalls['open']>>,
  deleted: CallOutcome<DeleteResult> = {
    status: 'unavailable',
    cause: 'timeout',
  },
) {
  const opened: Array<
    [string, WindowTarget] | [string, WindowTarget, FolderToOpen]
  > = [];
  const requests: Array<[string, string]> = [];
  const dropped: Array<[string, string]> = [];
  const folders = [WORKSPACE, FOLDER, BARE];
  const session = {
    targets: {
      hostOf: (value: unknown) => (value === HOST ? HOST : undefined),
      folderOf: (value: unknown) => folders.find(folder => folder === value),
      dropFolder: (hostKey: string, path: string) => {
        dropped.push([hostKey, path]);
      },
      rebuild: forbidden,
      rebuildHosts: forbidden,
    },
    calls: {
      activeRemote: forbidden,
      hostnames: forbidden,
      history: forbidden,
      deleteFolder: (hostKey: string, path: string) => {
        requests.push([hostKey, path]);
        return Promise.resolve(deleted);
      },
      open: (hostKey: string, target: WindowTarget, folder?: FolderToOpen) => {
        opened.push(
          folder === undefined ? [hostKey, target] : [hostKey, target, folder],
        );
        return Promise.resolve(outcome);
      },
    },
  } as unknown as ViewSession;
  return {session, opened, requests, dropped};
}

/** What a command resolves to for an argument, with the opens the companion saw, when it answers. */
async function outcomeAndOpened(
  name: keyof ConnectHandlers,
  argument: unknown,
): Promise<[unknown, unknown[]]> {
  const {session, opened} = sessionOf(ANSWERED);
  const outcome = await connectHandlers(() => session)[name].execute(argument);
  return [outcome, opened];
}

const COMMANDS = [
  ['connectToRemoteInCurrentWindow', 'current'],
  ['connectToRemoteInNewWindow', 'new'],
] as const;

describe('the connect commands of a host row (card explorer-05)', () => {
  for (const [name, target] of COMMANDS) {
    it(`F-5103.AC-23: F-5103.BR-${String(COMMANDS.findIndex(entry => entry[1] === target) + 1)}: ${name} opens the host's alias as written in the ${target} window`, async () => {
      const {session, opened} = sessionOf(ANSWERED);
      const outcome = await connectHandlers(() => session)[name].execute(HOST);
      deepStrictEqual(
        [outcome, opened],
        [undefined, [['F5103-Upper', target]]],
      );
    });

    for (const cause of [
      'rejected',
      'timeout',
      'foreignPayload',
      'unknownMajor',
      'notRegistered',
    ] as const) {
      it(`F-5902.AC-21: ${name} resolves undefined when the open is unavailable for ${cause}`, async () => {
        const {session} = sessionOf({status: 'unavailable', cause});
        deepStrictEqual(
          await connectHandlers(() => session)[name].execute(HOST),
          undefined,
        );
      });
    }

    for (const [label, argument] of [
      ['no argument', undefined],
      ['a string', 'bogus-f5002'],
      ['an empty object', {}],
      ['a value the targets do not know', {kind: 'sshHost'}],
    ] as const) {
      it(`F-5103.AC-19, AC-20: F-5002.19.7: ${name} with ${label} resolves undefined and opens nothing`, async () => {
        deepStrictEqual(await outcomeAndOpened(name, argument), [
          undefined,
          [],
        ]);
      });
    }

    it(`F-5002.AC-18, F-5103.AC-19: F-5002.19.1: ${name} without a session resolves undefined`, async () => {
      deepStrictEqual(
        await connectHandlers(() => undefined)[name].execute(HOST),
        undefined,
      );
    });
  }

  it('F-5002.19.3: the handlers are the five commands, each with execute and no availability check', () => {
    const handlers = connectHandlers(() => undefined);
    deepStrictEqual(
      [
        Object.keys(handlers),
        (Object.keys(handlers) as Array<keyof ConnectHandlers>).map(key =>
          Object.keys(handlers[key]),
        ),
      ],
      [
        [
          'connectToRemoteInCurrentWindow',
          'connectToRemoteInNewWindow',
          'connectToFolderInCurrentWindow',
          'connectToFolderInNewWindow',
          'deleteFolderHistoryItem',
        ],
        [['execute'], ['execute'], ['execute'], ['execute'], ['execute']],
      ],
    );
  });

  for (const [name, target] of [
    ['connectToFolderInCurrentWindow', 'current'],
    ['connectToFolderInNewWindow', 'new'],
  ] as const) {
    it(`F-5104.BR-15: ${name} opens a folder row with its path and the kind the path rule gives, in the ${target} window`, async () => {
      const {session, opened} = sessionOf(ANSWERED);
      const handler = connectHandlers(() => session)[name];
      const outcomes = [
        await handler.execute(FOLDER),
        await handler.execute(WORKSPACE),
        await handler.execute(BARE),
      ];
      deepStrictEqual(
        [outcomes, opened],
        [
          [undefined, undefined, undefined],
          [
            ['devbox', target, {path: '/w/proj', kind: 'folder'}],
            [
              'devbox',
              target,
              {path: '/w/team.code-workspace', kind: 'workspace'},
            ],
            ['devbox', target, {path: '/w/.code-workspace', kind: 'folder'}],
          ],
        ],
      );
    });

    for (const [label, argument] of [
      ['no argument', undefined],
      ['a string', 'bogus-f5104'],
      ['an empty object', {}],
      ['a host node', HOST],
      ['a copy of a folder node', {...FOLDER}],
    ] as const) {
      it(`F-5104.7.E6: ${name} with ${label} resolves undefined and opens nothing`, async () => {
        deepStrictEqual(await outcomeAndOpened(name, argument), [
          undefined,
          [],
        ]);
      });
    }

    it(`F-5104.7.E6: ${name} without a session resolves undefined`, async () => {
      deepStrictEqual(
        await connectHandlers(() => undefined)[name].execute(FOLDER),
        undefined,
      );
    });
  }

  for (const changed of [true, false]) {
    it(`F-5104.BR-13: an answer with changed ${String(changed)} drops the path from the view at once, and the command shows nothing`, async () => {
      const {session, requests, dropped} = sessionOf(ANSWERED, {
        status: 'answered',
        value: {interfaceVersion: {major: 1, minor: 0}, changed},
      });
      const outcome = await connectHandlers(
        () => session,
      ).deleteFolderHistoryItem.execute(FOLDER);
      deepStrictEqual(
        [outcome, requests, dropped],
        [undefined, [['devbox', '/w/proj']], [['devbox', '/w/proj']]],
      );
    });
  }

  for (const cause of [
    'rejected',
    'timeout',
    'foreignPayload',
    'unknownMajor',
    'notRegistered',
  ] as const) {
    it(`F-5104.7.E7: a removal that is unavailable for ${cause} keeps the rows`, async () => {
      const {session, requests, dropped} = sessionOf(ANSWERED, {
        status: 'unavailable',
        cause,
      });
      await connectHandlers(() => session).deleteFolderHistoryItem.execute(
        FOLDER,
      );
      deepStrictEqual([requests.length, dropped], [1, []]);
    });
  }

  for (const [label, argument] of [
    ['no argument', undefined],
    ['a string', 'bogus-f5104'],
    ['a host node', HOST],
    ['a copy of a folder node', {...FOLDER}],
  ] as const) {
    it(`F-5104.7.E6: removing with ${label} asks for nothing and drops nothing`, async () => {
      const {session, requests, dropped} = sessionOf(ANSWERED);
      const outcome = await connectHandlers(
        () => session,
      ).deleteFolderHistoryItem.execute(argument);
      deepStrictEqual([outcome, requests, dropped], [undefined, [], []]);
    });
  }

  it('F-5104.7.E6: removing without a session resolves undefined', async () => {
    deepStrictEqual(
      await connectHandlers(() => undefined).deleteFolderHistoryItem.execute(
        FOLDER,
      ),
      undefined,
    );
  });
});
