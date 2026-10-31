# The shapes of the commands our host-side scripts run

Every host-side script of ours (the server's probe, install, start, kill and clean-up, the login-shell bootstrap, the
container's volume, relay, machine-settings and `userEnvProbe` scripts, the agent link) runs on the user's SSH host or in
the user's dev container, on whatever coreutils it has: GNU, busybox, or Ubuntu 26.04's uutils (Rust) coreutils. This is the
audit of what they run, one line per distinct command shape, made on 2026-10-31 for card tooling-71 (#1380).

Each shape is run in `ubuntu:26.04` (uutils coreutils 0.10.0), `debian:bookworm-slim` (GNU) and `alpine:3.22` (busybox, the
host of our acceptance runs) by `tools/host-shapes/run.sh`, which runs `tools/host-shapes/shapes.sh` in each and prints what
differs. A new command shape in a script is added to `shapes.sh`, and a line to the table.

Marks: **same** (works and gives the same output on all three), **differs** (the status, the output or the text differs, and the
column says whether a script depends on it), **missing** (the command or an option is absent on one).

## Result

- No shape needs a different form. The shapes that differ differ in the **text of an error** the script passes on as a fact
  (`server.writeFailedError`, `LOCK_ERROR`), never one it parses; the path of the failure travels in its own fact
  (`server.writeFailedPath`). uutils words them without the path (`mkdir: Not a directory`, `ln: … Already exists`).
- The commands a script finds absent are all behind a `have` probe or a `/proc` read first: `ps` and `pkill` (debian slim),
  `wget`, `curl` and `unzip` (the ubuntu and debian base images), `ps -p` (busybox).
- The one code that depended on GNU's wording was a unit row of `volume-folders.test.ts` (fixed in #1376).
- In `ubuntu:26.04` these are uutils 0.10.0: `mkdir`, `ln`, `cat`, `cut`, `date`, `head`, `tail`, `tr`, `wc`, `ls`, `sleep`,
  `uname`, `id`, `base64`, `mktemp`, `od`, `dd`, `chmod`, `readlink` and `nohup`. These are not: `mv` and `rm` (GNU coreutils
  9.7), `sed` (4.9), `grep` (3.12), `tar` (1.35), `ps` (procps-ng 4.0.4), `flock` and `setsid` (util-linux 2.41.3), `getconf`,
  `wget` (1.25.0) and `curl` (8.18.0) once installed, and `sh` (dash); `kill` is the shell's builtin.

## Text our code matches against a host command's output

| Text | Where | Produced by | Checked |
|---|---|---|---|
| `error: 404` | posix-script.ts:213 | curl (`The requested URL returned error: 404`) | curl 8.18.0, 7.88.1 and 8.14.1 print it |
| `HTTP/1.[01] 404` | posix-script.ts:210 | GNU wget `-S` (`  HTTP/1.1 404 Not Found`), busybox wget (`server returned error: HTTP/1.1 404 Not Found`) | all three |
| `cannot expand ` | cli-path/cli-output.ts:23 | the editor's command-line program (Rust), not coreutils | not applicable |
| `Permission denied (`, `cannot listen to port: ` | lib-ssh diagnostics | OpenSSH's own lines | not applicable |
| `mkdir:` prefix of the write failure | volume-folders.test.ts | `mkdir` of each userland | all three start `mkdir: ` |

## The table

| Shape | Where | ubuntu:26.04 (uutils 0.10) | debian:bookworm-slim (GNU) | alpine:3.22 (busybox) | Mark |
|---|---|---|---|---|---|
| `printf '%s' "$2" \| tr '\n\r' '  '` | posix-script.ts:30 | same: `0000000 a b` | 〃 | 〃 | **same** |
| `date +%s`, `$(( ( $(date +%s) - n ) * 1000 ))` | posix-script.ts:51,54 | same: `1; 1` | 〃 | 〃 | **same** |
| `command -v tool` | posix-script.ts:48; remote-environment.ts:60 | same: `0` | 〃 | 〃 | **same** |
| `ln lock lock.target` (hard-link lock; busy = exit 1 and `.target` exists) | posix-script.ts:110 | ln: failed to create hard link 'lock1' => 'lock1.target': Already exists st=1 | ln: failed to create hard link 'lock1.target': File exists st=1 | ln: lock1.target: File exists st=1 | **differs** — the failure text only (uutils: `Already exists`, GNU: `File exists`, busybox: `lock1.target: File exists`); the script tests the exit status and `[ -e ]`, never the text |
| `exec 9>>f; flock -n 9` | posix-script.ts:127,129 | same: `first=0 second=1 ` | 〃 | 〃 | **same** — busy answers 1 with no text; the held-lock install answered `LockBusy` in all three, link and flock (run) |
| `true >>f` and `exec 9>>f` on an unopenable file | posix-script.ts:119,127 | 21: cannot create /proc/nosuch/x: Directory nonexistent st=0; 22: cannot create /tmp/w: Is a directory | 21: cannot create /proc/nosuch/x: Directory nonexistent st=0; 22: cannot create /tmp/w: Is a directory | can't create /proc/nosuch/x: nonexistent directory st=0; can't create /tmp/w: Is a directory | **differs** — the shell's own wording (dash, busybox ash); passed through as `writeFailedError`, not parsed |
| `sed -n 's/^Listening on 127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' \| head -n 1` | posix-script.ts:72 | same: `123` | 〃 | 〃 | **same** |
| `sed -n 's/^<ready> \([0-9][0-9]*\)$/\1/p' \| tail -n 1` (port; socket form) | bootstrap.ts:559,561 | same: `8080; /tmp/a.sock` | 〃 | 〃 | **same** |
| `grep -q '^…CVE…$'`, `grep -q '^--port: Could not find free port…'` | bootstrap.ts:565,568 | same: `0; 0` | 〃 | 〃 | **same** |
| `wget --help 2>&1 \</dev/null \| grep -i busybox` | posix-script.ts:183 | 1 | 1 | 0 | **missing** — no `wget` in the ubuntu and debian base images (the probe says `no`, and the script goes on to `curl`); busybox `wget` answers 0 |
| `wget -q -T n -O f url` (busybox); `wget --no-config -q -S -T n -O f url`; `wget -q -S …` (GNU) | posix-script.ts:194,196,198 | same (see note) | 〃 | 〃 | **same** — GNU Wget 1.25.0 (ubuntu 26.04) and 1.21.3 (debian): `-S` prints `  HTTP/1.1 404 Not Found`, exit 8; busybox: `wget: server returned error: HTTP/1.1 404 Not Found`, exit 1 (against a local nginx) |
| `curl [-q] -fsSL --max-time n -o f url` | posix-script.ts:202,204 | same (see note) | 〃 | 〃 | **same** — curl 8.18.0 / 7.88.1 / 8.14.1: `curl: (22) The requested URL returned error: 404`, exit 22 (the `error: 404` the script matches) |
| `grep -o 'HTTP/1\.[01] [0-9][0-9][0-9]' \| tail -n 1` | posix-script.ts:210 | same: `HTTP/1.0 200` | 〃 | 〃 | **same** — on the `-S` output above: `HTTP/1.1 404` |
| `tar -tzf f \| wc -l \| tr -d ' '` | posix-script.ts:240 | tar (GNU tar) | tar (GNU tar) | tar (busybox) | **same** — tar is GNU tar on ubuntu 26.04 (not uutils), busybox tar on alpine |
| `tar -xzvf f -C d 2>&1` (one line per entry) | posix-script.ts:243 | same: `top/ top/sub/ top/sub/f1 top/f2 top/.hidden code=0 ; 5 0; 0 st=0` | 〃 | 〃 | **same** |
| `unzip -q f -d d` | posix-script.ts:251 | same (see note) | 〃 | 〃 | **missing** — not in the ubuntu and debian base images; the probe reports `tool.unzip=no`, and a `zip` archive is only chosen for hosts that have it. Present in alpine (busybox) |
| `mkdir -p a b` | posix-script.ts:257 | same: `mp1/a/b mp2/c ; 0` | 〃 | 〃 | **same** |
| `for E in "$d"/* "$d"/.[!.]*` and `mv "$E" "$2"/` | posix-script.ts:276,279 | same: `out/top ; x; st=0` | 〃 | 〃 | **same** |
| `rm -rf`, `rm -f`, `rm -rf "${X:?}/y"` | posix-script.ts:256,263,299; bootstrap.ts:348 and others | same: `0; 0; 0` | 〃 | 〃 | **same** |
| `mv -f a.part a` | relay-script.ts:48; machine-settings.ts:89 | same: `n` | 〃 | 〃 | **same** |
| `readlink "$INSTALL_DIR"`, `ln -s tree link`, `[ -L ]` | posix-script.ts:294,307,308 | ln: failed to create symbolic link 'lnk': Already exists st=1 | ln: failed to create symbolic link 'lnk': File exists st=1 | ln: lnk: File exists st=1 | **differs** — the failure text of `ln -s` onto an existing link (`Already exists` / `File exists` / `lnk: File exists`); the script re-reads the link instead of parsing it |
| `tr '\0' ' ' \</proc/$1/cmdline`; `tr '\0' '\n' \| head -n 2`; `sed -n 1p` | posix-script.ts:336,360,361; bootstrap.ts:737,738 | same: ` s l e e p 3 0 ; sleep 30 ; sleep` | 〃 | 〃 | **same** |
| `ps -p $1 -o args=`; `ps -o pid= -o args= \| sed -n "s/^ *$1 //p"` (only when `/proc/$1/cmdline` is unreadable) | posix-script.ts:338,340 | sleep 30 ; sleep 30 | sh: 75: ps: not found ;  | ps: unrecognized option: p BusyBox v1.37.0 (2025-11-21 22:40:56 UTC) multi-call binary. ; sleep 30 | **differs** — ubuntu: both work; debian slim has no `ps` (procps absent), alpine busybox has no `-p` (the second form works). Both are fallbacks behind the `/proc` read |
| `pkill -P pid` (behind `have pkill`) | posix-script.ts:390,401 | same: `(not run)` | 〃 | 〃 | **missing** — absent in debian slim; guarded by `have pkill` |
| `kill -0 pid`, `kill pid` (shell builtins) | posix-script.ts:334,392; bootstrap.ts:471,636 | 0 pkill-P / have-pkill | 0 pkill-P / no-pkill | 0 pkill-P / have-pkill | **same** |
| `cut -c1-40`, `cut -c1-500`, `tail -n 1 \| cut -c1-300` | posix-script.ts:411; bootstrap.ts:536,675 | same: `0123456789012345678901234567890123456789; two t;  303 251 \n` | 〃 | 〃 | **same** |
| `ls -t "$DATA_DIR/bin"` | bootstrap.ts:709 | same: `b a ` | 〃 | 〃 | **same** |
| `case $(ls -ln f) in -rw-------*\|-r--------*)` | bootstrap.ts:434 | same: `-rw-------; ok` | 〃 | 〃 | **same** — the mode column is `-rw-------` in all three |
| `tr -dc 'A-Za-z0-9' \</dev/urandom \| head -c 32 >f` (and under `umask 077`, stderr captured) | bootstrap.ts:449,606 | same: `32; st=0 len=32; -rw-------` | 〃 | 〃 | **same** — no `Broken pipe` text on stderr from uutils `tr` |
| `tr -dc 'a-f0-9' \| head -c 32`; `tr -dc '89ab' \| head -c 1` | bootstrap.ts:610,611 | same: `32; 1` | 〃 | 〃 | **same** |
| `sed "s/^\(........\)\(....\).\(...\).\(...\)\(............\)$/…/"` | bootstrap.ts:612 | same: `01234567-89ab-4def-9123-456789abcdef` | 〃 | 〃 | **same** |
| `wc -c \<f` | bootstrap.ts:450 | same: ` 3 2 \n; 3` | 〃 | 〃 | **same** — no padding in any of the three |
| `sleep 0.2` (probed by `if sleep 0.2 2>/dev/null`) | bootstrap.ts:461,639 | same: `0` | 〃 | 〃 | **same** |
| `nohup cmd \</dev/null >log 2>&1 9>&- &` | bootstrap.ts:459,634 | same: `st=0 log=0; ` | 〃 | 〃 | **same** |
| `uname -s`, `uname -m`, `uname -r` | bootstrap.ts:244,254,279,591 | same: `Linux; ARCH; 1` | 〃 | 〃 | **same** |
| `. /etc/os-release` (`ID`), `getconf GNU_LIBC_VERSION` | bootstrap.ts:274,280 | same (see note) | 〃 | 〃 | **same** — the probe step in each image: `release` ubuntu / debian / alpine, `libc` glibc / glibc / musl |
| `tr -d '\r' \| cut -c1-500` | bootstrap.ts:536 | same: ` a \n b \n` | 〃 | 〃 | **same** |
| `eval "$(dd bs=1 count=N 2>/dev/null)"` (the prelude that leaves the rest of stdin) | lib-host/shell-words.ts:16 | same (see note) | 〃 | 〃 | **same** — the input delivered in three pieces over 0.6 s: the prelude is `abcd`, the rest is intact, in all three; the whole session bootstrap (below) too |
| `mktemp -d` | session-bootstrap.ts:33 | same: `ok` | 〃 | 〃 | **same** |
| `setsid "$SHELL" -l \<in >out &` | session-bootstrap.ts:36 | same: `ok` | 〃 | 〃 | **same** — the bootstrap in each image: `LAYER1-READY` then the next command; a login shell over its bound gives `LAYER1-TIMEOUT 1` (exit 124); one that exits gives `LAYER1-EXITED 3` (exit 1) |
| `kill -9 -"$PID" "$PID"`, `kill -TERM` (shell builtins) | session-bootstrap.ts:48,53 | 106: kill: No such process  done | 106: kill: No such process  done | can't kill pid -279: No such process done | **differs** — the shell's own text for a missing process; not parsed |
| `base64 -d \<<'M_input'` (wrapped lines, padded) | shell-runs.ts:63 | same: `hello world; hello world; hello world` | 〃 | 〃 | **same** |
| `base64 \<file` (76-column lines) | machine-settings.ts:52 | same: `aGVsbG8gd29ybGQ=` | 〃 | 〃 | **same** — 76 columns in all three, and the lines decode back |
| base64 of text without its padding | (not used: Node writes padded base64) |  h i |  h i b a s e 6 4 : i n v a l i d i n p u t \n |  b a s e 6 4 : t r u n c a t e d i n p u t \n | **differs** — uutils decodes `aGk` to `hi`; GNU and busybox report `invalid input` / `truncated input`. Our input is always padded, so nothing depends on it |
| `mkdir -- d`, `chmod 0777 -- d` | volume-folders.ts:23,24 | mkdir: Not a directory st=1; mkdir: Not a directory st=1; mkdir: mp1: File exists st=1; mkdir: No such file or | mkdir: cannot create directory 'aFile/g': Not a directory st=1; mkdir: cannot create directory 'aFile': Not a  | mkdir: can't create directory 'aFile/g': Not a directory st=1; mkdir: can't create directory 'aFile/': Not a d | **differs** — the failure text: uutils `mkdir: Not a directory` with no path; GNU `mkdir: cannot create directory '<path>': Not a directory`; busybox `mkdir: can't create directory '<path>': …`. The path is already in `server.writeFailedPath`; the text is shown, not parsed. The unit row that asserted GNU's path (#1376) is the only code that depended on it |
| `cat > f.part; chmod 0644 f.part; mv -f f.part f` | relay-script.ts:46-48 | same: `-rw-r--r--; drwxr-xr-x -rw-r--r-- ` | 〃 | 〃 | **same** |
| `id -un`, `getent passwd u`, `cut -d: -f7`, `cat /proc/self/environ` | remote-environment.ts:56-66 | /root:/bin/bash | /root:/bin/bash | /root:/bin/sh | **differs** — `getent` gives each image's own login shell (`/bin/bash`, `/bin/bash`, `/bin/sh`); the probe runs it in all three (login, interactive and both) and prints the environment between its markers |
| `ln -sfn -- a b`; `readlink -- p` | forwarding-step.ts:142,154 | same: `tgt3; tgt3` | 〃 | 〃 | **same** |
| `mkdir -p dir/` where a file is in the way (`writeFailedError`) | posix-script.ts:297; bootstrap.ts:331 and others | same (see note) | 〃 | 〃 | **differs** — same family as the `mkdir` row above: passed through, never parsed |

## Runs behind the table

- The real steps (`probe`, `install` from a local archive, `start`, a second `start` that reuses it, `kill`, `cleanup`,
  `uninstall`), with the link lock and the `flock` lock, in each image: every step `Ok`, the server up after `start` and
  gone after `kill`. With the lock held by another window, `install` answers `LockBusy` in all six runs.
- The login-shell bootstrap (`sessionStart`) in each image: `LAYER1-READY` then the next command; a login shell over its
  bound gives `LAYER1-TIMEOUT 1`; one that exits at once gives `LAYER1-EXITED 3`.
- The container-side scripts in each image: the volume folders (made, and a file in the way), `userEnvProbe` in its three
  shell modes, the relay and machine-settings writes and read.
- The unit files that run these scripts for real (`bootstrap-script-*`, `cli-script`, `tree-install`, `fake-host`,
  `session-bootstrap`, `shell-runs`, `volume-folders`, `remote-environment`, `forwarding-step`) inside `ubuntu:26.04`
  and `debian:bookworm-slim`, as a user other than root and with an init process: all pass, but the volume-folders row
  that asserted GNU's wording (ubuntu, fixed in #1376) and a row that needs `ps` (debian slim has none).
- The whole unit suite inside `ubuntu:26.04`: 9341 passing, 7 pending, 17 failing; 16 of the 17 need `ssh`, `git` or `pnpm`,
  which the image lacks, and the 17th is the volume-folders row above.
