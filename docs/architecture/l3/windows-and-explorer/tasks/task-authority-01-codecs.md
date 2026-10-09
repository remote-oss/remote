# Task card authority-01: lib-authority package and the authority codecs (pure)

Brief: slice 1 (build-order step 10, pure part). Contract: `../contracts.md` §3.1. Reviewing coder:
`remote-coding-worker-1`. Depends on `lib-identifiers` on main (types only).

## 1. Package and file boundary

Create `packages/lib-authority` in the shape of `packages/lib-host` (package.json `lib-authority`, private, `exports`
`.` and the testing entries by name; tsconfig pair; `coverage.json`; README in the product's voice: resolver plumbing
for remote authorities; allowed imports `lib-identifiers`, `lib-standdown`, `lib-log`). Files: `src/index.ts`,
`src/codecs/types.ts`, `src/codecs/ssh-remote.ts`, `src/codecs/wsl.ts`, `src/codecs/container.ts`,
`src/codecs/tunnel.ts`, `src/codecs/registry.ts`; tests `test/unit/codec-ssh-remote.test.ts`,
`test/unit/codec-wsl.test.ts`, `test/unit/codec-container.test.ts`, `test/unit/codec-tunnel.test.ts`,
`test/unit/codec-registry.test.ts`. No `vscode` import.

## 2. Contract

```ts
export type Family = 'ssh-remote' | 'wsl' | 'dev-container' | 'attached-container' | 'k8s-container' | 'apple-container' | 'exec' | 'tunnel';
export interface SshTarget { kind: 'alias'; alias: string } | { kind: 'host'; hostName: string; user?: string; port?: number }
export interface WslTarget { distro: string; outer?: DecodedTarget }          // distro '' = default distro, passed through, no case folding
export interface ContainerTarget { payload: string; outer?: DecodedTarget }   // payload: the family's own payload text exactly as written (F-0501's shape is decoded by area C later); outer: the hop after '@'
export interface TunnelTarget { tunnelName: string; distro?: string }
export interface DecodedTarget { family: Family; target: SshTarget | WslTarget | ContainerTarget | TunnelTarget; rawHostString: string }
export type MalformedAuthority = { family: Family; payload: string; reason: string };
export interface Codec<T> { decode(payload: string): { target: T; rawHostString: string } | { malformed: MalformedAuthority }; encode(target: T): string; label(target: T): string }
export const sshRemoteCodec: Codec<SshTarget>;
export const wslCodec: Codec<WslTarget>;
export function containerCodec(family: 'dev-container' | 'attached-container' | 'k8s-container' | 'apple-container' | 'exec'): Codec<ContainerTarget>;
export const tunnelCodec: Codec<TunnelTarget>;
export function decodeAuthority(authority: string): DecodedTarget | { malformed: MalformedAuthority };   // splits at the first '+'; unknown family → malformed reason 'unknownFamily'
export function encodeAuthority(decoded: DecodedTarget): string;   // `${family}+${codec.encode(target)}`
```

Rules (ruled 2026-10-08; order matters). `ssh-remote` payload forms (F-2008 BR-5, F-2301 BR-4, F-2501 BR-1, AC-6):
first the empty/whitespace/control checks (malformed `empty`, `whitespace`, `control`); then (1) the JSON form: if the
payload is even-length lower-case hex AND its bytes are valid UTF-8 AND `JSON.parse` yields an object, it IS the JSON
form: `hostName` must be a non-empty string (else malformed `badJson`); `port`, when present, is an integer 1–65535
or a string of digits in that range (F-2501 AC-6; `"22"` → 22), anything else malformed `badPort`; `user` a string
if present; (2) otherwise the bare form: `/^[a-z0-9.:-]+$/` (lower-case only) → `{kind:'host', hostName}` (so `abcd`
and `ff` are hosts, not errors; a hex-looking bare string is a plain host); (3) otherwise `{kind:'alias', alias}`.
There is no `badHex`: a hex-looking string that is not JSON falls through to (2) or (3). `encode`: alias → the alias; host without
user and port whose name matches the lower-case bare pattern → the bare host name; every other host (user or port
present, or an upper-case or otherwise non-bare name, F-2008 §6.2) → the hex of the compact JSON
`{"hostName":…,"user":…,"port":…}` (keys in that order, absent ones omitted, port as a number). `label`: alias → alias; host → `user@hostName:port` with the present parts
(`hostName`, `user@hostName`, `hostName:port`). IPv6 host names: kept whole; `[::1]` with brackets in the bare form →
hostName `::1` (brackets removed), re-encoded with brackets (F-2501 Q1).
`wsl` payload: `<distro>` or `<distro>@<outer authority>`; distro may be empty; `outer` decoded with `decodeAuthority`
(a malformed outer → malformed reason `badOuter`); `encode` the reverse; `label` is the distro or `default distro`
when empty. Container families: payload split at the first `@` into `payload` and `outer` the same way; `label` =
the payload. `tunnel`: `<tunnelName>` or `<tunnelName>/<distro>`; empty name → malformed `empty`; `label` the name.

## 3. Test table

| Given | Expected |
|---|---|
| `decodeAuthority('ssh-remote+myhost')` | family ssh-remote, `{kind:'host', hostName:'myhost'}`, rawHostString `'myhost'` |
| `'ssh-remote+my_host'` (underscore) | `{kind:'alias', alias:'my_host'}` |
| `'ssh-remote+' + hex('{"hostName":"h","user":"u","port":2222}')` | host h, user u, port 2222; rawHostString = the hex |
| hex JSON with `"port":"22"` (digit string) | host with port 22 (F-2501 AC-6) |
| hex JSON with `"port":"2x"` | malformed `badPort` |
| hex JSON with port 70000 | malformed `badPort` |
| hex JSON without hostName | malformed `badJson` |
| `'abc'` | host `abc` (bare pattern) |
| `'abcd'` (valid hex, bytes not JSON) | host `abcd` |
| `'ff'` | host `ff` |
| `'ssh-remote+' + hex('{"hostName":"H"}')` then `encode` of host `H` | decode gives host `H`; `encode({kind:'host', hostName:'H'})` gives the hex form (upper case is not bare) |
| `'ssh-remote+'` | malformed `empty` |
| `'ssh-remote+a b'` | malformed `whitespace` |
| `'ssh-remote+a\u0001'` | malformed `control` |
| `'ssh-remote+[::1]'` | malformed `control`? no: `[` is not bare and not hex → alias `[::1]`; IPv6 literals travel in the JSON form (F-2501 Q1: kept whole as hostName `::1`); add: hex JSON with hostName `::1` → host `::1`, `encode` → the hex form |
| `encode({kind:'host', hostName:'h'})` | `'h'` |
| `encode({kind:'host', hostName:'h', user:'u'})` | hex of `{"hostName":"h","user":"u"}` |
| `encode({kind:'host', hostName:'h', port: 22})` | hex of `{"hostName":"h","port":22}` |
| `label` of alias `a`, host `h`, host `u@h`, host `h` port 22, host `u@h` port 22 | `a`, `h`, `u@h`, `h:22`, `u@h:22` |
| property: for 200 generated targets (alias strings, hosts with optional user/port) `decode(encode(t))` | deep-equals `t` (use a seeded generator in the test; no library) |
| property: for the three fixed forms, `encode(decode(a))` | equals `a` |
| `'wsl+Ubuntu'` | `{distro:'Ubuntu'}`; label `Ubuntu` |
| `'wsl+'` | `{distro:''}`; label `default distro`; `encode` gives `''` |
| `'wsl+Ubuntu@ssh-remote+h'` | distro Ubuntu, outer = decoded `ssh-remote+h`; `encode` round-trips |
| `'wsl+Ubuntu@nope+x'` | malformed `badOuter` |
| `'dev-container+abcd@ssh-remote+h'` | payload `abcd`, outer decoded; family dev-container |
| `'attached-container+abcd'` | payload, no outer |
| each of the five container families | `containerCodec(f).decode` works and `decodeAuthority` dispatches to it |
| `'tunnel+mytunnel'` and `'tunnel+mytunnel/Ubuntu'` | `{tunnelName:'mytunnel'}`, `{tunnelName:'mytunnel', distro:'Ubuntu'}` |
| `'tunnel+'` | malformed `empty` |
| `decodeAuthority('nope+x')` | malformed `unknownFamily` |
| `decodeAuthority('noplus')` | malformed `unknownFamily` (no `+`) |
| `encodeAuthority(decodeAuthority(a))` for one authority per family | equals `a` |

## 4. Rule for the worker

As card log-01 (tests first; signatures exact; no behaviour beyond the table; ADR-0003; full gate list; 100 %
coverage; `coverage:update`).

## 5. Gates and review

PR title `lib-authority: package and codecs (card authority-01)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

Windows client user-name forms are provisional (lab) and not in this card. If `[::1]` handling conflicts with the
hex JSON form (a JSON hostName `::1` encodes without brackets), keep JSON as written and report.
