# Task card server-10: `proxyVariableText` (the exported proxy value, F-2404 BR-5)

Why: the value of `remote.SSH.httpProxy` / `remote.SSH.httpsProxy` reaches the host re-serialised when its scheme
is exactly `http` or `https`, and exactly as typed otherwise (remote-oss/remote-ssh#49, BR-5; contracts.md §5,
ruled 2026-10-08). Which variables are exported and the per-host selection are not this card. Reviewing coder:
`remote-coding-worker-1`.

## 1. File boundary

`packages/lib-server/src/proxy-variable-text.ts` (new), `test/unit/proxy-variable-text.test.ts` (new), `src/index.ts`
(export only). Nothing else; no import of `vscode`, no `URL`/`url` module (its host rules differ from the table).

## 2. Contract

```ts
export function proxyVariableText(configuredValue: string): string;
```

The scheme is the text before the first `:`. When it is exactly `http` or `https` (lower case), the result is
EXACTLY `URI.parse(value).toString()` of `[oss] src/vs/base/common/uri.ts` at the 1.139.1 tag (ruled 2026-10-08,
#180): the same percent-decoding on parse (`percentDecode` with its graceful fallback for a run that does not
decode), the same encoding on `toString` (`encodeURIComponentFast` with its table and its unreserved set; only the
host is lower-cased, never the user info; the drive-letter rule of `_asFormatted`). Where this card and that source
disagree, the source wins and the row is an open row. Otherwise return the input unchanged.

## 3. Test table

| Given | Expected |
|---|---|
| `http://proxy.example:3128` | `http://proxy.example:3128/` |
| `https://proxy.example:3128` | `https://proxy.example:3128/` |
| `http://[::1]:3128` | `http://[::1]:3128/` |
| `http://$PROXYHOST:8890` | `http://%24proxyhost:8890/` |
| `http://Proxy.Example:3128/path` | `http://proxy.example:3128/path` (host lower-cased, path kept) |
| `http://user:secret@proxy.example:3128` | `http://user:secret@proxy.example:3128/` (userinfo kept) |
| `http://` | `http:/` |
| `http:proxy.example:3128` | `http:/proxy.example%3A3128` |
| `HTTP://proxy.example:3128` | unchanged |
| `ftp://proxy.example:3128` | unchanged |
| `proxy.example:3128` | unchanged (the "scheme" is the host) |
| `` (empty) | `` (unchanged) |
| `http://User:PassWord@proxy.example:3128` | `http://User:PassWord@proxy.example:3128/` (user info keeps its case; only the host is lower-cased) |
| `http://proxy.example/a!b'c(d)e*f` | `http://proxy.example/a%21b%27c%28d%29e%2Af` |
| `http://proxy.example/😀` | `http://proxy.example/%F0%9F%98%80` (a character outside the BMP is one encoded pair, never a throw) |
| `http://proxy.example/%zz` | `http://proxy.example/%25zz` (a run that does not decode is kept, then its `%` encoded) |
| `http://proxy.example/%FF` | `http://proxy.example/%25FF` |
| `http://proxy.example/C:/dir` | `http://proxy.example/c%3A/dir` (the drive-letter rule) |

Add one row per branch of the parser the worker writes (query, fragment, missing port) so every branch is covered.

## 4. Rule for the worker

As card log-01; names of four characters or more; the ratchet may only rise; no comment beyond what the guide
requires (the `[oss]` pointer goes in the PR body, not in the code).

## 5. Gates and review

PR title `lib-server: proxyVariableText (card server-10)`; answers R1–R6.

## 6. Open rows

None.
