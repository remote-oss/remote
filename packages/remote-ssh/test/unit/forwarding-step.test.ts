import {deepStrictEqual, strictEqual} from 'node:assert';
import type {ChannelFailure} from 'lib-host';
import {
  RecordingChannel,
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ProbedHost} from 'lib-server';
import type {SharedRecord} from 'lib-ssh';
import type {AgentLinkPlan} from '../../src/environment/agent-link.ts';
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

/** The answer to the `ln` of the link. */
function linkAnswer(
  ending: ScriptAnswer['ending'],
  lines: readonly string[] = [],
): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: script => script.includes('ln -sfn'),
    lines,
    ending,
  };
}

/** A terminal the fake editor holds: its name, and the work it runs when the editor opens it. */
interface FakeTerminal {
  name: string;
  work: () => Promise<void>;
}

/** The forwarding over fakes, with the draws, the terminals opened and the log they write. */
function forwardingOf(
  changes: {
    agentForwarding?: boolean;
    x11Forwarding?: boolean;
    draws?: number[];
    windowLink?: string;
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
        open: (name, work) => {
          terminals.push({name, work});
        },
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    terminals,
    sink,
  };
}

/** A channel answering the listing with `names`, then each of `answers`. */
function channelWith(
  names: readonly string[],
  ...answers: ScriptAnswer[]
): RecordingChannel {
  return new RecordingChannel({
    identity: 'harness',
    platformHint: 'linux',
    scripts: [listingAnswer(names), ...answers],
  });
}

/** The scripts the channel ran, in order. */
function scriptsOf(channel: RecordingChannel): string[] {
  return channel.calls.map(call =>
    call.operation === 'runScript' ? call.request.script : call.operation,
  );
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

/** The link of `plan` made over a channel with `answers`, after the editor opened its terminal. */
async function linkedOver(
  plan: AgentLinkPlan,
  ...answers: ScriptAnswer[]
): Promise<{channel: RecordingChannel; sink: MemorySink}> {
  const {dependencies, terminals, sink} = forwardingOf();
  const channel = new RecordingChannel({
    identity: 'harness',
    platformHint: 'linux',
    scripts: answers,
  });
  linkAgent(dependencies, channel, plan);
  await terminals[0]?.work();
  return {channel, sink};
}

const LINK_SCRIPT = `cd /tmp && ln -sfn -- '${AGENT_SOCKET}' '/tmp/vscode-ssh-auth-sock-42'`;

describe('the agent link of a connect', () => {
  it('F-2311 5.0 step 5: a link plan opens one terminal, and nothing runs before the editor opens it', () => {
    const {dependencies, terminals} = forwardingOf();
    const channel = channelWith([], linkAnswer({kind: 'exit', status: 0}));
    linkAgent(dependencies, channel, LINK);
    deepStrictEqual(
      [terminals.map(terminal => terminal.name), channel.calls],
      [[LINK_TERMINAL_NAME], []],
    );
  });

  it('F-2311 5.0 step 6: when the editor opens it, ln runs once in /tmp with its paths quoted', async () => {
    const {channel} = await linkedOver(
      LINK,
      linkAnswer({kind: 'exit', status: 0}),
    );
    deepStrictEqual(scriptsOf(channel), [LINK_SCRIPT]);
  });

  it('F-2311 BR-4: a path with a quote stays one word', async () => {
    const {channel} = await linkedOver(
      {...LINK, target: "/tmp/it's/agent"},
      linkAnswer({kind: 'exit', status: 0}),
    );
    strictEqual(
      scriptsOf(channel)[0]?.includes(`-- '/tmp/it'\\''s/agent' `),
      true,
    );
  });

  it('F-2311 5.0 step 5: a none plan opens no terminal', () => {
    const {dependencies, terminals} = forwardingOf();
    linkAgent(dependencies, channelWith([]), {
      kind: 'none',
      reason: 'noForwardedSocket',
    });
    deepStrictEqual(terminals, []);
  });

  it('F-2311 7.E7: an ln that fails is a warn line with its output', async () => {
    const {sink} = await linkedOver(
      LINK,
      linkAnswer({kind: 'exit', status: 1}, ['ln: Permission denied']),
    );
    deepStrictEqual(warnings(sink), [
      'the agent link /tmp/vscode-ssh-auth-sock-42 was not made: ln exited with 1: ln: Permission denied',
    ]);
  });

  it('F-2311 7.E7: a channel that fails is a warn line', async () => {
    const {sink} = await linkedOver(
      LINK,
      linkAnswer({
        kind: 'fail',
        failure: {kind: 'channelClosed', detail: 'session ended'},
      }),
    );
    deepStrictEqual(warnings(sink), [
      'the agent link /tmp/vscode-ssh-auth-sock-42 was not made: session ended',
    ]);
  });

  it('F-2311 7.E7: a run that throws is a warn line, and the work still settles', async () => {
    const {sink} = await linkedOver(LINK);
    deepStrictEqual(warnings(sink), [
      `the agent link /tmp/vscode-ssh-auth-sock-42 was not made: Error: no scripted answer left for a posixShell script: ${LINK_SCRIPT}`,
    ]);
  });
});
