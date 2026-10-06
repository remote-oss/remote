# ADR-NNNN: One licence gate for every server install, with the "Microsoft-licensed" test as data

- Status: proposed (draft by `remote-architect-worker-1` for the lead, who assigns the number). The active rule is
  K5 in the register.
- Date: 2026-10-06
- Deciders: the user through the register (K5) for the test; the lead for the gate's shape
- Scope: `lib-product` (the rules and `classifyLicence`), `lib-server` (V6: store and modal), every package that
  installs or starts a server: remote-ssh, remote-containers, remote-wsl, remote-server where it applies
- Requirements:
  - R-68 and its amendment of 2026-10-04;
  - remote-containers F-1402 rule 5 and AC-1 to AC-5, F-0503;
  - remote-ssh F-3902 rule 11 and AC-10 to AC-15;
  - ADR-0006 as revised.

## Context

R-68 says the family never accepts a third party's server terms for the user. Before a Microsoft-licensed server is
installed or started, a modal asks once per profile. Two specs define "Microsoft-licensed" differently:

- **F-1402 rule 5 (`clientLicence`).** The test is the running client's `product.json` `serverLicense` being
  non-empty. It is asked before a download or copy, and before starting a server already in the shared volume.
- **F-3902 rule 11 (`sourceBased`).** The test is the server's source:
  - (i) the URL's host is one of Microsoft's update hosts or the host of the client's `updateUrl`;
  - (ii) a user-set URL on a client with a non-empty `serverLicense`, unless it is a VSCodium release URL;
  - (iii) reuse of an installed server on a client with a non-empty `serverLicense`.

The two disagree in two cases:

| Case | clientLicence | sourceBased | What the acceptance criteria require |
|---|---|---|---|
| Genuine VS Code, user URL naming a VSCodium release | asks | does not ask | no dialog (F-3902.AC-15) |
| VSCodium client, user URL naming Microsoft's update service | does not ask | asks | dialog linking the Microsoft terms (F-3902.AC-14) |

Checked against every licence acceptance criterion of both specs:

| Rule set | F-1402 AC-1 to AC-5 | F-3902 AC-10 to AC-15 |
|---|---|---|
| `clientLicence` | all pass | fails AC-14 and AC-15 |
| `sourceBased` | all pass: AC-1 by (i), AC-4 free, AC-5 by (iii) | all pass |
| either (`any`), as provisionally accepted | all pass | fails AC-15 |

## Decision

1. **Data, not code.** "Microsoft-licensed" is decided by `lib-product`'s `classifyLicence(facts, activeRules)`.
   - The facts are: the resolution step, the URL's host and prefix, whether the client's `serverLicense` is empty,
     whether this is a reuse, and the terms URL.
   - The rules are entries in the product table: `clientLicence` and `sourceBased`, with their host and prefix lists.
   - The active set is one table line, so K5 lands as a one-line change.
2. **The recommended active set is `sourceBased` alone.** It is the only set that passes every acceptance criterion
   of both specs. Until K5 is ruled, the table carries the set the lead accepted provisionally (`any`), and the
   known failure of F-3902.AC-15 is recorded against it.
3. **One gate.** `lib-server`'s V6 is the one gate. It is asked before any download or copy (cases i and ii) and
   before any start of a reused server (case iii; F-1402 AC-5). It shows the modal through its UI port: own wording,
   the terms link, and "Accept and Continue" or "Cancel".
   - An acceptance is stored in per-profile global state under a key derived from the terms URL. It is not synced
     and never reset by the family.
   - Cancel ends the connect with nothing downloaded, copied, started or remembered (F-1402 AC-2, F-3902.AC-12).
   - After acceptance the server starts with `--accept-server-license-terms`.
4. **The terms link.** It is the client's `serverLicenseUrl` when its `serverLicense` is non-empty. Otherwise it is
   the Microsoft terms page that F-3902 rule 11 names, and that URL lives in the product table.

## Options considered

| Option | For | Against |
|---|---|---|
| `sourceBased` as data (recommended) | Passes all eleven acceptance criteria; decides by what is actually installed | Needs host and prefix lists kept current in the product table |
| `clientLicence` | Simplest fact | Fails F-3902.AC-14 (a Microsoft server on VSCodium goes unasked, against R-68's intent) and AC-15 |
| `any` (provisional) | Never misses a Microsoft server | Fails F-3902.AC-15: asks for a MIT server on genuine VS Code |
| A rule per extension | Each spec passes as written | Two behaviours in one family for the same server, against R-47's "siblings do not diverge" |
| The test in code per package | None | Three copies; K5 would be a code change in three places |

## Consequences

- K5's ruling is one data line plus, if `sourceBased` wins, a wording revision of F-1402 rule 5 through the
  containers room. No containers acceptance criterion changes.
- The product table gains the licence host list, the VSCodium release prefixes and the Microsoft terms URL. The
  ADR-0006 literal check covers them.
- Every server-installing package gets the same modal, store and cancel semantics from V6.

## Check

- Unit tests of `classifyLicence` per rule against every case above.
- The conformance cases F-1402 AC-1 to AC-5 and F-3902.AC-10 to AC-15 on the active set.
- A test that pins the active set to the table line K5 names.
