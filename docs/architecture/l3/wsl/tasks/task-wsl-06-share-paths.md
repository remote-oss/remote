# Task card wsl-06: share path forms and the mount shape

Why: a Windows path on a distro's share becomes a Linux path in that distro without starting a process
(F-6204.BR-1), a Linux path becomes a `\\wsl.localhost\` path and never `\\wsl$` (F-6204.BR-2, F-6207.BR-3), and the
recommendation for a folder under `/mnt/<letter>/` tests the path string only (F-6206.BR-1). Drive paths go through
`wslpath` in the distro (next brief) and are not this card. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-wsl/src/share-path.ts` (new), `test/unit/share-path.test.ts` (new), `src/index.ts` (one export line).
Nothing else. No `node:path`, no `URL`.

`test/unit/skeleton.test.ts`: delete it in this card if it is still on main when the branch starts or rebases. It
asserts that the package exports nothing, which this card's export line ends, and the module's own tests replace it for
coverage. If another WSL card has already deleted it, leave it absent. This is the one change outside the files above.

## 2. Contract

```ts
export type ShareResult =
  | {readonly kind: 'share'; readonly distro: string; readonly linuxPath: string}
  | {readonly kind: 'notShare'};
export function shareToDistro(windowsPath: string): ShareResult;
export function distroToShare(distro: string, linuxPath: string): string;
export function isWindowsMountShape(linuxPath: string): boolean;
export type WslpathResult =
  | {readonly kind: 'path'; readonly path: string}
  | {readonly kind: 'unusable'};
export function parseWslpathOutput(text: string): WslpathResult;
```

- `shareToDistro`: the input starts with `\\`, then a host equal to `wsl.localhost` or `wsl$` ignoring case, then `\`
  or the end, then a distro name of one or more characters up to the next `\` or the end, then the rest. No distro
  (nothing after the host, or an empty segment) or any other form: `notShare`. `distro` is returned as written.
  `linuxPath` is `/` followed by the rest with every `\` replaced by `/`; no rest gives `/`. Other characters
  (spaces, non-ASCII) are kept; a trailing `\` becomes a trailing `/`.
- `distroToShare`: `\\wsl.localhost\` + `distro` + `linuxPath` with every `/` replaced by `\`; so `/` gives
  `\\wsl.localhost\<distro>\`. The host is always `wsl.localhost`. `linuxPath` starts with `/` (caller's duty).
- `isWindowsMountShape`: true when the path is `/mnt/`, one lower-case ASCII letter, `/`, and at least one more
  character (F-6206.BR-1; the literal `/mnt`, never a configured automount root).
- `parseWslpathOutput`: remove one trailing `\n` or `\r\n`; empty or containing another `\n`: `unusable`;
  otherwise `path` is the rest unchanged (spaces and non-ASCII kept, no trim).

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-6204.BR-1 | `\\wsl.localhost\Ubuntu\home\lex\proj` | `share`, `Ubuntu`, `/home/lex/proj` |
| F-6204.BR-1 | `\\wsl$\Ubuntu\home\lex\proj` | `share`, `Ubuntu`, `/home/lex/proj` |
| F-6204.BR-1 | `\\WSL.LocalHost\Ubuntu\a` and `\\WSL$\Ubuntu\a` | `share`, `Ubuntu`, `/a` (host case ignored) |
| F-6204.BR-1 | `\\wsl.localhost\ubuntu\a` | `distro` `ubuntu` as written |
| F-6204.BR-1 | `\\wsl.localhost\Ubuntu` and `\\wsl.localhost\Ubuntu\` | `share`, `/` (root) |
| F-6204.BR-2 | `\\wsl.localhost\fixture γ\home\a b\dir\` | `distro` `fixture γ`, `/home/a b/dir/` |
| F-6204.BR-1 | `C:\Users\lex`, `\\server\share\x`, `\\wsl.localhost`, `\\wsl.localhost\`, `\\wsl.localhostx\Ubuntu\a`, `` | `notShare` (one `it` each) |
| F-6207.BR-3 | `distroToShare('Ubuntu', '/home/lex/proj')` | `\\wsl.localhost\Ubuntu\home\lex\proj` |
| F-6204.BR-2 | `distroToShare('fixture γ', '/home/a b/é')` | `\\wsl.localhost\fixture γ\home\a b\é` |
| F-6207.BR-3 | `distroToShare('Ubuntu', '/')` | `\\wsl.localhost\Ubuntu\` |
| F-6204.BR-2 | `shareToDistro(distroToShare(d, p))` for `Ubuntu`+`/`, `Ubuntu`+`/a/b`, `fixture γ`+`/x y` | `share` with the same distro and path |
| F-6206.BR-1 | `/mnt/c/x`, `/mnt/d/a/b` | true |
| F-6206.BR-1 | `/mnt/cd/x`, `/win/c/x`, `/mnt/1/x`, `/mnt/`, `/home/mnt/c/x` | false (one `it` each) |
| contracts.md §1 D3 | `parseWslpathOutput('/mnt/c/Users/a b\n')`, with `\r\n` | `path` `/mnt/c/Users/a b` |
| contracts.md §1 D3 | `'C:\\Users\\é'` with no line end | `path` unchanged |
| contracts.md §1 D3 | `''`, `'\n'`, `'a\nb\n'` | `unusable` |

## 4. Rule for the worker

As card log-01; names of four characters or more (`now` excepted); no comment beyond what the guide requires; tests
first; every branch has a row; coverage 90/85/90 and the ratchet.

## 5. Gates and review

PR title `lib-wsl: share paths and mount shape (card wsl-06)`; answers R1–R6. Merge after wsl-00.

## 6. Open rows (stop and report)

- `/mnt/c` and `/mnt/c/`: the brief says `/mnt/c` is true, F-6206.BR-1 requires "at least one more segment" and the
  contract says `/mnt/<letter>/…`. The card follows the spec and has no row for them; the lead rules.
- An upper-case letter (`/mnt/C/x`): F-6206.BR-1 says "one letter" without case. Not tested.
- `\\?\UNC\wsl$\…`, forward-slash forms (`//wsl$/Ubuntu/x`) and doubled backslashes inside the rest: the spec is
  silent; not tested.
- A `linuxPath` that does not start with `/` given to `distroToShare`: not tested.
