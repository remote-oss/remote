# Task card tooling-18: the progress record, the log switch, and a slow remote start (D-85)

Issue: #490. Why: D-85 (the user, on #142, with athena's addition). Three capabilities:
- **the progress record**, for F-2304 AC-1, 5, 6, 11, 29;
- **the log readable by the tests**: the README promises it under `REMOTE_OSS_ACCEPTANCE`, and nothing builds it yet.
  cli-05 and many log rows need it;
- **a slow remote start**, for F-2304 AC-8.

Builder: hestia. Size: M. **Depends on tooling-16 (#488)** (per-launch environment and the launch table).

## 1. Files

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts` | `progressFor`, `channelPortFor`, the wider record line (sections 2–3). This stays the only file that reads the switch |
| `packages/remote-ssh/src/extension.ts` | the resolver editor's progress and the log channel's port go through them |
| `packages/remote-ssh/test/unit/scripted-adapters.test.ts` | rows (section 6) |
| `tools/acceptance.ts`, `tools/acceptance-launches.ts` | `REMOTE_OSS_ACCEPTANCE_LOG` per launch; the `slow` launch (section 4) |
| `tests/acceptance/suite/harness.ts` | `connectionLog()` and `recordLines()` |
| `tests/acceptance/slow-remote/` | new: the slow extension (section 4) |
| `tests/acceptance/suite-slow/slow-start.test.ts`, `tests/acceptance/suite-remote/remote-window.test.ts` | the capability rows (section 5) |
| `tests/acceptance/README.md` | the log variable, the progress lines, the `slow` launch |

## 2. The progress record

`progressFor(environment, real: ProgressPort, recordFile?, files)` returns `real` unless the switch is on and the record
file is named. When they are, it returns a port whose `withProgress(request, task)`:
1. appends `{surface: 'progress', question: request.title, answer: 'shown', matched: true}`;
2. calls `real.withProgress(request, update => …)`. Each call of the task's `update(title, details)` appends
   `{surface: 'progress', question: title, answer: 'shown', matched: true, details}`, with `details` `true` or `false`
   as given, then passes the call on unchanged. F-2304 AC-1, AC-5 and AC-30 are about that flag;
3. resolves as `real` does. Nothing is appended at the end.

Display-only lines keep the four fields of cli-05's `downloadProgress` lines (athena), and a surface may add its own:
the title line has no `details`, a phase line has it. `RecordLine.surface` widens to
`ScriptEntry['surface'] | 'progress' | 'downloadProgress'`, and `RecordLine` gains an optional `details`. Lines are
appended in the order the calls happen, each as one append (section 3 of tooling-20).

In `extension.ts`, the resolver editor becomes `{...real, progress: progressFor(process.env, real.progress, …)}`, with
the same `files` as `adaptersFor`.

## 3. The log switch

`channelPortFor(environment, real: ChannelPort, files)` returns `real` unless the switch is on and
`REMOTE_OSS_ACCEPTANCE_LOG` is a non-empty path. When they are, each channel it creates appends every `appendLine`
text, plus `\n`, to that file, and passes it on to the real channel. It sees the lines after the logger's secret
masking, because it sits under the logger, as the output channel does. `extension.ts` opens the log channel over it.

The run sets `REMOTE_OSS_ACCEPTANCE_LOG` to `<runFolder>/<label>-log.txt` for each VSCodium launch, and to
`<runFolder>/log.txt` for the VS Code run (`HarnessVariables` gains it).

`suite/harness.ts` gains:
- `connectionLog(): string[]`, the lines of the file named by `REMOTE_OSS_ACCEPTANCE_LOG`, without their time stamps
  (the text after the first `] `);
- `recordLines(surface?: string)`, the record's lines, optionally of one surface.

## 4. The slow remote start

`tests/acceptance/slow-remote/` is a development extension of the workspace kind:
- `package.json`: `name` `acceptance-slow-remote`, `publisher` `remote-oss`, `extensionKind ["workspace"]`,
  `activationEvents ["*"]`, `main ./extension.cjs`, `engines.vscode ^1.139.0`;
- `src/extension.ts`: `activate()` writes `/tmp/acceptance-slow-started`, waits 15 000 ms, writes
  `/tmp/acceptance-slow-done`, then returns. It runs in the remote extension host, so the files are on the host;
- bundled by the same esbuild step as the suites into `extension.cjs`, which is git-ignored and removed by
  `removeBundles`.

The launch:

| Field | Value |
|---|---|
| `label` | `slow` |
| `runner` | `runner-remote` |
| `extraExtensions` | `['slow-remote']` (tooling-16's field) |
| `suite` | `suite-slow` |
| `folderUri` | `vscode-remote://ssh-remote+harness/home/harness` |

**First, measure** that a development extension of the workspace kind activates in the remote extension host of a
test-cli launch. `runner-remote` suggests it does. If it doesn't, install it on the host's server as a VSIX through the
run's `--install-extension` instead, and record which in the README.

## 5. Capability rows

| Suite | Name | Assertion |
|---|---|---|
| `suite-remote` | `D-85: the connect's progress is in the record, title first` | the first `progress` line's `question` starts with `Setting up SSH Host harness` |
| `suite-remote` | `D-85: the log the tests read holds the connect's lines` | `connectionLog()` has a line starting `Log level:` |
| `suite-slow` | `D-85: the remote extension host waited 15 s for the slow extension` | on the host, `stat -c %Y` of `/tmp/acceptance-slow-done` minus that of `/tmp/acceptance-slow-started` is at least 15 |

## 6. Unit rows (`scripted-adapters.test.ts`)

One assertion per `it`.

| Cite | Given | Expected |
|---|---|---|
| D-85 | switch off | `progressFor` returns the real port itself |
| D-85 | switch on, a task that updates `('A', true)` then `('B', false)` | the record's lines are the title (no `details`), `A` with `details: true`, `B` with `details: false`, each `answer: 'shown'`, `matched: true`, `surface: 'progress'` |
| D-85 | the same | the real port got both updates, in order, with their `details` |
| D-85 | the same | the result is the task's |
| D-85 | switch on, no record file | the real port itself |
| D-85 | switch off | `channelPortFor` returns the real port itself |
| D-85 | switch on, `REMOTE_OSS_ACCEPTANCE_LOG` set, two `appendLine` calls | the file holds both lines, in order, each with `\n` |
| D-85 | the same | the real channel got both lines |
| D-85 | switch on, `REMOTE_OSS_ACCEPTANCE_LOG` empty | the real port itself |

## 7. Gates and review

The repository's gates, remote-ssh at 100/100/100. The VSCodium run passes with the new rows; paste its summary. PR
title `tests: the progress record, the log switch and a slow remote start (card tooling-18, D-85)`. themis reviews the
switch: it must change nothing when `REMOTE_OSS_ACCEPTANCE` is unset.
