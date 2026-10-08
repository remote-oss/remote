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

Rules. `ssh-remote` payload forms (F-2008 BR-5, F-2301 BR-4, F-2501): (a) a bare host name matching
`/^[a-z0-9.:-]+$/i` → `{kind:'host', hostName}` with no user or port; (b) lower-case hex (even length, `/^[0-9a-f]+$/`)
decoding to UTF-8 JSON `{"hostName": string, "user"?: string, "port"?: number}` (port an integer 1–65535) → `{kind:'host', …}`;
(c) anything else that is non-empty and contains no whitespace or control character → `{kind:'alias', alias}`;
empty, whitespace, a control character, hex that is not valid JSON, JSON without `hostName`, or a bad port → malformed
(reasons `empty`, `whitespace`, `control`, `badHex`, `badJson`, `badPort`). `encode`: alias → the alias; host without
user and port → the bare host name; host with user or port → the hex of the compact JSON `{"hostName":…,"user":…,"port":…}`
(keys in that order, absent ones omitted). `label`: alias → alias; host → `user@hostName:port` with the present parts
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
| hex JSON with `"port":"22"` (string) | malformed `badPort` |
| hex JSON with port 70000 | malformed `badPort` |
| hex JSON without hostName | malformed `badJson` |
| odd-length or non-hex `'abc'` that is otherwise alias-shaped | alias `abc` (alias wins: hex needs even length and only hex digits) — note: `'abcd'` IS valid hex; decoding it as JSON fails → malformed `badJson`; add both rows |
| `'ssh-remote+'` | malformed `empty` |
| `'ssh-remote+a b'` | malformed `whitespace` |
| `'ssh-remote+a\u0001'` | malformed `control` |
| `'ssh-remote+[::1]'` | host `::1`; `encode` gives `[::1]` |
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
