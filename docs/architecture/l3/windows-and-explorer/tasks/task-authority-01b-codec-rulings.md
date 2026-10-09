# Task card authority-01b: the five codec rulings of 2026-10-08 (follow-up to authority-01, after #153 merges)

Contract: card authority-01 §6 (the rulings) and `../contracts.md` §3.1. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-authority/src/codecs/ssh-remote.ts`, `wsl.ts`, `container.ts`, `registry.ts`, their tests; no new
exports beyond `decodeOuter`'s injection type. Nothing else.

## 2. Contract

1. A JSON payload whose decoded text starts with U+FEFF is malformed `badJson`.
2. Host names (plain text and JSON `hostName`) containing a character of Unicode category Zs other than U+0020, or
   U+2028, U+2029, or a C1 control U+0080–U+009F, are malformed: `whitespace` for the separators, `control` for the C1
   range (the ASCII rules are unchanged; U+0020 stays `whitespace`).
3. In the JSON form, `"user": ""` is treated as absent (the decoded target has no `user`; `encode` omits the key).
4. `label` never returns English text: the WSL default-distro label is the id `wsl.defaultDistro`; every other
   `label` result is the raw text or the composed `user@host:port` form.
5. Neither `container.ts` nor `wsl.ts` imports `registry.ts` (amended 2026-10-08 with exact signatures; the
   first wording injected only a decoder, but `encode` needs the outer's encoder too and both files share the
   outer-hop helpers). A new leaf module `src/codecs/outer-hop.ts` (imports only `types.ts`) holds:
   ```ts
   export interface OuterCodec {
     decode(authority: string): DecodedTarget | {malformed: MalformedAuthority};
     encode(decoded: DecodedTarget): string;
   }
   export type OuterHop = {name: string; outer: DecodedTarget | undefined} | {name: string; refusal: MalformedAuthority};
   export function outerHop(family: Family, payload: string, outer: OuterCodec): OuterHop;   // today's registry function, the outer decoded through `outer.decode`
   export function outerPayload(name: string, outer: DecodedTarget | undefined, codec: OuterCodec): string;  // `name` or `${name}@${codec.encode(outer)}`
   ```
   `container.ts`: `export function containerCodec(family: ContainerFamily, outer: OuterCodec): Codec<ContainerTarget>`.
   `wsl.ts`: `export function wslCodecOf(outer: OuterCodec): Codec<WslTarget>` (a factory now).
   `registry.ts`: `const REGISTRY_OUTER: OuterCodec = {decode: decodeAuthority, encode: encodeAuthority}`, the
   container codecs built with it, and `export const wslCodec: Codec<WslTarget> = wslCodecOf(REGISTRY_OUTER)` so
   the exported name stays; `outerHop`/`outerPayload` leave `registry.ts`. `src/index.ts` keeps exporting
   `wslCodec` (from `registry.ts`) and adds `OuterCodec`. A test greps the imports of `container.ts`, `wsl.ts`,
   `ssh-remote.ts`, `tunnel.ts` and `outer-hop.ts` for `registry`: none.

## 3. Test table

| Given | Expected |
|---|---|
| hex of `'﻿{"hostName":"h"}'` | malformed `badJson` |
| plain `'a b'` (no-break space), `'a　b'` (ideographic space) | malformed `whitespace` |
| plain `'a b'`, `'a b'` | malformed `whitespace` |
| plain `'a\u0085b'`, `'a\u009Fb'` | malformed `control` |
| JSON hostName `'a\u0085b'` | malformed `control` (same rule in the JSON form) |
| JSON `{"hostName":"h","user":""}` | host `h` without `user`; `encode` → `'h'` (plain, since no user and no port remain) |
| JSON `{"hostName":"h","user":"","port":22}` | host `h` port 22; `encode` → hex of `{"hostName":"h","port":22}` |
| `wslCodec.label({distro:''})` | `'wsl.defaultDistro'` |
| `wslCodec.label({distro:'Ubuntu'})` | `'Ubuntu'` |
| a grep test over `src/codecs/*.ts` | no file but `registry.ts` mentions `registry` |
| `containerCodec('dev-container', {decode: decodeAuthority, encode: encodeAuthority}).decode('abcd@ssh-remote+h')` | outer decoded through the injected codec |
| the same codec's `encode({payload:'abcd', outer: <decoded ssh-remote+h>})` | `'abcd@ssh-remote+h'` (re-encoded through the injected codec) |
| `wslCodecOf(fakeOuter).decode('Ubuntu@x')` with `fakeOuter.decode` returning a fixed target | the fixed target as `outer` (the fake proves the injection) |
| the existing authority-01 tests | unchanged results |

## 4. Rule for the worker

As card log-01; the ratchet may only rise; ADR-0008 in comments (no ids, no origin wording).

## 5. Gates and review

PR title `lib-authority: codec rulings (card authority-01b)`.

## 6. Open rows

None.
