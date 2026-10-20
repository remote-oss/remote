# Task card connect-80: the forwarding log lines say what was found, never the DISPLAY or the agent socket

Issue: #1123. Release 0.2. Size: S. Builder: `task:local`. Design: athena's ruling on remote-oss/remote-ssh#13
(2026-10-20): `DISPLAY` and `SSH_AUTH_SOCK` count as environment values under F-2003 BR-14. The log may say a
forwarded display or an agent socket was found, but never the value. Every change and row is spelled out below.

## 1. The change

`packages/remote-ssh/src/pipeline/forwarding-step.ts`, the two line builders. Replace their bodies exactly:

```ts
/** The log line of the agent link plan; it never names the socket or the link (F-2003 BR-14). */
function agentLine(plan: AgentLinkPlan): string {
  return plan.kind === 'link'
    ? 'agent forwarding: an agent socket was found, and the window links to it'
    : `agent forwarding: none (${plan.reason})`;
}

/** The log line of the display plan; it never names the display (F-2003 BR-14). */
function displayLine(plan: DisplayPlan): string {
  return plan.kind === 'display'
    ? 'X11 forwarding: a forwarded display was found'
    : `X11 forwarding: none (${plan.reason})`;
}
```

`plan.reason` is one of `settingOff`, `noSessionDisplay` and `noForwardedSocket`, which are our own words, so it
stays. Nothing else changes.

## 2. Rows (`packages/remote-ssh/test/unit/forwarding-step.test.ts`)

1. In the row `F-2311 R6: the plans are told in the log and nowhere else`, the expected agent line becomes
   `'agent forwarding: an agent socket was found, and the window links to it'`.
2. In the row `F-2312 R6: a display plan is told in the log`, the expected display line becomes
   `'X11 forwarding: a forwarded display was found'`.
3. A new row, after them:

```ts
it('F-2003 BR-14 (ruling-13-forwarding): no forwarded display or agent socket value reaches the log', async () => {
  const {dependencies, sink} = forwardingOf({});
  await plansOf(
    dependencies,
    channelWith([]),
    hostWith(AGENT_SOCKET, 'localhost:10.0'),
  );
  const logged = sink.lines.map(line => line.message).join('\n');
  deepStrictEqual(
    [
      logged.includes(AGENT_SOCKET),
      logged.includes('localhost:10.0'),
      logged.includes('/tmp/vscode-ssh-auth-sock'),
    ],
    [false, false, false],
  );
});
```

`forwardingOf({})` turns on both forwardings (the file's defaults are `true`). `AGENT_SOCKET`, `hostWith` and
`channelWith` are the file's own.

## 3. Gates

All gates, `forwarding-step.ts` at 100 %. PR title: `remote-ssh: the forwarding log lines never show the display or
the agent socket (card connect-80, #1123)`. Request athena only.
