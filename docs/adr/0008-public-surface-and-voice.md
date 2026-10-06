# ADR-0008: The public surface speaks as a product and carries nothing of the process

- Status: accepted (the user, 2026-10-06, D-59; the repository rule R-85 by `remote-development`)
- Date: 2026-10-06
- Deciders: the user (D-59); `remote-development` (R-85); enforcement designed by `remote-architect`
- Scope: every package, every shipped file, and the repository at the moment it becomes public
- Requirements: D-41 (display names verbatim; description, icon, README and listing ours), D-59, R-85, R-29 (UI
  strings reused verbatim), ADR-0003 (comments only where the guide requires them)

## Context

The family is designed from published specifications and built in sessions whose records, ids and vocabulary
(decision numbers, feature ids, rooms, workers, the reference) are useful inside the project and meaningless or
harmful outside it. The user decided that everything reaching the public presents the family as its own product:
"extensions that give Code - OSS and its derivatives remote development", never as a clean-room reimplementation of
another vendor's extensions, and that nothing of the process, the methodology, the sessions or the conversations
leaks. The repository is private while this is built; it becomes public with the first release.

## Decision

1. **Shipped prose is product prose.** READMEs, package descriptions, `package.nls*` and `l10n` strings,
   CHANGELOGs, documentation, code comments and JSDoc describe what the software does and how to use it. They never
   mention the reference extensions, Microsoft's extensions, a reimplementation, a clean room, a specification
   issue, a room, a session, a worker, a lab, or an internal id (`D-xx`, `R-xx`, `F-xxxx`). Test names may keep
   `F-` ids, because tests do not ship; shipped data files (`identifiers.json` is not shipped; anything that is
   carries no spec pointer).
2. **The identity card is the only source of public identity text**: display names verbatim (D-41), descriptions
   in our own words of the quality of good marketing copy, keywords, links, and one family icon designed from the
   `>_` / `$_` prompt marks. Interim values stand until the user approves the card; a verbatim-overlap check against
   the reference's listing copy runs below the wall before any copy ships.
3. **Code names what things are, not where they came from.** A field that names the extension a package stands
   down for is `standsDownFor`, never `reference`; a comment explains an invariant, never a provenance.
4. **The repository stays private through development.** Before publication, the architecture documents, the
   catalogue, the binding rulings, the traceability matrices and every ADR passage that discusses the reference move
   to a private repository (`remote-oss/remote-architecture`) or are stripped; the published history starts clean
   (a fresh initial commit or a rewritten history, decided at that time by the user).
5. **A public-surface lint** runs in CI over every shipped prose surface and over code comments: it fails on the
   forbidden framing words and on internal ids in prose, with one allow-list for code and data that must name
   products (`lib-product`'s table, licence hosts) and for third-party licence texts (`ThirdPartyNotices`). The
   grep of the first review (reference, Microsoft, ms-vscode, clean-room, reimplement, spec, F-/R-/D- ids,
   session, worker, lab, dirty, orchestrat) is its starting list.
6. **Trademark and third-party notices** live in `NOTICE` or `ThirdPartyNotices.txt`, never in a README; whether a
   trademark notice is wanted at all is the user's (open, 2026-10-06).

## Options considered

| Option | For | Against |
|---|---|---|
| Product voice everywhere, lint-enforced, private until release (chosen) | One rule, checkable; nothing to clean up at release except the move of the design documents | The lint needs an allow-list; some precision in comments is lost (no issue pointers) |
| Disclose the method in the README | Transparency | The user decided against; it frames the product by another vendor's |
| Public repository from the start | Early visibility | Every design document and ruling would be public; the move would be a rewrite instead of a split |

## Consequences

- The remote-ssh-edit package (PR #21) is the model: its README, strings, grammar comments and JSDoc were rewritten
  to this rule before merge.
- Every coding brief states the voice rule; every review greps the shipped surfaces; the lint replaces the manual
  grep as soon as a coding worker builds it (next tooling PR).
- `identifiers.json` keeps its `source` field (a spec pointer) because `.vscodeignore` excludes it; the lint checks
  that it never reaches a VSIX.
- The design documents keep their vocabulary; they are private and move out before release (decision 4).

## Check

CI: the public-surface lint over `packages/*/README.md`, `package.json` descriptions and keywords, `package.nls*.json`,
`l10n/*.json`, `CHANGELOG*`, `syntaxes/*`, `language-configuration.json` and all non-test source comments; a VSIX
content check that no `identifiers.json`, test, fixture or coverage file ships. Release: the move of
`docs/architecture`, `docs/adr` passages and the catalogue to the private repository, verified by the same lint run
over the whole public tree.
