# Task card connect-61: the bootstrap reads the login shell's environment from a file only `export -p` writes

Issue: #834. Release 0.2, **gating** (ADR-0010 rule 1, "what our own command prints after a marker into a file only
it writes"; audit connect-59 #832, row P4). Size: S. Builder: `task:claude` (lib-ssh, a shell script with real-shell
rows).

## 1. The defect

`lib-ssh/src/connection-server/session-bootstrap.ts` writes the login shell's command to `$LAYER1_DIR/in`. The command
is `exec sh -c "echo LAYER1-START; export -p" </dev/null`. It runs `"$SHELL" -l <in >"$LAYER1_DIR/out"`. Then:

```sh
if grep -q '^LAYER1-START$' "$LAYER1_DIR/out"; then
  eval "$(sed -n '/^LAYER1-START$/,$p' "$LAYER1_DIR/out" | sed 1d)"
```

The login shell's startup files write their stdout into the **same** file. So a startup file that prints a line
`LAYER1-START` gets everything it prints after that line `eval`'d.

**Measured** on `alpine:3.22`, with `SHELL=/bin/sh` and the prelude run as the shared session runs it
(`sh -c 'eval "$(dd bs=1 count=N)"'`):

| `.profile` | Outcome |
|---|---|
| `echo "ERROR: Your fridge is not running"; echo "ERROR: fridge" >&2` | `LAYER1-READY`, and the session goes on (conforms) |
| `echo LAYER1-START; echo "exit 3"` | no `LAYER1-READY`; the session ends with status 3 |
| `echo LAYER1-START; echo "ERROR: Your fridge…"` | `eval: ERROR:: not found` on stderr. The real `LAYER1-START` is also `eval`'d (`LAYER1-START: not found`) |

## 2. The fix

**The environment goes to a file only `export -p` writes.** The login shell's command becomes:

```sh
exec sh -c 'export -p >"$1.part" && mv "$1.part" "$1"' sh "$LAYER1_DIR/env"
```

written into `$LAYER1_DIR/in` with its quoting kept: build the line with `posixQuote` in TypeScript.
- The startup files' stdout still goes to `$LAYER1_DIR/out`, which nothing reads any more; delete it with the folder.
- **The bootstrap's test** becomes `if [ -f "$LAYER1_DIR/env" ]; then eval "$(cat "$LAYER1_DIR/env")"`. The file
  exists only when `export -p` finished and `mv` ran.
- The `timeout` and `exited` branches stay as they are, with the same lines (`LAYER1-TIMEOUT`, `LAYER1-EXITED`).
- **`LAYER1-START` goes:** nothing prints or reads it now. Update the module's doc comment.

A background job a startup file starts inherits `out` as its stdout, never `env`, so it can't add to what is
`eval`'d. The process-group kill after the wait is unchanged.

## 3. Rows (`lib-ssh/test/unit/session-bootstrap.test.ts`, real `sh` in the existing style; the server suite's
`login-shells.test.ts` for the real host)

| Name | Given | Expected |
|---|---|---|
| `ADR-0010: a startup file that prints LAYER1-START is not evaluated` | `.profile`: `echo LAYER1-START; echo "exit 3"` | `LAYER1-READY`, and the session goes on (fails on main) |
| `ADR-0010: startup output around the environment changes nothing` | `.profile` printing N1–N5 (connect-59 §3) on stdout and stderr, and `export FOO=bar` | `LAYER1-READY`; a following run sees `FOO=bar` |
| `F-2704: the login shell's environment still arrives` | the existing environment rows | unchanged |
| `F-2704 AC-11: a startup that reads its input` | the existing row | `LAYER1-EXITED` as today (the `read` takes the exec line, so the shell ends without writing `env`) |

**Real host:** the acceptance `login-shells.test.ts` shells (bash, zsh, dash, fish, tcsh, mksh) still pass. Add a
`.profile` with the `LAYER1-START` and `exit 3` lines to one shell's account for one row.

## 4. Gates and review

Run all gates, shellcheck on the generated prelude, and `pnpm test:acceptance:server`. Use the PR title
`lib-ssh: the bootstrap reads the login shell's environment from a file only export -p writes (card connect-61,
#834)`. Request athena only.

## 5. Open rows (stop and report on #834)

1. A login shell (fish, tcsh) runs the `exec sh -c '…' sh <path>` line differently from the old one. Report the
   measured line.
