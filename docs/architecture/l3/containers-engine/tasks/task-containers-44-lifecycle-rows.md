# Task card containers-44: F-0415's lifecycle command rows and tags (containers release 1)

Issue: #1054. Milestone 0.4, containers release 1. Size: M–L (two PRs). Builder: `task:claude` (dike, after
containers-42, #1051). The method is containers-41's (#1050) §1, §3 and §6; this card gives only what is F-0415's
own.

**What this card is:** every F-0415 line of `docs/architecture/catalogue/coverage-containers-r1.tsv` that is `todo`
ends with a final tag, and every criterion this release builds gets the row that proves it, **except** the criteria
another open card owns:
- **containers-15** (#893, hestia): F-0415 AC-7, AC-8, AC-9 and AC-11 (the markers and the failure surfaces), and
  whatever else its rows cite when it merges. Don't write or tag those; re-read containers-15's PR before each of
  yours and leave every criterion it cites to it.
- containers-20 (#941), containers-38 (#1021) and containers-39 (#1027) are merged; their rows (AC-6, AC-33 to AC-38,
  AC-41, AC-36's typing half) are cited already. Cite them where they prove a criterion; don't duplicate them.

Sources: F-0415 (remote-oss/remote-containers#32), all of it; `brief-release-1.md` §2 (`initializeCommand` and the
five in-container hooks, the markers, `waitFor`; attach, volumes, shutdown and personalization later); ADR-0011 and
ADR-0012 (the lifecycle commands in a real terminal); cards containers-15, -20, -38 and -39.

## 1. How our decisions read F-0415 (no judgement left here)

1. **The runs and their terminal** are containers-20's and containers-39's: the "Configuring..." terminal, one echo
   per key (containers-38), a real terminal through the editor's node-pty (ADR-0011, ADR-0012).
2. **The markers** belong to containers-15: until it merges, a row of this card that needs a marker's path reads it
   from containers-15's card, and its PR waits for containers-15's merge.
3. **Later features:** a criterion that needs attach, a volume, Compose, the shutdown or personalization
   (dotfiles) is `deferred` with the cut's form, e.g. `containers release 1: later (attach)`.
4. **`waitFor`:** the window connects after the hook `waitFor` names (default `updateContentCommand`), and the later
   hooks run in the background in the "Configuring..." terminal. Rows assert the order with each hook writing a
   timestamped line to a file in the workspace, read back with `docker exec`.

## 2. PRs

(a) the order of the hooks, `waitFor` and the background runs; (b) the command forms (string, array, object of
parallel commands), the failures that containers-15 doesn't own, and the tags. Each PR moves only its own lines of
the coverage file. Folder names start `c44-`. PR titles: `tests: F-0415's <subject> rows (card containers-44, #1054)`.
Request athena only; hermes assigns the peer.

## 3. Gates and open rows

As containers-41 §5 and §6, and one more: a criterion that containers-15 and this card could both claim is
containers-15's; post it on the issue if you're unsure.
