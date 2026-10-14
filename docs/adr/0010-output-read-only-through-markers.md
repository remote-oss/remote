# ADR-0010: What we read from a shell or a program is read only through our markers or its documented form

- Status: accepted
- Date: 2026-10-14
- Deciders: the lead (athena), on the user's rule relayed through iris and hermes ("never trust free-form output")
- Scope: every package that reads the output of a remote shell, a container, or a program it runs: lib-ssh, lib-server,
  lib-host, remote-ssh, remote-containers
- Requirements: F-2704 (login shells and their startup files), F-2105 (the connect wait), F-2312 (X11), F-0408 and
  F-0409 (containers); the containers contracts §1 amendment of 2026-10-14 (#808)

## Context

A login shell and its startup files (`.bashrc`, `.bash_profile`, `.profile`, `/etc/motd`, `~/.ssh/rc`, a container's
profile scripts) can print anything, before, between and after what we run. That includes text that resembles our
own lines or a program's messages. A program we run (a script's own commands, `tar`, `node`) can print anything on
the same stream. So any parser that matches free-form text can be fooled by ordinary user configuration. The user
ruled that we never trust such text. The exec channel's stderr substring "is not running" (#808) was a case of it.

## Decision

1. **Text from a remote shell or a container is untrusted.** A value we need from it travels only inside our own
   markers:
   - a marker is a **whole line** of our own vocabulary, matched exactly after removing one trailing `\r`. The
     existing families conform as they are: the result block (`remote-oss-server-result-begin`/`-end`), the progress
     lines (`remote-oss-server-progress`) and the bootstrap's `LAYER1-*` lines. A **new** family starts with
     `remote-oss-`;
   - a value is a line inside a block that our script opened and closed (`fact <key> <value>` inside the result block),
     a marker line's own fields, or what our own command prints after a marker into a file only it writes (the
     bootstrap's `LAYER1-START`, then `export -p`).

   Text outside our markers is logged (scrubbed, as every line) and otherwise **ignored**. It's never matched for
   meaning, never by substring, and never by "the first line that looks like". When the same block appears twice, the
   parser takes the one our script's structure defines (for example the last complete block). A partial block is a
   failure (`noResultBlock`), never a guess.
2. **Output of a local program we run is read only in its documented form,** anchored:
   - a whole line, or a fixed **prefix** the program itself writes (`Error response from daemon:`, ssh's own `debug1:`
     lines, `Authenticated to`), never a substring anywhere in a line;
   - a structured form where the program offers one: the dev container CLI's JSON result line and `--log-format json`
     events (ADR-0009), and JSON from `docker inspect -f`;
   - matched as narrowly as that form allows;
   - only from a stream nothing else writes into: the program's own file or pipe (the server's log file, which our
     non-login start script redirects, for the server's ready line), or the time before a session starts. ssh's own
     diagnostics are read **before** the session starts, since a login's startup files run only after
     authentication. After the session starts, ssh's streams carry remote text, so rule 1 applies, and so does an exit
     status (rule 3).
3. **Prefer an exit status or a process event to text** wherever it answers the question (exit 125, 137/143 with
   `docker inspect`, a process's `close`).
4. **What we don't read, we don't assume.** Passing a value through isn't parsing it, so the session's `DISPLAY`, read
   from a `fact` line, is passed on unchanged. But nothing may conclude that a feature works from text it didn't read
   under rules 1–3. X11 is one example: sshd sets `DISPLAY`, but with a `~/.ssh/rc` the cookie is that script's job
   (sshd(8)), so we pass `DISPLAY` through and claim nothing (F-2312 §15: sshd's X11 policy is out of scope).

## Consequences

- Every parser of remote or program output has a **noisy-neighbour row**. Noise goes before, between and after the
  block: lines that contain our marker text as a substring, a fake `fact` line outside the block, a line with a
  program's message embedded mid-line, and CR-terminated lines. The result is the same as without the noise.
- The audit of today's parsers (daedalus's card) checks each against rules 1–3. For each classifier of ssh's output
  it names the **window** it reads: the stderr classifier (S5), the prompt classifier (S6), the setup report and
  `PromptReader`. ssh's own messages count only before the session starts. After that, a `.bashrc` that prints
  "Permission denied" must not change a dialog.
- **The audit and its fixes gate** the 0.2 tag for the remote-ssh side (lib-ssh, lib-server, lib-host, remote-ssh),
  and containers release 1 for remote-containers. A parser whose noisy-neighbour row fails is a gating defect, fixed
  under its own card.
- A new marker family needs no ADR. It follows rule 1's form, and its card names it.

## Check

- **Review:** a parser that uses `includes`, an unanchored regular expression, or "first line matching" on remote or
  program output fails the design check, unless rule 2 names the form and the stream's timing.
- **Rows:** each parser's noisy-neighbour row, cited `ADR-0010`.
