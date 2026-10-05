# Reading plan

Status: plan by `remote-architect`, 2026-10-05. Reading starts on `remote-development`'s word, when no feature issue
in the seven repos carries `spec:pending` (`tools/spec-watch --ack && grep -c spec:pending
docs/architecture/spec-baseline/*.tsv`).

## What there is to read (2026-10-05)

| Repo | Decisions | Features | Published | Pending | Conformance suite |
|---|---|---|---|---|---|
| remote-containers | 6 | 94 | 100 | 0 | yes |
| remote-ssh | 8 | 67 | 4 | 71 | no |
| remote-ssh-edit | 2 | 9 | 11 | 0 | yes |
| remote-explorer | 2 | 9 | 11 | 0 | no |
| remote-wsl | 1 | 28 | 1 | 28 | no |
| remote-server | 2 | 11 | 3 | 10 | no |
| remote-extensionpack | 1 | 5 | 3 | 3 | no |
| Total | 22 | 223 | 133 | 112 | |

Plus 49 epics and 7 tracking issues, which are maps and not requirements.

## Who reads what

The lead keeps its context for the design. It reads the cross-cutting material itself and gets everything else as
catalogue rows from readers (subagents, one workflow run per repo). A reader gets the clean-side rules of `AGENTS.md`,
a list of issue numbers and the row format. It returns rows and open questions, never spec prose.

| Step | Material | Reader | Result |
|---|---|---|---|
| 1 | The 7 tracking issues and 49 epics | one reader | A map: epic, its features, cross-repo citations |
| 2 | The 22 decision issues (identity, server download, proposed API, dependencies, telemetry, companion interfaces in remote-explorer F-5902 §5 and their provider counterparts) | the lead, in full | The constraints list that every later step is checked against |
| 3 | Feature specs, in the order below | one reader per epic, in parallel per repo | Catalogue rows |
| 4 | A second reader per repo, given only the rows and the issue list | adversary | Missing rows, features with two candidate components, citations that point nowhere |
| 5 | Conformance: `README.md`, `COVERAGE.md`, the runner's interface, the case schema; cases only by sample | one reader | What a build must expose to be testable; profiles CI needs |
| 6 | VS Code OSS and the extension API for the surfaces the rows name (resolvers, tunnels, remote views, `product.json` fields) | one reader per surface, on demand | Facts cited `[oss] path`, stable or proposed API |

Order for step 3: remote-explorer (the hub, with the companion interface), remote-ssh (the transport four extensions
share), remote-ssh-edit, remote-containers (the largest; by epic), remote-wsl, remote-server, remote-extensionpack.

## The catalogue row

One row per feature, in `catalogue.tsv`:

- feature id, issue, spec label, title
- surfaces it owns: commands, settings, views, menus, context keys, authorities (ids only)
- what it needs from outside: editor API (stable or proposed), local programs, network endpoints, files on the
  remote side
- what it needs from other features: ids it cites, in this repo and in others
- candidate component and candidate library, one each, or "undecided" with the reason
- open questions for the spec side

## When the reading is done

- Every published feature has a row, and the adversary's findings are closed or listed.
- The constraints list from step 2 is written and each constraint names the rows it binds.
- The lead can draw the context and container views from the rows alone and name the domain cuts for the workers.

After that, spec revisions arrive through `tools/spec-watch`: a changed issue goes to a reader, who returns the
changed row, and the lead acknowledges the baseline when the design has taken it in.
