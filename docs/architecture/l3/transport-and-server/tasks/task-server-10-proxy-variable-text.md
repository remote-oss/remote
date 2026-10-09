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

The scheme is the text before the first `:`. When it is exactly `http` or `https` (lower case), parse the rest as
scheme, optional `//authority` (userinfo, host, port), path, `?query`, `#fragment` with the semantics of
`[oss] src/vs/base/common/uri.ts` (`URI.parse` then `toString()`), and return the serialisation. Otherwise return the
input unchanged.

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

Add one row per branch of the parser the worker writes (query, fragment, missing port) so every branch is covered.

## 4. Rule for the worker

As card log-01; names of four characters or more; the ratchet may only rise; no comment beyond what the guide
requires (the `[oss]` pointer goes in the PR body, not in the code).

## 5. Gates and review

PR title `lib-server: proxyVariableText (card server-10)`; answers R1–R6.

## 6. Open rows

None.
