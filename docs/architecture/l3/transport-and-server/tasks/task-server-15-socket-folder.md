# Task card server-15: the socket's folder is always one the start can report (follow-up to server-14)

Why: themis's notes on #342 (card server-14, terminal mode T6). The socket path is `${TMPDIR:-/tmp}/code-<hex>`, and
the start reads it back from the server's ready line as **the first word** after `Extension host agent listening on`
(server-14 §2.1, a POSIX `sed`). Two `TMPDIR` values break that:
- a `TMPDIR` with a space (`/tmp/my dir`) reports `/tmp/my` (checked: the reader gives the cut path), so the window
  forwards to a socket that isn't there;
- a relative `TMPDIR` (`tmp`) reports a path the start's own `yes:/*` check refuses, so the start fails as
  `ServerFailedToStart`.

Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-server/src/scripts/bootstrap.ts` | the socket's folder (section 2) |
| `packages/lib-server/test/unit/bootstrap-script.test.ts` | rows (section 3) |

Nothing else.

## 2. Contract

The socket's folder is `$TMPDIR` only when it is an absolute path containing no white space; otherwise `/tmp`:

```sh
TAB=$(printf '\t')
NEWLINE='
'
if [ -z "${TMPDIR+set}" ]; then
  SOCKET_FOLDER=/tmp
else
  case $TMPDIR in
    '') SOCKET_FOLDER=/tmp; fact server.socketFolderFallback empty ;;
    *" "*|*"$TAB"*|*"$NEWLINE"*) SOCKET_FOLDER=/tmp; fact server.socketFolderFallback whiteSpace ;;
    /*) SOCKET_FOLDER=$TMPDIR ;;
    *) SOCKET_FOLDER=/tmp; fact server.socketFolderFallback relative ;;
  esac
fi
SOCKET_FILE="$SOCKET_FOLDER/code-$SOCKET_NAME"
```

**Not `[[:space:]]`:** dash (Debian's `/bin/sh`, which the script must run under, F-2703 BR-9) treats a bracket class
in a `case` pattern literally, so `/*[[:space:]]*` doesn't match `/tmp/my dir` there (checked: dash keeps the spaced
folder; bash in POSIX mode doesn't). The explicit space, tab and newline work in both. A newline would also break the
line-oriented ready reader.

(in place of `"${TMPDIR:-/tmp}/code-$SOCKET_NAME"`). F-2410 BR-4 puts the socket in the host's temporary folder; that
holds for every usable `TMPDIR`, and `/tmp` is the folder BR-4 observed on Linux. The ready reader is unchanged: with
the folder chosen this way, the first word is always the whole path.

**Ruled (athena, 2026-10-12): the fallback to `/tmp`.** F-2410 BR-4 observes `/tmp` on Linux and calls the `TMPDIR` behaviour inconclusive; following `TMPDIR` is our own choice (for macOS's per-user folder), so an unusable one has no spec standing to fail the connect. Failing would turn a harmless quirk of the user's remote environment into a broken connection. `/tmp` exists on every POSIX host we support (on macOS a link to `/private/tmp`). The script logs the fallback in its result block's facts (`server.socketFolderFallback=<why>`), so a user who wonders why the socket isn't in their `TMPDIR` can find it in the log. Rows: a `TMPDIR` with a space, a relative `TMPDIR` and an empty one each use `/tmp` and report the fallback fact; an absolute `TMPDIR` without white space is used with no fact. The explicit space, tab and newline in the `case` pattern (dash takes `[[:space:]]` literally, checked) is right.

## 3. Test table

One assertion per `it`; the cite starts the name. Each row is a socket-mode start (server-14's `socket()` parameters)
over the real shell, with `TMPDIR` set in the run's environment.

| Cite | `TMPDIR` | Expected `server.socketPath` | Expected `server.socketFolderFallback` |
|---|---|---|---|
| F-2410 BR-4 | a folder of the test, absolute, no space | starts with that folder | absent |
| #342 (themis) | an absolute folder with a space (created by the test) | starts with `/tmp/code-` | `whiteSpace` |
| #342 (themis) | `tmp` (relative) | starts with `/tmp/code-`, and the start is `Ok` | `relative` |
| F-2410 BR-4 | unset | starts with `/tmp/code-` | absent (the default, not a fallback) |
| F-2410 BR-4 | empty (set to `''`) | starts with `/tmp/code-` | `empty` |
| F-2703 BR-9 | an absolute folder with a space, the script run under **dash** | starts with `/tmp/code-` (the row that a `[[:space:]]` pattern would fail) | `whiteSpace` |
| #342 | an absolute folder with a tab | starts with `/tmp/code-` | `whiteSpace` |
| #342 | any of the above | the reported path is a socket the server listens on (the stand-in prints it back whole) |

## 4. Rule for the worker

As card log-01; coverage at lib-server's ratchet.

## 5. Gates and review

PR title `lib-server: the socket's folder is always one the start can report (card server-15)`.

## 6. Open rows

None. The fallback and its fact are ruled (section 2, athena). An unset `TMPDIR` takes `/tmp` as the default and
reports no fact; an empty, a relative and a white-space one fall back and report `empty`, `relative` and `whiteSpace`.
`${TMPDIR+set}` tells unset from empty under dash (checked).
