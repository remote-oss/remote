# Task card tooling-08: `os` as an imposed property key (follow-up of #271)

Why: athena's design check of #271 (card ssh-08): the key `os` is imposed by external formats, so it belongs in
`IMPOSED_PROPERTY_KEYS` in `eslint.config.ts` (ADR-0003; D-74: allowlisted, not worked around), and then
`cliArchiveTemplateVariables` can be a plain object literal. The key is imposed twice: as the editor CLI download
template's `os` variable (VSCodium's `cliDownloadUrlTemplate`), and as the `host.os` fact of the server's result block.
The second has so far been worked around with two `eslint-disable-next-line id-length` comments, which the allowlist
entry makes unused. `arch` is four characters long and passes `id-length` already; it is not listed (a dead entry).
Reviewing coder: `remote-coding-worker-1`.

Base: main **after PR #271 (card ssh-08) has merged**; if `packages/lib-server/src/cli-path/decision.ts` is absent,
stop and report.

## 1. File boundary

| File | Change |
|---|---|
| `eslint.config.ts` | append one entry to `IMPOSED_PROPERTY_KEYS`, after `'read'`, with its comment (section 2) |
| `packages/lib-server/src/cli-path/decision.ts` | `cliArchiveTemplateVariables` returns an object literal (section 2) |
| `packages/lib-server/test/unit/result-block.test.ts` | delete the two lines `// eslint-disable-next-line id-length -- the host fact key is the table's word` (above `hostFacts: {os: 'linux', arch: 'x64'}` and above `deepStrictEqual(blockOf('duplicate-host').hostFacts, {os: 'alpine'})`) |

Nothing else. The two `id-length` directives in `packages/lib-authority/test/unit/gate-vscode-setup.test.ts` guard
the key `all`, not `os`: leave them.

## 2. Contract

`eslint.config.ts`, after the `'read'` entry:

```ts
  // The server's result block (its `host.os` fact) and the editor CLI's download template (its `os` variable).
  'os',
```

`decision.ts`, the body of `cliArchiveTemplateVariables` (signature, JSDoc and result unchanged):

```ts
  return {
    os: host.operatingSystem,
    arch: host.architecture,
    commit: profile.commit,
    quality: profile.quality,
    version: profile.version,
    release: profile.version,
  };
```

## 3. Test table

No new test: the change is in lint configuration and in the form of one expression whose result is unchanged.

| Check | Expected |
|---|---|
| `pnpm lint` | 0 errors and 0 warnings; in particular no "Unused eslint-disable directive" |
| the existing `cli-*` tests of lib-server | pass unchanged (13 on #271's head) |
| `pnpm typecheck`, `pnpm format:check`, `pnpm test:unit`, `pnpm coverage` | green |

Checked on a clean build of #271 merged with main (2026-10-12): with the entry and the literal, lint reported exactly
the two unused directives above and nothing else; the cli tests passed. Run `pnpm typecheck` on a clean tree (no
leftover `.tsc` folders) before `pnpm lint`, since typed lint reads the emitted declarations.

## 4. Rule for the worker

As card log-01. No other entry in `IMPOSED_PROPERTY_KEYS` changes; no other `eslint-disable` comment is touched.

## 5. Gates and review

PR title `tooling: os as an imposed property key (card tooling-08, #271)`; answers R1–R6.

## 6. Open rows

None.
