# Task card remote-ssh-09: the host label of a plain authority (#141 card A)

Why: `../brief-remote-ssh-window-surfaces.md` ("The finding that comes first"). `hostLabel` (card remote-ssh-03) returns a
`plain` target's text unchanged, but lib-authority's codec decodes every non-hex authority as `{kind: 'plain', text}`.
So `ssh-remote+my-alias:22` shows `SSH: my-alias:22` and `u@192.0.2.10:2222` shows the user, against F-2502 BR-3
(observed) and AC-14, AC-15. Fix: parse a plain text with the picker's own `parseTypedHost`, then apply BR-3's one rule.
Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/window/host-label.ts` | the `plain` branch (section 2) |
| `packages/remote-ssh/test/unit/host-label.test.ts` | the rows of section 3 |

Nothing else. No new export.

## 2. Contract

`hostLabel(target: SshTarget): string` keeps its signature (lib-authority's `SshTarget`).

- A `plain` target: `parseTypedHost(target.text)` from `../connect/typed-input.ts` gives lib-ssh's `{host, user?,
  port?}`. Its `host` and `port` (never its `user`) become `{kind: 'host', hostName: host, port}` (no `port` key when
  it has none), and `hostLabel` of that is the result. One rule for both forms.
- A `host` target: unchanged. One pair of brackets is stripped from the host name; `:<port>` follows only when the host
  is an IP address literal and a port is named; the user is never shown.

## 3. Test table

Every row of F-2502 BR-3's table, as a `plain` authority unless it is a hex form. One `it` per row; the name starts with
`F-2502.BR-3`. The existing hex-form rows stay and pass.

| Authority after `ssh-remote+` (as the target) | Label |
|---|---|
| `{plain 'my-alias'}` | `my-alias` |
| `{plain 'my-alias:22'}` | `my-alias` (port not shown after a name; observed R2-l) |
| `{plain 'u@192.0.2.10'}` | `192.0.2.10` |
| `{plain 'u@192.0.2.10:22'}` | `192.0.2.10:22` (an IP literal shows even port 22) |
| `{plain 'u@192.0.2.10:2222'}` | `192.0.2.10:2222` |
| `{plain '192.0.2.10:2222'}` | `192.0.2.10:2222` |
| `{plain '192.0.2.10'}` | `192.0.2.10` |
| `{plain 'u@my-alias'}` | `my-alias` |
| `{plain 'u@my-alias:2200'}` | `my-alias` |
| `{plain 'u@build.example.com:2200'}` | `build.example.com` |
| `{plain '[2001:db8::1]:2222'}` | `2001:db8::1:2222` (brackets stripped; the IPv6 interim of remote-ssh-03) |
| `{plain 'u@[2001:db8::1]'}` | `2001:db8::1` |
| `{plain 'anything typed'}` | `anything typed` (the existing row, still true) |

All rows were checked on a prototype of section 2 (2026-10-12): they pass, with the 11 existing host-label rows.

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the host label of a plain authority (card remote-ssh-09, #141 card A)`; Part of #141.

## 6. Open rows

None. IPv6 keeps remote-ssh-03's interim (brackets stripped) until F-2502 Q1 answers otherwise (athena's ruling 1).
