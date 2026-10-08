# remote-ssh-edit 0.1.0: release smoke

| | |
|---|---|
| Commit | `remote-oss/remote` `bbee32f` (main; `packages/remote-ssh-edit` version 0.1.0) |
| VSIX | `remote-ssh-edit-0.1.0.vsix`, built in QA's own clone with `pnpm identifiers && pnpm build && pnpm package remote-ssh-edit`; sha256 `b7380b2f6c5a35e44428eac3b7da800c60416a2fb7cc183d02ae639c6bca2201`; id `remote-oss.remote-ssh-edit` |
| Suite | `remote-oss/remote-ssh-edit` `tests/conformance` at `e8a14f3` |
| Runner | this repository's `tests/conformance/runner`, `packages/remote-ssh-edit` identity and rules, `wait_scale` 2 |
| Profile | `linux-none-clean`, [linux-arm64], VS Code 1.139.1 |
| Slots | **1**, with no other editor on the display |
| Duration | 25 min (2026-10-08 12:20–12:45) |
| Model use | none |

## Cases

There are 30 cases covering all 9 features:

- three cases per feature that passed in the d88c960 runs, never a recorded exception;
- three completion cases that passed only at one slot in `../d88c960/rerun-1slot/`: F-4201-AC39-1, F-4202-AC1-2 and F-4203-AC14-2.

## Result

**30 of 30 pass.** The per-case results are in `summary.json`.
