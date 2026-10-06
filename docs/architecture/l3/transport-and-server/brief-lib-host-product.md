# Coding brief: lib-host and lib-product (first coding target from area A)

Status: draft by `remote-architect-worker-1` for `remote-architect`, 2026-10-06, to be reviewed and issued to a
coding worker.
- Design: `components.md` (H1, P1 to P4) and `contracts.md` §1 and §2.
- ADRs: 0002, 0003, 0006 as revised on 2026-10-06, and the draft "Host channel".
- Both libraries are pure TypeScript with no `vscode` import and no process, network or file access. They are
  tested with Mocha alone, before any transport or resolver exists.

## What is built

| Piece | Where | Content |
|---|---|---|
| `lib-host` | `packages/lib-host` | The host-channel interface (`runScript`, `copyToHost`, `identity`, `platformHint`) and its closed failure kinds (`channelClosed`, `spawnFailed`, `copyToolMissing`, `copyFailed`, `timeout`, `cancelled`), each carrying the original message as detail |
| Recording fake | `packages/lib-host`, exported for tests | Replays scripted answers matched by interpreter and a script predicate, records every call in order, can fail any call with any kind, and honours cancellation |
| Channel contract tests | `packages/lib-host`, exported for tests | One shared suite that every implementation runs later (ssh, `docker exec`, `wsl.exe`): failure-kind mapping, cancellation, no retry, output order. It runs on the fake now |
| `lib-product` profile | `packages/lib-product` | `readProfile(productJsonText)` returns the profile of `contracts.md` P1, or `unreadable` |
| Expander | `packages/lib-product` | `expand(template, values, allowedNames)` per P2 |
| Resolver | `packages/lib-product` | `resolveServerArchive(profile, hostTokens, policy, override)` per P3. The override comes in as a value plus the settings layer it was read from; the caller's adapter reads settings, not this library |
| Policy table | `packages/lib-product` | One entry per extension: setting key, allowed layers, accepted forms, allowed placeholders. Rows: remote-ssh (F-3902 rules 1 to 3), remote-containers (F-1402 rule 4, base-URL form included), remote-wsl (pending; a test pins that it is absent) |
| Product table | `packages/lib-product`, one file | The built-in entries `codium` and `codium-insiders` (F-3902 rule 1(c), F-1402); the licence hosts of F-3902 rule 11(i); the VSCodium release prefixes of rule 11(ii); the licence rules (below). The dev tunnels domain is left out until the Tunnels ruling |
| Licence rules as data | `packages/lib-product` | `classifyLicence(facts, activeRules)`, where facts are the step, the URL host, whether the client's `serverLicense` is empty, and whether this is a reuse. Two rule entries: `clientLicence` (F-1402 rule 5) and `sourceBased` (F-3902 rule 11 (i) to (iii)). The active set is `[clientLicence, sourceBased]` with "any" until K5 is ruled. K5 then changes one table line. The acceptance store and the modal stay in lib-server (V6) |
| Literal check | `tools/` (the lead names where) | ADR-0006 Check: product names, Microsoft hosts and VSCodium prefixes may appear only in the product-table file and its tests |

## Behaviour to get right (each a named unit test)

- **Resolution order** (F-3902 rule 1, F-1402 rule 4). Override, then product template, then built-in table, then
  `noSource`. "Set" means a value in an allowed layer, never "differs from a default". A remote-ssh value from a
  workspace layer is ignored (F-3902.AC-17). A containers value from any layer counts.
- **No VS Code entry.** `code` and `code-insiders` with no override and no template give `noSource`
  (ADR-0006 decision 2, F-3902.AC-8).
- **Placeholders** (F-3902 rule 3, ADR-0006 as revised):
  - all six names expand, and `${release}` is empty when the product has none;
  - `${applicationName}` only where the policy allows it;
  - an unknown name in the override gives `invalidOverride` with the name;
  - an unknown name in the product template gives a `skipped` diagnostic and falls through;
  - a non-http(s) result is handled like an unknown name at the same step;
  - a value without placeholders is one URL for every host.
- **Containers base-URL form** (F-1402): a value without placeholders gets `/commit:{commit}/server-{platform}/{quality}`
  appended, with platform tokens `linux-x64`, `linux-arm64`, `linux-armhf`, `linux-alpine` and `alpine-arm64`.
- **Results, not UI.** `noSource` carries the `applicationName` and the setting key. `invalidOverride` carries the
  key and the problem. The extension packages render the dialogs of F-3902 rule 8 and F-1402.
- **Licence rules.** Every case of F-3902 rule 11 (i) to (iii) and F-3902.AC-10, AC-12, AC-14 and AC-15 is checked
  against `sourceBased`. F-1402 AC-1 to AC-5's classification is checked against `clientLicence`. The "any"
  combination has its own test.
- **Profile reading.** Missing optional fields give their documented empty values. A missing `serverDataFolderName`
  is not defaulted here; P1 reports it absent and the caller applies its spec's fallback (F-0503). Malformed JSON
  gives `unreadable`.

## Fixtures

Kept under `packages/lib-product/test/fixtures/`, each with a header naming its source:
- **`vscode-reduced.json`.** Only the fields F-3902 §3 states for VS Code 1.139.1: `applicationName` `code`,
  server names, `updateUrl`, a non-empty `serverLicense`, no template.
- **`vscodium-reduced.json`.** Only the fields F-3902 §3 states for VSCodium 1.135.06055: `codium`, `codium-server`,
  `.vscodium-server`, `codium-tunnel`, an empty `serverLicense`, and a template with `${os}` and `${arch}` only.
- **`synthetic.json`.** The ADR-0006 decision 6 fixture, with invented names in every field: `applicationName`
  `fixture-editor`, `serverApplicationName` `fixture-server`, `serverDataFolderName` `.fixture-server`,
  `tunnelApplicationName` `fixture-tunnel`, `urlProtocol` `fixture`. Its template uses all six placeholders, and it
  has a `release` field. A second variant has a non-empty `serverLicense`. A test proves that no result for it
  contains a product name from the table.

## Dependencies

- None. Both libraries have no `lib-log` edge: lib-product returns its one log-worthy event (a skipped template) as
  a diagnostic, and lib-host logs nothing. I propose dropping the two edges of the container view, as was done for
  B's libraries (question 1).
- The adapters (reading `<appRoot>/product.json` and the inspected setting scopes) belong to the consuming
  extensions' briefs, not this one.

## Done

- ADR-0003 gates green; every test named after the rule or AC it proves.
- The literal check fails on a planted product name outside the table file.
- No conformance case runs against these libraries alone. F-3902.AC-1 to AC-18 and F-1402 AC-1 to AC-5 prove them
  later through Remote-SSH and Dev Containers.
- The PR answers R1 to R6.

## Open before coding (through the lead)

1. Dropping the `lib-log` edges of `lib-host` and `lib-product`.
2. K5: nothing blocks. The active rule set is one table line.
3. Where the literal check lives: `tools/check-layout` or an ESLint `no-restricted-syntax` list.
