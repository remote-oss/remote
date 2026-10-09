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
export type SshTarget = { kind: 'plain'; text: string } | { kind: 'host'; hostName: string; user?: string; port?: number }
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

Rules (ruled 2026-10-08, revised the same day against F-2301 BR-4 and F-2008 §6.2; order matters). `ssh-remote`
payload forms: first the empty/whitespace/control checks (malformed `empty`, `whitespace`, `control`); then (1) the
JSON form: if the payload is even-length lower-case hex AND its bytes are valid UTF-8 AND `JSON.parse` yields an
object, it IS the JSON form: `hostName` a non-empty string (else malformed `badJson`); `port`, when present, an
integer 1–65535 or a string of digits in that range (F-2501 AC-6; `"22"` → 22), anything else malformed `badPort`;
`user` a string if present; (2) otherwise the payload is a PLAIN host string taken as written:
`{kind:'plain', text}` (whether it is a configured alias or a host name is decided later by the config model, not by
the codec). There is no `alias` kind and no `badHex`.
`encode` follows the extension's own rule, F-2301 BR-4 (byte-for-byte with the reference, F-2301 Q3 option A):
a target with no user and no port whose text contains no upper-case letter in any script and none of `/`, `+`, `\`
encodes plain, exactly as written (so `a_b.invalid`, `a%b.invalid`, `::1`, `fe80::1` stay plain); every other target
(a user, a port, an upper-case letter, `/`, `+`, `\`) encodes as the hex of the compact JSON
`{"hostName":…,"user":…,"port":…}` (keys in that order, absent ones omitted, port as a number; `h:22` is hex, the
port stays). Core's stricter plain set for its own "Open in Editor" links (F-2008 §6.2, `[a-z0-9.:-]`) is core's;
we decode what it produces but never encode by it. `label`: plain → the text; JSON host → `user@hostName:port` with
the present parts.
IPv6 literals: `::1` plain both ways; brackets never added or stripped (`[::1]` is a plain text `[::1]`); with a
user or port the JSON form carries hostName `::1` unbracketed.

`wsl` payload: `<distro>` or `<distro>@<outer authority>`; distro may be empty; `outer` decoded with `decodeAuthority`
(a malformed outer → malformed reason `badOuter`); `encode` the reverse; `label` is the distro or `default distro`
when empty. Container families: payload split at the first `@` into `payload` and `outer` the same way; `label` =
the payload. `tunnel`: `<tunnelName>` or `<tunnelName>/<distro>`; empty name → malformed `empty`; `label` the name.

## 3. Test table

| Given | Expected |
|---|---|
| `decodeAuthority('ssh-remote+myhost')` | family ssh-remote, `{kind:'plain', text:'myhost'}`, rawHostString `'myhost'` |
| `'ssh-remote+a_b.invalid'`, `'ssh-remote+a%b.invalid'`, `'ssh-remote+abcd'`, `'ssh-remote+ff'`, `'ssh-remote+::1'`, `'ssh-remote+[::1]'`, `'ssh-remote+lab@'` | plain with the text as written (a hex-looking string whose bytes are not JSON is plain) |
| `'ssh-remote+' + hex('{"hostName":"h","user":"u","port":2222}')` | host h, user u, port 2222; rawHostString = the hex |
| hex JSON with `"port":"22"` | host with port 22 |
| hex JSON with `"port":"2x"`, `"port":70000`, `"port":0` | malformed `badPort` |
| hex JSON without hostName, or hostName `""` | malformed `badJson` |
| hex JSON `{"hostName":"::1","port":22}` | host `::1` port 22; `encode` → the same hex |
| `'ssh-remote+'` | malformed `empty` |
| `'ssh-remote+a b'` | malformed `whitespace` |
| `'ssh-remote+a\u0001'` | malformed `control` |
| `encode({kind:'plain', text:'a_b.invalid'})` | `'a_b.invalid'` |
| `encode({kind:'host', hostName:'h'})` | `'h'` (plain) |
| `encode({kind:'host', hostName:'Mixed.invalid'})`, `('Ü.invalid')`, `('a/b')`, `('a+b')`, `('a\\b')` | the hex JSON form each |
| `encode({kind:'host', hostName:'h', user:'u'})` | hex of `{"hostName":"h","user":"u"}` |
| `encode({kind:'host', hostName:'h', port: 22})` | hex of `{"hostName":"h","port":22}` |
| `encode({kind:'plain', text:'UPPER-Alias'})` | hex of `{"hostName":"UPPER-Alias"}` (plain text with an upper-case letter cannot stay plain; BR-4) |
| `label` of plain `a`, host `h`, `u@h`, `h` port 22, `u@h` port 22 | `a`, `h`, `u@h`, `h:22`, `u@h:22` |
| property: 200 generated targets (plain texts without whitespace/control, hosts with optional user/port, mixed case) → `decode(encode(t))` | a target equal to `t` up to the plain/host collapse: a `host` without user/port that encoded plain decodes as `plain` with the same text; everything else deep-equal |
| property: for each fixed form, `encode(decode(a)) === a` | holds for plain and hex authorities |
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
