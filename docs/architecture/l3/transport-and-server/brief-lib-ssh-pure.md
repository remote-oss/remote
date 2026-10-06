> Issued by `remote-architect` 2026-10-06; queued for the next free coding worker. Settled: no `lib-log` edges;
> the ADR-0006 literal check lives in `tools/check-layout`; fixtures may be recorded with the worker's local OpenSSH
> against 127.0.0.1, `.invalid` and TEST-NET only, sanitized of any real host name, address or user; the four spec
> defaults are provisional and sent to the remote-ssh room.

# Coding brief: the pure parts of lib-ssh (second coding target from area A)

Status: draft by `remote-architect-worker-1` for `remote-architect`, 2026-10-06, to be reviewed and issued to a
coding worker.
- Design: `components.md` and `contracts.md` §3. The component ids are those of `components.md`:
  - S2 argument-builder;
  - S4 config-model (parser, writer, `ssh -G` reader);
  - S5 stderr-classifier;
  - S6 prompt-classifier;
  - S1 client-locator's decision part.
- ADRs: 0002, 0003, 0004.
- Nothing here spawns a process, opens a socket or touches the editor. File and process access go through ports
  that the tests fill from recorded fixtures, because CI has no `sshd`.

## What is built

| Piece | Where | Content |
|---|---|---|
| S2 | `packages/lib-ssh/src/arguments` | `validateTarget` and `buildInvocation` per contracts §3 |
| S4 | `packages/lib-ssh/src/config` | `filesInEffect`, `listHosts` over a file-reader port, `parseEffectiveOptions` (the text `ssh -G` prints), `parseAddHostCommand`, `writeHostBlock` |
| S5 | `packages/lib-ssh/src/diagnostics` | `classify(errorLines, exitStatus, purpose)` giving kind, reason and hints; the rules as one data table |
| S6 | `packages/lib-ssh/src/prompts` | `classifyPrompt(text, displayHost)` giving surface, placeholder or title, and the answer mapping |
| S1 decision | `packages/lib-ssh/src/client` | `candidates(settingValue, pathEntries, platform)`, `judge(exitStatus, output)` |

`lib-ssh` imports `lib-host` only for the S10 types later. This brief needs no import at all.

## Behaviour to get right (each a named unit test)

- **S2.**
  - Every argument rule of contracts §3: `-F` with `~/` expanded, `-T` by truthiness, `ConnectTimeout` only when the
    host sets none, `RemoteCommand=none` when the effective options carry one and the caller's
    `remoteCommandInEffect` is false, `-D`, `-L` port and `-L` socket.
  - The host and user as separate arguments.
  - `scp` with the same `-F`.
  - Rejection before any build: a leading `-`, and the characters of F-2205 BR-2 reported in BR-3's order, host part
    only.
  - A property test that no argument list contains a `ControlMaster`, `ControlPath`, `ControlPersist`, host-key,
    identity or proxy option the user did not configure (ADR-0004 decision 2).
- **S4.**
  - **File order.** The user file, then the system file and its includes, or the one configured file (F-2201 BR-4).
  - **Host list rules** (F-2202 BR-1 to BR-20). Wildcard and negated patterns are excluded. `Match host` values
    count as whole values. `Include` counts only at the top of a file or inside a bare `Host *` block. Relative
    includes resolve against `~/.ssh` for the user tree and against the configured file's folder otherwise. Globs
    expand in reverse code-point order, and `${HOME}` and `%d` stay unexpanded. Included hosts come after the
    file's own, breadth-first, without duplicates within one tree. Matching is case-sensitive.
  - **Performance.** A list of 4200 hosts within the time F-2202 states.
  - **`ssh -G` reader.** Lower-case keys, repeated keys such as `localforward`, and values with spaces.
  - **Add New SSH Host parser** (F-2204): the flag table of BR-5 and the four error texts verbatim.
  - **Writer** (F-2204 BR-10 to BR-17): the block goes before the first `Host` or `Match` and after the global
    lines, indentation is copied, and duplicate blocks are allowed.
- **S5.**
  - The network reasons of F-2603, with its substring and case rule and its priority when several lines match, each
    reason ending in one full stop (F-2603 Q4 default (b)).
  - The forwarding refusals of F-2604, S107 only in terminal mode (BR-6), and "Connection closed." as
    `channelClosed` (7.E1).
  - The broken pipe of F-2603 7.E3 as `brokenPipe`.
  - The timeout texts S137 and S140 of F-2105.
  - The changed-key refusal S111 of F-2305 BR-6, in shared mode only. `classify` takes the connection mode
    (`shared` or `terminal`) as an input.
  - The last "Permission denied (...)" line with its `user@host: ` prefix removed (F-2306 BR-13).
  - An unknown failure gives an empty reason, which B shows as S030.
  - A test that no hint or reason contains a line the classifier received from a prompt.
- **S6.** First match wins:
  1. the fingerprint pattern of F-2305 BR-2, with every matching and non-matching example the spec lists;
  2. the continuation lines;
  3. the passphrase question (placeholder STR:S064, {0} empty; F-2307 Q3 default);
  4. the password order of F-2306 BR-2, with every listed example;
  5. otherwise the raw text masked.

  The OpenSSH 10 colon form falls to the masked input (F-2305 Q2 default (a)).
- **S1.** The candidate order of F-2101 BR-1. Every accepted and rejected banner of BR-4 and BR-5. Empty output with
  exit status 0 is rejected (F-2101 Q2, recommended (b)).

## Fixtures

Kept under `packages/lib-ssh/test/fixtures/`. Each file has a header naming its origin: a spec issue section, or
"recorded" with the OpenSSH version and the command that produced it. Recording uses only the worker's own OpenSSH
client and local inputs. It never contacts a lab machine or reads reference material.

| Set | Content | Origin |
|---|---|---|
| `config/` | One folder per F-2202 rule and F-2204 placement case: the files of a tree, and the expected host list or written file | written from the spec rules |
| `effective/` | `ssh -G <alias>` output for the `config/` trees that set `ConnectTimeout`, `RemoteCommand`, `HostName`, `User`, `Port`, `LocalForward` | recorded; `ssh -G` makes no connection |
| `stderr/` | Error lines with exit status for: unresolvable name (`*.invalid`), refused port on 127.0.0.1, unreachable address, timeout (`ConnectTimeout=1` to a TEST-NET address), and `ProxyCommand` fakes that print the exact lines F-2603, F-2604, F-2105, F-2305 and F-2306 name and exit 255 (the method of F-2603's verification scenarios) | recorded, and spec texts |
| `prompts/` | Every prompt text of F-2305 BR-2, F-2306 BR-2 and F-2307 BR-3, with the expected surface | spec texts |
| `banners/` | The `-V` outputs of F-2101 BR-4 and BR-5 | spec texts, plus the worker's own `ssh -V` |
| `arguments/` | A table of settings snapshot and target to the expected argument list | written from contracts §3 |

## Dependencies

- Needs nothing from brief 1, and runs in parallel with it.
- Its string ids (STR:S0nn) come from the remote-ssh string table generated by B's identifier tooling. Until that
  table exists, S5 returns string ids, and a test pins the ids, not the texts.

## Done

- ADR-0003 gates green; every test named after the BR or AC it proves; fixtures reviewed by the lead for origin.
- No conformance case runs against these parts alone. They are proved later by F-2201, F-2202, F-2204, F-2205,
  F-2305 to F-2307, F-2603 and F-2604 through Remote-SSH.
- The PR answers R1 to R6.

## Open before coding (through the lead)

1. Spec defaults taken and flagged, each changed by a one-line rule edit if the room decides otherwise:
   - F-2101 Q2 (b);
   - F-2305 Q2 (a);
   - F-2307 Q3 (reproduce the empty {0});
   - F-2603 Q4 (b).
2. F-2202 BR-21 (the host match-back) is not in this brief. It waits for the answer to dossier question 5 (`ssh -G`
   or the spec's divergent rule).
3. Recording on the worker's own machine with its own OpenSSH: confirm this counts as a public-tool source under
   AGENTS.md.
