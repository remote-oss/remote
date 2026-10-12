# Task card server-16: an absolute socket folder that can't be used falls back too

Why: themis's note on #359 (card server-15, merged), ruled by athena in server-15's follow-up section. An absolute
`TMPDIR` without white space passes server-15's test even when it can't hold the socket: a folder that doesn't exist, a
path that is a file, or a folder the user can't write to. The socket path then points there, and the server's `listen`
fails the start. By server-15's ruling (an unusable `TMPDIR` falls back, it doesn't fail the connect), these fall back
to `/tmp` too. Reviewing coder: `remote-coding-worker-1`.

Not urgent: behind the terminal-mode chain.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-server/src/scripts/bootstrap.ts` | the `/*)` branch of the socket folder's `case` (section 2) |
| `packages/lib-server/test/unit/bootstrap-script.test.ts` | rows (section 3) |

Nothing else.

## 2. Contract

In the socket folder's `case` (server-15), the `/*)` branch becomes:

```sh
/*) if [ -d "$TMPDIR" ] && [ -w "$TMPDIR" ]; then
      SOCKET_FOLDER=$TMPDIR
    else
      SOCKET_FOLDER=/tmp; fact server.socketFolderFallback unusable
    fi ;;
```

The other branches and the unset case are unchanged. `[ -d ]` and `[ -w ]` are POSIX `test` (checked under dash:
a missing folder, a file and a read-only folder each fall back; a writable one is used).

**As root**, `[ -w ]` is true for any existing folder, read-only or not, because root can write there. That is
correct (root's socket would work), so the read-only row below only holds for a non-root run.

## 3. Test table

One assertion per `it`; the cite starts the name. Each row is a socket-mode start over the real shell (server-14's
`socket()` parameters), with `TMPDIR` set in the run's environment to a path the test prepares.

| Cite | `TMPDIR` | `server.socketPath` | `server.socketFolderFallback` |
|---|---|---|---|
| #359 (themis) | an absolute path that doesn't exist | starts with `/tmp/code-` | `unusable` |
| #359 | an absolute path that is a regular file | starts with `/tmp/code-` | `unusable` |
| #359 | an absolute folder with mode 555 (**skipped when the test runs as root**: `process.getuid?.() === 0`; the row says so in its name) | starts with `/tmp/code-` | `unusable` |
| F-2410 BR-4 | an absolute writable folder | starts with that folder | absent |

server-15's rows pass unchanged. The skipped row uses mocha's `this.skip()` inside the `it` when run as root, so it's
reported as pending, not passed, and the coverage of the `else` branch comes from the missing-folder and file rows.

## 4. Rule for the worker

As card log-01; coverage at lib-server's ratchet.

## 5. Gates and review

PR title `lib-server: an absolute socket folder that can't be used falls back too (card server-16)`.

## 6. Open rows

None. Ruled in server-15's follow-up section (athena).
