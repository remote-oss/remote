# Rules for agents in this repository (clean side)

This repository holds the clean-room reimplementation of the VS Code remote extensions. Everyone who designs or writes
code here, human or agent, works on the **clean side** of the wall. These rules are short on purpose; they are not
negotiable inside a session. A question about them goes to the architecture lead (`remote-architect`), who takes it to
`remote-development`.

## What you may read

- The published spec issues in the seven repos `remote-oss/remote-<x>` (labels `spec:*`), their epics, tracking issues
  and decision issues.
- The conformance suites under `tests/conformance/` in those repos, and the runner.
- The family conventions and the rulings of the decision register that the architecture documents cite.
- The public VS Code extension API and the VS Code OSS source (MIT). Cite it as `[oss]` with a path.
- Public standards and documentation of third-party tools (OpenSSH, Docker, WSL, the dev container specification).

## What you never read, open or ask for

- The lab machines (proteus, janus, mnemosyne, lab2) and anything on them.
- Dirty-room folders and the `remote-oss/*-dirty` repos, in any clone.
- The reference extensions: their VSIX files, extracted files, installed extension folders, scripts and source maps.
  This includes a copy in your own editor's extensions folder.
- Lab transcripts, recordings, raw observations and screenshots.
- Third-party reimplementations of the same extensions, unless an ADR admits one as a source with its licence.

If such material reaches you by accident (a pasted log, a path in a message, a search result), stop, do not use it,
and report it to the lead. Do not paraphrase it into a design or into code.

## How you work

- Cite requirements by feature id and issue (`remote-oss/remote-ssh#F-2104`), never by memory of the reference's
  behavior. If the spec does not say it, the answer is a question on the spec issue, not a guess from experience
  with the reference.
- Identifiers that users see in manifests and files are reused verbatim from the specs (D-14). The identity is ours:
  publisher `remote-oss`, ids `remote-oss.remote-<x>`. No telemetry (R-28). No features beyond the specs (R-60).
- Every requirement maps to exactly one component, and every component has one owner (see
  `docs/architecture/`). A cross-cutting choice is an ADR in `docs/adr/` before it is code.
- "Done" for a feature means its conformance cases pass in the runner, not that the code looks right.
- Decisions that change scope, money, licensing or public identity are not ours: the lead sends them to
  `remote-development`.
