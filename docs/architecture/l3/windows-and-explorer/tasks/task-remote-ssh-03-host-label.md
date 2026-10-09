# Task card remote-ssh-03: the SSH host label (F-2502 BR-3)

Why: the suffix after a workspace name and the remote indicator text are `SSH: <host label>`; the host label follows
one rule (remote-oss/remote-ssh#60, BR-3). lib-authority's `Codec.label` is `user@host:port` for pickers and is not
this label (ruled 2026-10-08, #171). Reviewing coder: `remote-coding-worker-3`.

## 1. File boundary

`packages/remote-ssh/src/window/host-label.ts` (new), its test file. Nothing else; the registration that passes
the suffix is connect-03's.

## 2. Contract

```ts
import type {SshTarget} from 'lib-authority';
export function hostLabel(target: SshTarget): string;
// the host text alone; a port is appended as `:<port>` only when the host is an IP address literal and the target
// names a port. The user never appears. The caller prefixes `SSH: ` from its string table.
```

"IP address literal": `net.isIP(hostName) !== 0` after stripping one pair of enclosing `[` `]`; the label shows the
host without brackets (the spec leaves bracket handling open; this is the family's rule until the room answers Q1).
A `plain` target labels its `text` unchanged.

## 3. Test table

| Given | Expected |
|---|---|
| `{kind:'host', hostName:'my-alias'}` | `'my-alias'` |
| `{kind:'host', hostName:'my-alias', port:22}` | `'my-alias'` |
| `{kind:'host', hostName:'my-alias', user:'u', port:2222}` | `'my-alias'` |
| `{kind:'host', hostName:'192.0.2.10', user:'u'}` | `'192.0.2.10'` |
| `{kind:'host', hostName:'192.0.2.10', user:'u', port:22}` | `'192.0.2.10:22'` |
| `{kind:'host', hostName:'192.0.2.10', port:2222}` | `'192.0.2.10:2222'` |
| `{kind:'host', hostName:'build.example.com', user:'u', port:2200}` | `'build.example.com'` |
| `{kind:'host', hostName:'2001:db8::1', user:'u', port:2222}` | `'2001:db8::1:2222'` |
| `{kind:'host', hostName:'[2001:db8::1]', port:2222}` | `'2001:db8::1:2222'` |
| `{kind:'host', hostName:'[2001:db8::1]'}` | `'2001:db8::1'` |
| `{kind:'plain', text:'anything typed'}` | `'anything typed'` |

## 4. Rule for the worker

As card log-01; names of four characters or more; no comment beyond what the guide requires.

## 5. Gates and review

PR title `remote-ssh: host label (card remote-ssh-03)`; the package exists on main (pipeline merged 2026-10-09); `src/window/` is new; nothing else
changes.

## 6. Open rows

The IPv6 bracket rule (BR-3, Q1) is the family's until the room answers; the two bracket rows change then.
