import {deepStrictEqual} from 'node:assert';
import {type CallOutcome, writeEnvelope} from 'lib-companion';
import {buildSshRows} from '../../src/model/ssh-group.ts';
import type {
  CompanionCalls,
  WindowTarget,
} from '../../src/view/companion-calls.ts';
import {connectHandlers} from '../../src/view/connect.ts';
import type {HostNode, ViewSession} from '../../src/view/targets.ts';

const [HOST_ROW] = buildSshRows(['F5103-Upper'], new Map(), undefined);
if (HOST_ROW === undefined) {
  throw new Error('no host row');
}
const HOST: HostNode = {kind: 'sshHost', hostRow: HOST_ROW, connected: false};

const ANSWERED: CallOutcome<ReturnType<typeof writeEnvelope>> = {
  status: 'answered',
  value: writeEnvelope(),
};

/** A session whose targets know `HOST` alone, whose `open` records its calls, and whose other calls must not happen. */
/** A call the connect commands never make. */
function forbidden(): never {
  throw new Error('a call the connect commands never make');
}

function sessionOf(outcome: Awaited<ReturnType<CompanionCalls['open']>>) {
  const opened: Array<[string, WindowTarget]> = [];
  const session = {
    targets: {
      hostOf: (value: unknown) => (value === HOST ? HOST : undefined),
      rebuild: forbidden,
      rebuildHosts: forbidden,
    },
    calls: {
      activeRemote: forbidden,
      hostnames: forbidden,
      open: (hostKey: string, target: WindowTarget) => {
        opened.push([hostKey, target]);
        return Promise.resolve(outcome);
      },
    },
  } as unknown as ViewSession;
  return {session, opened};
}

const COMMANDS = [
  ['connectToRemoteInCurrentWindow', 'current'],
  ['connectToRemoteInNewWindow', 'new'],
] as const;

describe('the connect commands of a host row (card explorer-05)', () => {
  for (const [name, target] of COMMANDS) {
    it(`F-5103.BR-${String(COMMANDS.findIndex(entry => entry[1] === target) + 1)}: ${name} opens the host's alias as written in the ${target} window`, async () => {
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
      it(`F-5002.19.7: ${name} with ${label} resolves undefined and opens nothing`, async () => {
        const {session, opened} = sessionOf(ANSWERED);
        const outcome = await connectHandlers(() => session)[name].execute(
          argument,
        );
        deepStrictEqual([outcome, opened], [undefined, []]);
      });
    }

    it(`F-5002.19.1: ${name} without a session resolves undefined`, async () => {
      deepStrictEqual(
        await connectHandlers(() => undefined)[name].execute(HOST),
        undefined,
      );
    });
  }

  it('F-5002.19.3: the handlers are the two commands, each with execute and no availability check', () => {
    const handlers = connectHandlers(() => undefined);
    deepStrictEqual(
      [
        Object.keys(handlers),
        [
          handlers.connectToRemoteInCurrentWindow,
          handlers.connectToRemoteInNewWindow,
        ].map(handler => Object.keys(handler)),
      ],
      [
        ['connectToRemoteInCurrentWindow', 'connectToRemoteInNewWindow'],
        [['execute'], ['execute']],
      ],
    );
  });
});
