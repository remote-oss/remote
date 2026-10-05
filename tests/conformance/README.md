# Conformance

The conformance suites are the acceptance tests of this repository: a feature is done when its cases pass in the
runner against our build. The cases are recorded against the reference by the specification side and are never
edited here. A case that looks wrong is a question on its spec issue.

## Where things are (proposal)

| Thing | Now | After the move |
|---|---|---|
| Cases, fixtures, `COVERAGE.md` | `remote-oss/remote-<x>`, `tests/conformance/` | `packages/remote-<x>/tests/conformance/` |
| Runner | a copy in each `remote-oss/remote-<x>` under `tests/conformance/runner/` | one copy here, `tests/conformance/runner/` |

One runner for all packages is the reason for the monorepo. Until the move, CI checks out the suite of the package
under test from its repo at a pinned commit and runs it with the runner here.

## Open

- Which copy of the runner is the source, and who maintains it after the move (the kit's owner or this repository).
- The environment profiles CI can provide (Linux containers first; Windows and macOS need hosts).
- How a build under test is installed into a profile (`under-test` in the cases).
