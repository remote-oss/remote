# Task card remote-ssh-12: an IPv6 host label keeps its brackets before a port

Why: athena's note on #303 (card remote-ssh-09). `hostLabel` strips the brackets of an IPv6 literal and then appends
`:<port>`, so `[2001:db8::1]:2222` reads `2001:db8::1:2222`, where the port is indistinguishable from the address's
last group. With a port the brackets stay; without one the bare form stays. This replaces the IPv6 interim of
remote-ssh-03 and remote-ssh-09 for the with-port case only. Reviewing coder: `remote-coding-worker-1`.

**Start only when both hold:**
- #303 (remote-ssh-09) is merged, since this card edits the same function and rows;
- the spec has confirmed the form (athena asked metis on remote-ssh; F-2502 Q1).

If either is missing, stop and report.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/window/host-label.ts` | the last line of `hostLabel` (section 2) |
| `packages/remote-ssh/test/unit/host-label.test.ts` | three rows change their expected text; one row is added (section 3) |

Nothing else.

## 2. Contract

When a port is appended and the host is an IPv6 literal (`isIP(hostName) === 6`), the host is written in brackets:
`[${hostName}]:${port}`. An IPv4 literal is written without brackets as today. A host with no port is written
without brackets, whatever it is. Only the final `return` changes:

```ts
const shown = isIP(hostName) === 6 ? `[${hostName}]` : hostName;
return `${shown}:${String(target.port)}`;
```

## 3. Test table

Rows that change (their names change with their expected text):

| Target | Was | Now |
|---|---|---|
| `{kind: 'host', hostName: '2001:db8::1', user: 'u', port: 2222}` | `2001:db8::1:2222` | `[2001:db8::1]:2222` |
| `{kind: 'host', hostName: '[2001:db8::1]', port: 2222}` | `2001:db8::1:2222` | `[2001:db8::1]:2222` |
| `{kind: 'plain', text: '[2001:db8::1]:2222'}` (from #303) | `2001:db8::1:2222` | `[2001:db8::1]:2222` |

Row added, to pin that an IPv4 literal gets no brackets:

| Target | Expected |
|---|---|
| `{kind: 'host', hostName: '192.0.2.10', port: 2222}` | `192.0.2.10:2222` |

Every other row stays as it is, including the bare `{kind: 'host', hostName: '[2001:db8::1]'}` → `2001:db8::1`.
All rows were checked on a prototype over #303's head (2026-10-12): the new expectations pass, and only the three
rows above change.

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: an IPv6 host label keeps its brackets before a port (card remote-ssh-12)`.

## 6. Open rows

None, once the two start conditions hold.
