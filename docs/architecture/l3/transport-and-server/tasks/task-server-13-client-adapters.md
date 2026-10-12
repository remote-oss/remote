# Task card server-13: the client adapters the server steps need (#140 part C)

Why: `createServerSteps` (remote-ssh, on main) needs real ports that exist today only in tests or nowhere. Part C of
the #140 plan. The download and client-file ports and the host lock loop exist in `tests/acceptance/server/` and move
into the packages; the licence modal and the acceptance store are new. Implementer: `iris` (judgement card).
Reviewers: `themis`; runtime review `daedalus`; design check `athena`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-server/src/transfer/node-download.ts` | new: `fetchDownloadPort` and `nodeClientFiles`, moved from `tests/acceptance/server/real-download.ts` |
| `packages/lib-server/src/transfer/lock-loop.ts` | new: `hostLockLoopOf(clock, attempts, intervalMilliseconds)`, the host lock loop over lib-server's `hostLockLoop`, moved from `tests/acceptance/server/support.ts` `lockLoop` |
| `packages/lib-server/src/index.ts` | export lines |
| `packages/lib-server/test/unit/node-download.test.ts`, `lock-loop.test.ts`, `network-rule.test.ts` | new |
| `tests/acceptance/server/real-download.ts` | deleted; its importers import from `lib-server` |
| `tests/acceptance/server/support.ts` | `lockLoop` calls `hostLockLoopOf` with its short test waits (no copy of the loop) |
| `packages/remote-ssh/src/surfaces/licence-modal.ts` | new: `licenceModalOf` |
| `packages/remote-ssh/src/surfaces/acceptance-store.ts` | new: `acceptanceStoreOf` |
| `packages/remote-ssh/l10n/` (all 15 bundles) | the licence dialog's provisional keys (section 2) |
| `packages/remote-ssh/test/unit/licence-modal.test.ts`, `acceptance-store.test.ts` | new |

Nothing else. #140's note: "When this issue's download adapter is written, it moves into the package and the test
imports it."

## 2. Contract

### Download and client files (lib-server)

The behaviour is unchanged from the moved code (redirects at most 10, each through `request.allowedHosts`, a refused
host is a failure with its text, the body streamed to the file, the bounds of the request). It uses the global `fetch`
and nothing else for the network: **no agent, no proxy setting read** (contracts §5 "Network rule for every client-side
HTTP request": the extension host's patched `fetch` under `http.proxySupport` applies the editor's proxy). The header
comment loses "for the tests only" and its proxy sentence, which the network rule now covers.

`network-rule.test.ts` is the test that rule asks for: it reads every `.ts` file under `packages/*/src` and fails
when one imports `node:http`, `node:https`, `undici`, `http-proxy-agent`, `https-proxy-agent` or `proxy-agent`, or
names `http.proxy`, `HTTP_PROXY`, `HTTPS_PROXY` or `NO_PROXY`. It passes on main plus this card.

### Host lock loop (lib-server)

`hostLockLoopOf(clock: {now(): number; wait(milliseconds: number): Promise<void>}, attempts: number,
intervalMilliseconds: number): HostLockLoop`: the body of `support.ts`'s `lockLoop`, with the clock passed in instead
of `REAL_CLOCK`. The extension passes the real clock and the policy's attempts and interval; the tests pass short ones.

### Licence modal (remote-ssh), F-3902 rule 11

```ts
export interface LicenceDialogPort {
  /** A modal warning with the detail and the buttons; resolves with the chosen button, or undefined (Escape, X). */
  showModal(message: string, detail: string, buttons: readonly string[]): PromiseLike<string | undefined>;
}
export function licenceModalOf(dialog: LicenceDialogPort, translate: Translate, names: {applicationName: string; displayName: string}): LicenceModal;
```

`askUser(termsUrl, cancellation)`: when `cancellation` is already aborted, `'cancel'` without showing. Otherwise it
shows the modal and gives `'accept'` only for the "Accept and Continue" button, else `'cancel'` (Cancel, Escape, X,
F-3902 rule 11). An abort while the modal is open gives `'cancel'` at once (the modal may stay; the gate stops).

Texts, provisional keys until remote-oss/remote-ssh#89 answers (the message and the labels are ours, R-68):
- message: `{0} needs you to accept the license terms of the {1} server before installing it.`, where {0} is the
  extension's display name and {1} the client's `applicationName` (the server named by the editor it serves, as in
  rule 8's dialogs; the licensor is never named, the terms URL tells the user; ADR-0008, D-59; worded by athena
  2026-10-12);
- detail: `Read the terms at {0}.`, where {0} is `termsUrl` (a modal has no inline link; #89 question 3);
- buttons: `Accept and Continue`, then S015 `Cancel`.

### Acceptance store (remote-ssh), F-3902 rule 11

```ts
export function acceptanceStoreOf(state: {get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void>}): AcceptanceStore;
```

`isAccepted(key)` is true only when the stored value is exactly `true`; `accept(key)` stores `true`. The extension
passes its `globalState`: per profile, never synced (no `setKeysForSync`). The key is lib-server's `acceptanceKey`.

## 3. Test table

| Cite | Given | Expected |
|---|---|---|
| contracts §5 V4 | the moved `fetchDownloadPort` and `nodeClientFiles` | their existing acceptance tests pass, importing from `lib-server` |
| contracts §5 network rule | `network-rule.test.ts` on the tree | passes; a fixture file importing `node:https` fails it |
| V5 | `hostLockLoopOf` with a fake clock, a step busy twice then a result | three attempts, two waits of the interval, the result |
| V5 | `hostLockLoopOf` with every attempt busy | the loop's lock-timeout outcome after `attempts` |
| F-3902 rule 11 | `askUser` with the user choosing Accept and Continue | `'accept'` |
| F-3902 rule 11 | Cancel / Escape (undefined) | `'cancel'` / `'cancel'` |
| F-3902 rule 11 | an already-aborted signal | `'cancel'`, no modal shown |
| F-3902 rule 11 | aborted while the modal is open | `'cancel'` without waiting for it |
| F-3902 rule 11 | the modal's detail for `https://aka.ms/vscode-server-license` | `Read the terms at https://aka.ms/vscode-server-license.` |
| F-3902 rule 11 | the modal's message, display name `Remote - SSH`, application name `VSCodium` | `Remote - SSH needs you to accept the license terms of the VSCodium server before installing it.` |
| F-3902 rule 11 | store: nothing stored / `true` / `'yes'` | `false` / `true` / `false` |
| F-3902 rule 11 | `accept(key)` then `isAccepted(key)` | `true`, with `update(key, true)` called once |
| string tables | the new keys | `pnpm check-layout` green in all 15 bundles |

## 4. Rule for the worker

As card log-01; coverage at both packages' 100/100/100 ratchets. `node-download.ts` uses real `fs` and `fetch`: its
unit tests run against a local HTTP server on 127.0.0.1 (node:http in the **test** only, which the network-rule test
does not scan), as the acceptance tests do today.

## 5. Gates and review

PR title `lib-server, remote-ssh: the client adapters of the server steps (card server-13, #140 part C)`; Part of #140.

## 6. Open rows

- The licence dialog's wording waits on remote-oss/remote-ssh#89; the keys change when it answers.
