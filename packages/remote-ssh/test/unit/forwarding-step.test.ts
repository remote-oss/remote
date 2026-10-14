import {deepStrictEqual} from 'node:assert';
import {withNoise} from 'lib-host/testing/noise';
import type {ChannelFailure} from 'lib-host';
import {
  RecordingChannel,
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ProbedHost} from 'lib-server';
import type {SharedRecord} from 'lib-ssh';
import type {ForwardingPlans} from '../../src/environment/forwarding.ts';
import {forwardingEnvironment} from '../../src/environment/forwarding.ts';
import {
  type ForwardingDependencies,
  LINK_TERMINAL_NAME,
  linkAgent,
  planForwarding,
} from '../../src/pipeline/forwarding-step.ts';
import {leaseOn} from './server-steps.fixture.ts';

const AGENT_SOCKET = '/tmp/ssh-x/agent.1';

/** A probed Linux host whose session reports `sshAuthSock` and `display`. */
function hostWith(sshAuthSock: string, display: string): ProbedHost {
  return {
    operatingSystem: 'linux',
    architecture: 'x64',
    libc: 'musl',
    release: 'alpine',
    home: '/home/harness',
    temporaryFolder: '/tmp',
    loginShell: 'sh',
    tools: ['wget', 'tar'],
    busyboxWget: true,
    sshAuthSock,
    display,
    installed: true,
    installFolder: '/home/harness/.server/bin/abc',
    treeComplete: false,
  };
}

/** The answer to the listing of the links in /tmp. */
function listingAnswer(
  names: readonly string[],
  failure?: ChannelFailure,
): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: script => script.includes('for name in'),
    lines: names,
    ending:
      failure === undefined
        ? {kind: 'exit', status: 0}
        : {kind: 'fail', failure},
  };
}

/** A terminal the fake editor ran: its name and its command, the program first. */
interface FakeTerminal {
  name: string;
  command: string[];
}

/** The forwarding over fakes, with the draws, the terminals opened and the log they write. */
function forwardingOf(
  changes: {
    agentForwarding?: boolean;
    x11Forwarding?: boolean;
    draws?: number[];
    windowLink?: string;
    /** How the link terminal ends: closed, or a rejection. */
    linkEnd?: Promise<void>;
  } = {},
): {
  dependencies: ForwardingDependencies;
  terminals: FakeTerminal[];
  sink: MemorySink;
} {
  const sink = new MemorySink();
  const terminals: FakeTerminal[] = [];
  const draws = [...(changes.draws ?? [42])];
  return {
    dependencies: {
      agentForwarding: () => changes.agentForwarding ?? true,
      x11Forwarding: () => changes.x11Forwarding ?? true,
      draw: () => draws.shift() ?? 99,
      windowLink: {path: changes.windowLink},
      linkTerminals: {
        runProgram: (name, program, programArguments) => {
          terminals.push({name, command: [program, ...programArguments]});
          return changes.linkEnd ?? Promise.resolve();
        },
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    terminals,
    sink,
  };
}

/** A channel answering the listing with `names`. */
function channelWith(names: readonly string[]): RecordingChannel {
  return new RecordingChannel({
    identity: 'harness',
    platformHint: 'linux',
    scripts: [listingAnswer(names)],
  });
}

/** The plans of one connect over `channel` whose lease holds `storedRecord`. */
async function plansOf(
  dependencies: ForwardingDependencies,
  channel: RecordingChannel,
  host: ProbedHost,
  storedRecord?: SharedRecord,
): Promise<ForwardingPlans> {
  return planForwarding(
    dependencies,
    {...leaseOn(channel), storedRecord},
    host,
    new AbortController().signal,
  );
}

/** The warn lines of the log. */
function warnings(sink: MemorySink): string[] {
  return sink.lines
    .filter(line => line.level === 'warn')
    .map(line => line.message);
}

const RECORD: SharedRecord = {
  remotePort: 41000,
  operatingSystem: 'linux',
  architecture: 'x64',
  temporaryFolder: '/tmp',
  connectionToken: 'token',
};

describe('the forwarding plans of a connect', () => {
  it('F-2311.AC-2: a forwarded agent with the setting unset gives SSH_AUTH_SOCK the drawn link', async () => {
    const {dependencies} = forwardingOf();
    const plans = await plansOf(
      dependencies,
      channelWith([]),
      hostWith(AGENT_SOCKET, ''),
    );
    deepStrictEqual(forwardingEnvironment(plans), {
      SSH_AUTH_SOCK: '/tmp/vscode-ssh-auth-sock-42',
    });
  });

  it('F-2311.AC-10: the setting false gives no SSH_AUTH_SOCK and lists nothing', async () => {
    const {dependencies} = forwardingOf({agentForwarding: false});
    const channel = channelWith([]);
    const plans = await plansOf(
      dependencies,
      channel,
      hostWith(AGENT_SOCKET, ''),
    );
    deepStrictEqual(
      [forwardingEnvironment(plans), plans.agentLink, channel.calls],
      [{}, {kind: 'none', reason: 'settingOff'}, []],
    );
  });

  it('F-2311.AC-11: no forwarded agent gives no SSH_AUTH_SOCK and lists nothing', async () => {
    const {dependencies} = forwardingOf();
    const channel = channelWith([]);
    const plans = await plansOf(dependencies, channel, hostWith('', ''));
    deepStrictEqual(
      [forwardingEnvironment(plans), plans.agentLink, channel.calls],
      [{}, {kind: 'none', reason: 'noForwardedSocket'}, []],
    );
  });

  it("F-2312.AC-7: the session's display is DISPLAY, unchanged", async () => {
    const {dependencies} = forwardingOf({agentForwarding: false});
    const plans = await plansOf(
      dependencies,
      channelWith([]),
      hostWith('', 'localhost:10.0'),
    );
    deepStrictEqual(forwardingEnvironment(plans), {DISPLAY: 'localhost:10.0'});
  });

  it('F-2312.AC-11: the setting false gives no DISPLAY', async () => {
    const {dependencies} = forwardingOf({x11Forwarding: false});
    const plans = await plansOf(
      dependencies,
      channelWith([]),
      hostWith('', 'localhost:10.0'),
    );
    deepStrictEqual(
      [forwardingEnvironment(plans), plans.display],
      [{}, {kind: 'none', reason: 'settingOff'}],
    );
  });

  it('F-2311.AC-2, F-2312.AC-7: both give exactly the two variables, nothing else', async () => {
    const {dependencies} = forwardingOf();
    const plans = await plansOf(
      dependencies,
      channelWith([]),
      hostWith(AGENT_SOCKET, 'localhost:10.0'),
    );
    deepStrictEqual(forwardingEnvironment(plans), {
      SSH_AUTH_SOCK: '/tmp/vscode-ssh-auth-sock-42',
      DISPLAY: 'localhost:10.0',
    });
  });

  it("F-2311 6.4: a stored record's plans are kept, and the probe's facts are ignored", async () => {
    const {dependencies} = forwardingOf();
    const stored: SharedRecord = {
      ...RECORD,
      agentLink: {
        kind: 'link',
        linkPath: '/tmp/vscode-ssh-auth-sock-7',
        target: '/tmp/ssh-first/agent.9',
      },
      display: {kind: 'display', value: 'localhost:11.0'},
    };
    const plans = await plansOf(
      dependencies,
      channelWith([]),
      hostWith(AGENT_SOCKET, 'localhost:10.0'),
      stored,
    );
    deepStrictEqual(plans, {
      agentLink: stored.agentLink,
      display: stored.display,
    });
  });

  it('F-2311 R2: a stored record without plans plans as a new connection', async () => {
    const {dependencies} = forwardingOf();
    const plans = await plansOf(
      dependencies,
      channelWith([]),
      hostWith(AGENT_SOCKET, 'localhost:10.0'),
      RECORD,
    );
    deepStrictEqual(forwardingEnvironment(plans), {
      SSH_AUTH_SOCK: '/tmp/vscode-ssh-auth-sock-42',
      DISPLAY: 'localhost:10.0',
    });
  });

  it('F-2311 R2: a drawn name a link in /tmp has is drawn again', async () => {
    const {dependencies} = forwardingOf({draws: [42, 43]});
    const plans = await plansOf(
      dependencies,
      channelWith(['/tmp/vscode-ssh-auth-sock-42', 'motd text']),
      hostWith(AGENT_SOCKET, ''),
    );
    deepStrictEqual(plans.agentLink, {
      kind: 'link',
      linkPath: '/tmp/vscode-ssh-auth-sock-43',
      target: AGENT_SOCKET,
    });
  });

  it('ADR-0010: the agent-link listing: noise around and inside its stream changes nothing', async () => {
    const {dependencies} = forwardingOf({draws: [1, 2]});
    const plans = await plansOf(
      dependencies,
      channelWith(
        withNoise([
          'see /tmp/vscode-ssh-auth-sock-1 elsewhere',
          ' /tmp/vscode-ssh-auth-sock-1',
        ]),
      ),
      hostWith(AGENT_SOCKET, ''),
    );
    deepStrictEqual(plans.agentLink, {
      kind: 'link',
      linkPath: '/tmp/vscode-ssh-auth-sock-1',
      target: AGENT_SOCKET,
    });
  });

  it('F-2311 R2: a listing that fails draws among no names, with a warn line', async () => {
    const {dependencies, sink} = forwardingOf();
    const channel = new RecordingChannel({
      identity: 'harness',
      platformHint: 'linux',
      scripts: [
        listingAnswer([], {kind: 'channelClosed', detail: 'session ended'}),
      ],
    });
    const plans = await plansOf(
      dependencies,
      channel,
      hostWith(AGENT_SOCKET, ''),
    );
    deepStrictEqual(
      [plans.agentLink, warnings(sink)],
      [
        {
          kind: 'link',
          linkPath: '/tmp/vscode-ssh-auth-sock-42',
          target: AGENT_SOCKET,
        },
        ['the agent links in /tmp could not be listed: session ended'],
      ],
    );
  });

  it('F-2311 6.5: a reconnection of the window keeps the link it planned before', async () => {
    const {dependencies} = forwardingOf({draws: [42, 43]});
    await plansOf(dependencies, channelWith([]), hostWith(AGENT_SOCKET, ''));
    const again = await plansOf(
      dependencies,
      channelWith(['/tmp/vscode-ssh-auth-sock-42']),
      hostWith('/tmp/ssh-y/agent.2', ''),
    );
    deepStrictEqual(again.agentLink, {
      kind: 'link',
      linkPath: '/tmp/vscode-ssh-auth-sock-42',
      target: '/tmp/ssh-y/agent.2',
    });
  });

  it('F-2311 R6: the plans are told in the log and nowhere else', async () => {
    const {dependencies, sink, terminals} = forwardingOf({
      x11Forwarding: false,
    });
    await plansOf(dependencies, channelWith([]), hostWith(AGENT_SOCKET, ''));
    deepStrictEqual(
      [sink.lines.map(line => line.message), terminals],
      [
        [
          `agent forwarding: /tmp/vscode-ssh-auth-sock-42 links to ${AGENT_SOCKET}`,
          'X11 forwarding: none (settingOff)',
        ],
        [],
      ],
    );
  });

  it('F-2312 R6: a display plan is told in the log', async () => {
    const {dependencies, sink} = forwardingOf({agentForwarding: false});
    await plansOf(
      dependencies,
      channelWith([]),
      hostWith('', 'localhost:10.0'),
    );
    deepStrictEqual(
      sink.lines.map(line => line.message),
      [
        'agent forwarding: none (settingOff)',
        'X11 forwarding: DISPLAY is localhost:10.0',
      ],
    );
  });
});

const LINK = {
  kind: 'link',
  linkPath: '/tmp/vscode-ssh-auth-sock-42',
  target: AGENT_SOCKET,
} as const;

/** A channel whose `readlink` prints `lines` and ends as `ending` says, recording what it ran. */
function readBackChannel(
  lines: readonly string[],
  ending: ScriptAnswer['ending'] = {kind: 'exit', status: 0},
): RecordingChannel {
  return new RecordingChannel({
    identity: 'harness',
    platformHint: 'linux',
    scripts: [
      {
        interpreter: 'posixShell',
        matches: script => script.startsWith('readlink'),
        lines,
        ending,
      },
    ],
  });
}

/** The log lines and the channel's scripts of a link whose terminal ends with `linkEnd`, once all of it settled. */
async function linked(
  channel: RecordingChannel,
  linkEnd: Promise<void> = Promise.resolve(),
): Promise<{warned: string[]; logged: string[]; scripts: string[]}> {
  const {dependencies, sink} = forwardingOf({linkEnd});
  linkAgent(dependencies, channel, LINK);
  await linkEnd.catch(() => undefined);
  await new Promise(resolve => setImmediate(resolve));
  return {
    warned: warnings(sink),
    logged: sink.lines.map(line => line.message),
    scripts: channel.calls.map(call =>
      call.operation === 'runScript' ? call.request.script : '',
    ),
  };
}

describe('the agent link of a connect', () => {
  it('F-2311 5.0 steps 5-6: a link plan runs ln in one hidden terminal, its paths as arguments of their own, always exiting 0', () => {
    const {dependencies, terminals} = forwardingOf({
      linkEnd: new Promise(() => undefined),
    });
    linkAgent(dependencies, readBackChannel([]), LINK);
    deepStrictEqual(terminals, [
      {
        name: LINK_TERMINAL_NAME,
        command: [
          '/bin/sh',
          '-c',
          'ln -sfn -- "$1" "$2" 2>/dev/null; exit 0',
          'sh',
          AGENT_SOCKET,
          '/tmp/vscode-ssh-auth-sock-42',
        ],
      },
    ]);
  });

  it('F-2311 5.0 step 5: nothing is read before the terminal ended', () => {
    const {dependencies} = forwardingOf({
      linkEnd: new Promise(() => undefined),
    });
    const channel = readBackChannel([AGENT_SOCKET]);
    linkAgent(dependencies, channel, LINK);
    deepStrictEqual(channel.calls, []);
  });

  it('F-2311 5.0 step 5: a none plan runs no terminal', () => {
    const {dependencies, terminals} = forwardingOf();
    linkAgent(dependencies, readBackChannel([]), {
      kind: 'none',
      reason: 'noForwardedSocket',
    });
    deepStrictEqual(terminals, []);
  });

  it('F-2311 7.E7: a link made reads back as the target, read only, with an info line and no warn', async () => {
    deepStrictEqual(await linked(readBackChannel([AGENT_SOCKET])), {
      warned: [],
      logged: [
        `the agent link /tmp/vscode-ssh-auth-sock-42 points at ${AGENT_SOCKET}`,
      ],
      scripts: ["readlink -- '/tmp/vscode-ssh-auth-sock-42'"],
    });
  });

  it('F-2311 7.E7: a link that points elsewhere is a warn line', async () => {
    deepStrictEqual(
      (await linked(readBackChannel(['/tmp/ssh-other/agent.2']))).warned,
      [
        'the agent link /tmp/vscode-ssh-auth-sock-42 was not made: it points at /tmp/ssh-other/agent.2',
      ],
    );
  });

  it('F-2311 7.E7: no link (the ln failed, or the trust was refused) is a warn line', async () => {
    deepStrictEqual(
      (await linked(readBackChannel([], {kind: 'exit', status: 1}))).warned,
      [
        'the agent link /tmp/vscode-ssh-auth-sock-42 was not made: there is no link',
      ],
    );
  });

  it('F-2311 7.E7: a read back that fails is a warn line', async () => {
    deepStrictEqual(
      (
        await linked(
          readBackChannel([], {
            kind: 'fail',
            failure: {kind: 'channelClosed', detail: 'session ended'},
          }),
        )
      ).warned,
      [
        'the agent link /tmp/vscode-ssh-auth-sock-42 was not made: it could not be read back: session ended',
      ],
    );
  });

  it('F-2311 7.E7: a terminal the editor could not run is a warn line, and nothing is read', async () => {
    deepStrictEqual(
      await linked(
        readBackChannel([AGENT_SOCKET]),
        Promise.reject(new Error('no terminal')),
      ),
      {
        warned: [
          'the agent link /tmp/vscode-ssh-auth-sock-42 was not made: Error: no terminal',
        ],
        logged: [
          'the agent link /tmp/vscode-ssh-auth-sock-42 was not made: Error: no terminal',
        ],
        scripts: [],
      },
    );
  });
});
