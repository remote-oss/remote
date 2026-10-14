# Task card containers-10: C2's pre-flight classifier reads the Docker CLI's stderr only in anchored forms

Issue: #862. Remote - Containers release 1, slice 1 (D-87). This is the ADR-0010 follow-up to containers-03 (#758,
build PR #842), and row **P15** of the output-parser audit (connect-59, #832). Size: S (about half an agent-day).
Builder: hestia, once #842 has merged. It gates Containers release 1 (ADR-0010, Consequences). It doesn't block #842.

**Design:**
- ADR-0010, rules 2 and 3, and its Check;
- containers contracts §6, the ADR-0010 row;
- containers-03 §3.2 and §3.4, which this card amends.

**Spec:** F-0201 (`remote-oss/remote-containers#18`): BR-3, 7.E2, 7.E3, 7.E16, AC-7, AC-25, AC-32, AC-36, AC-46 and
AC-47.

## 1. What is wrong

`check-outcome.ts` (containers-03, as built on #842) reads a failing query's stderr with two unanchored patterns over
the whole text: `isPermissionDenied` (`/permission denied/i`) and `failureOf`'s `/not ?found/i`. ADR-0010 rule 2 allows
only a whole line or a prefix that the program itself writes. The Docker CLI's stderr also carries text that isn't its
verdict:
- its own `WARNING:` lines;
- the daemon's reply, after `Error response from daemon:`;
- an ssh engine host's own stderr, after `error during connect: … stderr=`.

Three real setups on the pinned Docker get the wrong dialog today (§2, forms 6, 7 and 8).

**Each check of P15, classified:**

| Check | How it decides | ADR-0010 | This card |
|---|---|---|---|
| `executableOf` gave `notFound` | the setting's value, before any spawn | conforms | unchanged |
| a spawn `failed`; `/\bENOENT\b/` in the detail → `notFound`, else `engineError` (S339 at the second check) | Node's spawn error code (form 1; EACCES is 7.E11 by the spec, form 2) | rule 3, conforms | unchanged |
| the check's own timer fired → `engineError` / S144 | C2's own timer | rule 3, conforms | unchanged |
| exit 0 → passes; stdout and stderr of a passing query are never read | the exit status (form 9) | rule 3, conforms | unchanged |
| `tooOld` from `serverApiOf`: JSON `Server.ApiVersion`, `^\d+\.\d+$` | the structured `--format '{{json .}}'` reply | rule 2, conforms | unchanged |
| non-zero exit, `/permission denied/i` anywhere in stderr → `permission` / S104 | an unanchored substring | **breaks rule 2** (forms 6 and 8) | §3 |
| non-zero exit, `/not ?found/i` anywhere in stderr → `notFound` | an unanchored substring | **breaks rule 2** (form 7) | §3 |

## 2. The measured forms

These were measured on 2026-10-14 with Docker 29.9.0 (client and engine API 1.56; the engine's minimum API is 1.40).
`<dir>` stands for a scratch folder. Each form is stderr, verbatim. "Today" is #842's outcome, first check / second
check.

| # | Setup | Exit | stderr | Today | Right |
|---|---|---|---|---|---|
| 1 | `dockerPath` `/nope/docker` | spawn | the spawn error `spawn /nope/docker ENOENT` | `notFound` / S339 | same |
| 2 | `dockerPath` names a file without execute permission | spawn | the spawn error, code `EACCES` | `engineError` (7.E11) / S339 | same |
| 3 | `DOCKER_HOST=unix:///nonexistent.sock` | 1 | `failed to connect to the docker API at unix:///nonexistent.sock; check if the path is correct and if the daemon is running: dial unix /nonexistent.sock: connect: no such file or directory` | `engineError` / S144 | same |
| 4 | `DOCKER_HOST=tcp://127.0.0.1:1` | 1 | `Cannot connect to the Docker daemon at tcp://127.0.0.1:1. Is the docker daemon running?` | `engineError` / S144 | same |
| 5 | a socket the user may not open (root-owned, mode 0600) | 1 | `permission denied while trying to connect to the docker API at unix://<dir>/root.sock` | `permission` / S104 | same |
| 6 | `config.json` unreadable (mode 0000), and form 3's `DOCKER_HOST` | 1 | `WARNING: Error loading config file: open <dir>/config.json: permission denied`, then form 3's line | `permission` / S104 | **`engineError` / S144** |
| 7 | `DOCKER_HOST=tcp://127.0.0.1:<port>`, an HTTP server that isn't an engine | 1 | `Error response from daemon: <!DOCTYPE HTML>`, then 17 more lines of the server's page, among them `        <p>Message: File not found.</p>` | `notFound` / S144 | **`engineError` / S144** |
| 8 | `DOCKER_HOST=ssh://nosuchuser0201@<host>`, a host that refuses the login | 1 | `error during connect: Get "http://docker.example.com/v1.56/version": command [ssh -l nosuchuser0201 -o ConnectTimeout=30 -T -- <host> docker system dial-stdio] has exited with exit status 255, make sure the URL is valid, and Docker 18.09 or later is installed on the remote host: stderr=nosuchuser0201@<host>: Permission denied (publickey,gssapi-keyex,gssapi-with-mic).`, ending in ssh's own `\r`, then an empty line | `permission` / S104 | **`engineError` / S144** |
| 9 | `config.json` that isn't JSON (`{bad`), engine reachable | 0 | `WARNING: Error parsing config file (<dir>/config.json): invalid character 'b' looking for beginning of object key string` | passes | same |
| 10 | form 9's `config.json`, and form 3's `DOCKER_HOST` | 1 | form 9's line, then form 3's line | `engineError` / S144 | same |
| 11 | `DOCKER_CONTEXT=nope` | 1 | `Failed to initialize: unable to resolve docker endpoint: context "nope": context not found: open <home>/.docker/contexts/meta/<hash>/meta.json: no such file or directory` | `notFound` (AC-47) / S144 | same |
| 12 | `config.json` `{"currentContext":"gone"}` | 1 | form 11's text, with context `"gone"` and `<dir>` | `notFound` / S144 | same |
| 13 | `docker version --format '{{json .}}'` with form 3's `DOCKER_HOST` | 1 | form 3; stdout still holds `{"Client":{…},"Server":null}` | `engineError` | same |

**Also measured:**
- an executable plugin in `<config>/cli-plugins/` adds nothing to `docker version`'s stderr. Context and plugin text
  reaches it only as form 11;
- `DOCKER_API_VERSION=1.20` gives `Error response from daemon: client version 1.20 is too old. Minimum supported API
  version is 1.40, please upgrade your client to a newer version`, with exit 1. That is `engineError` under §3, as
  today. An engine below API 1.35 can't be run on this machine. `tooOld` comes from the JSON reply only, which is
  already structured, so its rows stay as containers-03 wrote them.

**Inferred, not measured:** an ssh engine host without `docker` on its PATH puts the host shell's `command not found`
text after form 8's `stderr=`. Today that is `notFound`, and the 7.E1 dialog names the local `dockerPath`. With a login
banner, the embedded text runs over several lines, and only the first of them starts with `error during connect:`.

## 3. The rule

One pure function in `check-outcome.ts` replaces `isPermissionDenied` and the `not ?found` match. Both checks use it.

```ts
/** What a failing query's stderr says, read as F-0201 BR-3 and ADR-0010 rule 2 allow. */
function stderrOutcomeOf(stderr: string): 'permission' | 'notFound' | 'engineError';
```

1. **The lines:** split stderr at `\n`, and remove one trailing `\r` from each line.
2. **The Docker CLI's own warnings are skipped:** a line that starts with `WARNING:` is not read (forms 6, 9 and 10).
3. **The Docker CLI's own transport and daemon prefixes decide.** When any line starts with one of these, the outcome
   is `engineError`, whatever else stderr holds:
   - `Error response from daemon:` (form 7: what follows, on that line and the next ones, is the daemon's text);
   - `error during connect:` (form 8: what follows is another program's stderr, an ssh host's included);
   - `failed to connect to the docker API at ` (form 3);
   - `Cannot connect to the Docker daemon at ` (form 4).

   Each is matched exactly and case-sensitively at the start of the line. A line that only contains one of these
   texts mid-line decides nothing under this step.
4. **F-0201 BR-3's text rule applies to the lines that are left:**
   - a line that contains `permission denied`, in any letter case, gives `permission` (7.E3; it takes precedence);
   - otherwise, a line that matches `/not ?found/i` gives `notFound` (7.E2 → 7.E1);
   - otherwise the outcome is `engineError`.

   This keeps forms 5, 11 and 12 and the wrapper texts of AC-32 and AC-47 as the spec rules them. §6 asks athena to
   admit this step as rule 2's documented form for this stream.

**The two checks:**
- `failureOf` returns `stderrOutcomeOf(query.stderr)` for a non-zero exit, in place of its two matches;
- `secondCheckOutcomeOf` gives S104 for `permission` and S144 for `notFound` and `engineError`. 7.E16 and AC-36 know
  only those two texts for a query that ran;
- nothing else in the file changes. The patterns are module constants, and no helper is duplicated (ADR-0003).

## 4. Rows

All rows go in `packages/remote-containers/test/unit/check-outcome.test.ts`. Each row runs both checks: query 1 (`--version`)
exits 0, and the given stderr is on query 2 for the first check and on the `version` query for the second. The
fixtures hold §2's forms verbatim, with `<dir>` as `/home/u/.docker` and `<host>` as `build.example`. Cite `ADR-0010`
and the AC on each row. The rows marked **fails today** must fail on #842's code, in the first check, the second or both: check that before
the fix.

| # | stderr of the failing query (exit 1 unless said) | First check | Second check |
|---|---|---|---|
| R1 | form 3 | `engineError` | S144 |
| R2 | form 4 (AC-25) | `engineError` | S144 |
| R3 | form 5 (AC-7, AC-46) | `permission` | S104 |
| R4 | form 11 (AC-47) | `notFound` | S144 |
| R5 | form 6, the unreadable `config.json` warning, then form 3. **Fails today** | `engineError` | S144 |
| R6 | form 6's warning, then form 5 | `permission` | S104 |
| R7 | form 6's warning, then form 11 | `notFound` | S144 |
| R8 | form 7, the 18 lines of the HTML page. **Fails today** | `engineError` | S144 |
| R9 | form 8, the ssh `Permission denied (publickey,…)`, then an empty line. **Fails today** | `engineError` | S144 |
| R10 | form 8 with `stderr=bash: line 1: docker: command not found` in place of the ssh text. **Fails today** | `engineError` | S144 |
| R11 | form 8 ending `stderr=Welcome to build.example`, then the lines `Permission denied, please try again.` and `bash: docker: command not found`. **Fails today** | `engineError` | S144 |
| R12 | `WARNING: Error parsing config file (/srv/notfound/config.json): unexpected end of JSON input`, then form 3. **Fails today** | `engineError` | S144 |
| R13 | form 5 and form 6's warning, each ending `\r` | `permission` | S104 |
| R14 | a line that has `Error response from daemon: x` mid-line (`wrapper: Error response from daemon: x not found`) | `notFound` | S144 |
| R15 | AC-32 and AC-47's wrapper texts, one row each: `Error: Permission Denied`; `permission denied`; `Error: Not Found`; `f0201: command not found`; `notfound`; `permission denied, not found` | `permission`; `permission`; `notFound`; `notFound`; `notFound`; `permission` | S104; S104; S144; S144; S144; S104 |
| R16 | form 9's warning, exit 0 | passes | passes |
| R17 | `not found` on stdout only, empty stderr (AC-25) | `engineError` | S144 |

R1–R4, R15 and R17 repeat rows that containers-03 already has. Keep one copy of each: move it into the table-driven
rows of this card rather than adding a second.

## 5. What doesn't change

- the spawn rules (form 1 is `notFound`, form 2 is 7.E11's `engineError`), the timeout, `tooOld` from JSON, and the
  rule that stdout is never examined;
- the queries, their argv, the dialogs and the strings;
- `preflight.ts` (it doesn't import the patterns);
- the catalogue: the same F-0201 ACs, with no new line.

## 6. For athena (in the card PR's review)

**Rule 2 and F-0201 BR-3.** The spec rules the text match itself. BR-3 and 7.E2 say "contains 'not found' (any case,
with or without the space), also inside other words". AC-32 and AC-47 require wrapper texts that no Docker CLI writes:
`Error: Permission Denied`, a bare `permission denied`, `Error: Not Found` and `f0201: command not found`. A rule-2
anchoring that accepts only the Docker CLI's own prefixes would fail AC-32 and AC-47. "Done" means their cases pass, so
we can't do that without a spec question.

- **This card's choice:** §3 step 4 keeps BR-3's rule. It applies only after steps 2 and 3 have removed every measured
  way in which other text reaches the stream: the Docker CLI's own warnings, the daemon's reply, and an ssh host's
  stderr. The stream is the local CLI's own pipe, and the pre-flight starts no session, so rule 1's remote text arrives
  only through step 3's prefixes. In ADR-0010's words: this card proposes that rule 2 names F-0201 BR-3's form for
  this stream, with step 2's skips and step 3's prefixes.
- **The alternative:** anchor step 4 as well, accepting only form 5's prefix and form 11's prefix. AC-32 and AC-47
  would then go to the spec as a question on `remote-oss/remote-containers#18`, and this card would wait for it.

The builder follows this card's choice unless athena rules otherwise on the card PR.

## 7. The audit row (connect-59, #832)

connect-59's card is on #837, which hasn't merged, so this PR doesn't edit it. When #837 has merged, this row goes into
its §2 table after P14:

> | P15 | C2's pre-flight classifier | `remote-containers/src/engine/check-outcome.ts` (containers-03, #842) | 2, 3 | The spawn error, the timer, the exit status and the JSON `Server.ApiVersion` conform. `/permission denied/i` and `/not ?found/i` over the whole stderr don't: measured on Docker 29.9, a `WARNING:` line, a daemon reply and an ssh host's stderr change the dialog | row and fix in **containers-10** (#862) (§4) |

And this bullet goes into its §4:

> - **containers-10 (#862), the follow-up to containers-03 (#842):** C2's stderr classifier. It skips `WARNING:`
>   lines, decides `engineError` on the Docker CLI's transport and daemon prefixes, and only then applies F-0201
>   BR-3. Its rows R5 and R8–R12 are the noisy-neighbour rows.

## 8. Gates and review

- **Gates:** all of them: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers,
  check-string-tables, check-coverage, check-licences and coverage. `check-outcome.ts` must stay at 100 %.
- **PR title:** `remote-containers: C2 reads the Docker CLI's stderr only in anchored forms (card containers-10, #862)`.
- **Review:** themis or triton reviews; athena gives the design check, including §6.

## 9. Open rows (stop and report on #862)

1. A row marked **fails today** passes on #842's code. Report the row and what the code did.
2. #842 merged with a classifier that differs from §1's description. Apply §3 to what is there, and report the
   difference.
3. athena rules the alternative in §6. Follow her ruling, and stop for the spec answer before changing step 4.
