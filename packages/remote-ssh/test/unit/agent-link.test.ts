/**
 * @fileoverview The agent link plan of an SSH window (card connect-08): the setting and the forwarded socket
 * decide the plan, a reused connection keeps its stored plan, and a fresh link draws its name or reuses the
 * window's own.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  linkPathFor,
  planAgentLink,
  terminalEnvironment,
} from '../../src/environment/agent-link.ts';

/** The inputs a row sets, over a fresh window with nothing taken and no draw yet. */
function input(
  changes: Partial<Parameters<typeof planAgentLink>[0]>,
): Parameters<typeof planAgentLink>[0] {
  return {
    settingEnabled: true,
    forwardedSocket: '/tmp/ssh-a/agent.1',
    newConnection: true,
    stored: undefined,
    windowLink: undefined,
    takenNames: new Set(),
    draw: () => {
      throw new Error('no draw expected');
    },
    ...changes,
  };
}

describe('planAgentLink (the agent link plan of a window)', () => {
  it('F-2311.BR-2: setting off, socket present, is none with settingOff', () => {
    deepStrictEqual(planAgentLink(input({settingEnabled: false})), {
      kind: 'none',
      reason: 'settingOff',
    });
  });

  it('F-2311.BR-2: setting on, no forwarded socket, is none with noForwardedSocket', () => {
    deepStrictEqual(planAgentLink(input({forwardedSocket: ''})), {
      kind: 'none',
      reason: 'noForwardedSocket',
    });
  });

  it('F-2311.BR-2: setting off and no forwarded socket, the setting wins', () => {
    deepStrictEqual(
      planAgentLink(input({settingEnabled: false, forwardedSocket: ''})),
      {kind: 'none', reason: 'settingOff'},
    );
  });

  it('F-2311.AC-12: the setting is on and the socket empty, the plan is none', () => {
    deepStrictEqual(
      planAgentLink(input({settingEnabled: true, forwardedSocket: ''})),
      {kind: 'none', reason: 'noForwardedSocket'},
    );
  });

  it('F-2311.BR-3: a fresh link draws its name and targets the socket', () => {
    deepStrictEqual(
      planAgentLink(
        input({
          forwardedSocket: '/tmp/ssh-a/agent.1',
          draw: () => 920370833,
        }),
      ),
      {
        kind: 'link',
        linkPath: '/tmp/vscode-ssh-auth-sock-920370833',
        target: '/tmp/ssh-a/agent.1',
      },
    );
  });

  it('F-2311.BR-3: the drawn name is written without zero padding', () => {
    deepStrictEqual(planAgentLink(input({draw: () => 33844213})), {
      kind: 'link',
      linkPath: '/tmp/vscode-ssh-auth-sock-33844213',
      target: '/tmp/ssh-a/agent.1',
    });
  });

  it('F-2311.BR-3: a taken name draws again and the draw is called twice', () => {
    let calls = 0;
    const plan = planAgentLink(
      input({
        takenNames: new Set(['/tmp/vscode-ssh-auth-sock-5']),
        draw: () => {
          calls += 1;
          return calls === 1 ? 5 : 6;
        },
      }),
    );
    deepStrictEqual(plan, {
      kind: 'link',
      linkPath: '/tmp/vscode-ssh-auth-sock-6',
      target: '/tmp/ssh-a/agent.1',
    });
  });

  it('F-2311.BR-3: a window link is kept and the draw is not called', () => {
    const plan = planAgentLink(
      input({
        forwardedSocket: '/run/u/agent.2',
        windowLink: '/tmp/vscode-ssh-auth-sock-77',
        draw: () => {
          throw new Error('no draw expected');
        },
      }),
    );
    deepStrictEqual(plan, {
      kind: 'link',
      linkPath: '/tmp/vscode-ssh-auth-sock-77',
      target: '/run/u/agent.2',
    });
  });

  it('F-2311.BR-4: the link path starts /tmp/vscode-ssh-auth-sock- regardless of TMPDIR', () => {
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = '/some/other/place';
    try {
      const plan = planAgentLink(input({draw: () => 9}));
      strictEqual(
        plan.kind === 'link' ? plan.linkPath : '',
        '/tmp/vscode-ssh-auth-sock-9',
      );
    } finally {
      if (saved === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = saved;
      }
    }
  });

  it('F-2311.BR-6: two windows over one socket, two draws, two different links', () => {
    const first = planAgentLink(input({draw: () => 11}));
    const second = planAgentLink(
      input({
        takenNames: new Set([first.kind === 'link' ? first.linkPath : '']),
        draw: () => 12,
      }),
    );
    deepStrictEqual(
      [first, second],
      [
        {
          kind: 'link',
          linkPath: '/tmp/vscode-ssh-auth-sock-11',
          target: '/tmp/ssh-a/agent.1',
        },
        {
          kind: 'link',
          linkPath: '/tmp/vscode-ssh-auth-sock-12',
          target: '/tmp/ssh-a/agent.1',
        },
      ],
    );
  });

  it('F-2311.BR-1: a reused connection with a stored plan keeps it, setting off', () => {
    const stored = {
      kind: 'link' as const,
      linkPath: '/tmp/vscode-ssh-auth-sock-41',
      target: '/tmp/ssh-a/agent.1',
    };
    deepStrictEqual(
      planAgentLink(
        input({newConnection: false, stored, settingEnabled: false}),
      ),
      stored,
    );
  });

  it('F-2311.BR-1: a reused connection with nothing stored plans fresh', () => {
    deepStrictEqual(
      planAgentLink(
        input({newConnection: false, stored: undefined, draw: () => 13}),
      ),
      {
        kind: 'link',
        linkPath: '/tmp/vscode-ssh-auth-sock-13',
        target: '/tmp/ssh-a/agent.1',
      },
    );
  });

  it('F-2311.BR-10: the terminal environment of a link plan holds the link path only', () => {
    deepStrictEqual(
      terminalEnvironment({
        kind: 'link',
        linkPath: '/tmp/vscode-ssh-auth-sock-41',
        target: '/tmp/ssh-a/agent.1',
      }),
      {SSH_AUTH_SOCK: '/tmp/vscode-ssh-auth-sock-41'},
    );
  });

  it('F-2311.BR-11: the terminal environment of a none plan is empty', () => {
    deepStrictEqual(
      terminalEnvironment({kind: 'none', reason: 'settingOff'}),
      {},
    );
  });
});

let linkDrawCalls = 0;

function linkDraw(): number {
  linkDrawCalls += 1;
  return linkDrawCalls === 1 ? 41 : 42;
}

let boundedDrawCalls = 0;

function boundedDraw(): number {
  boundedDrawCalls += 1;
  return 41;
}

describe('linkPathFor (the link path of one draw)', () => {
  it('linkPathFor names the first draw when it is free', () => {
    strictEqual(
      linkPathFor(() => 41, new Set()),
      '/tmp/vscode-ssh-auth-sock-41',
    );
  });

  it('linkPathFor redraws while the name is taken', () => {
    strictEqual(
      linkPathFor(linkDraw, new Set(['/tmp/vscode-ssh-auth-sock-41'])),
      '/tmp/vscode-ssh-auth-sock-42',
    );
  });

  it('a draw that always returns a taken number is called 17 times', () => {
    const path = linkPathFor(
      boundedDraw,
      new Set(['/tmp/vscode-ssh-auth-sock-41']),
    );
    deepStrictEqual(
      {calls: boundedDrawCalls, path},
      {calls: 17, path: '/tmp/vscode-ssh-auth-sock-41'},
    );
  });
});
