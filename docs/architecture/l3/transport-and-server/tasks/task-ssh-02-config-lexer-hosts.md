# Task ssh-02: the configuration lexer and the host list (S4)

Base: branch `feature/lib-ssh-pure` (ff563f1), brought to the contract. The modules exist; this card writes their tests and fixes what fails. It needs the `memory-reader.fixture.ts` helper of task ssh-03 (the in-memory file port); until that is merged keep a local copy and do not commit it.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-ssh/src/config/lexer.ts` | `lexConfiguration` |
| `packages/lib-ssh/src/config/hosts.ts` | `listHosts` |
| `packages/lib-ssh/test/unit/lexer.test.ts`, `packages/lib-ssh/test/unit/hosts.test.ts` | new |

Nothing else may change. No recorded fixtures: every file tree is an inline literal of the table, served by `memoryReader` (a map from absolute path to text; `listFolder` derived from the keys). Only the 4200-host row generates its text inside the test.

## 2. Contract

`contracts.md` section 3, heading "### S4 config-model (parser and writer)", operation `listHosts` (host entries in the order and with the inclusion rules of F-2202 BR-1 to BR-20; failure `parseError` with file and reason). The contract governs. The branch signature is `listHosts(configFile: string, locations: ClientLocations, reader: ConfigFileReader): HostListResult`, `HostListResult = {hosts: {name, file}[]} | {parseError: {file, reason}}`. `lexConfiguration(text): {directives: {keyword, words}[]} | {parseError: string}` is internal to S4 and not named by the contract; the rows pin its shape only as far as they assert it.

Default for every host row: `configFile ''`, `locations {homeFolder:'/home/dev', platform:'linux'}`, files given as a path-to-text map. U is `/home/dev/.ssh/config`, Y is `/etc/ssh/ssh_config`. Expected is the list of `name`s in order unless a file is named. (each) means one `it` per listed input.

## 3. Test table

| Cite | Given (`lexConfiguration`) | Expected |
|---|---|---|
| F-2202.BR-1 | `Host one` | directives `[{keyword:'Host', words:['one']}]` |
| F-2202.BR-1 | `HOST upperkw` | keyword `HOST` as written, words `['upperkw']` |
| F-2202.BR-1 | (each) `Host=eqsyntax`, `Host = eqspace`, `Host =eqleft`, `Host= eqright` | words `['eqsyntax']`, `['eqspace']`, `['eqleft']`, `['eqright']` |
| F-2202.BR-1 | `Host two three   four`; `Host tabbed<TAB>tabbed2` | words `['two','three','four']`; `['tabbed','tabbed2']` |
| F-2202.BR-1 | `Host trailing # a comment` | words `['trailing']` |
| F-2202.BR-1 | `Host "quoted name" afterquote` | words `['quoted name','afterquote']` |
| F-2201.BR-9 | `# Host hidden`, a blank line, `   # indented`, `Host shown` | one directive, words `['shown']` |
| F-2202.BR-18 | `Host a` CRLF `Host b` CRLF | two directives, words `['a']`, `['b']` |
| F-2202.BR-18 | U+FEFF before `Host a` | same result as `Host a` |
| F-2202.BR-10 | (each) `Include=path`, `include "p q"`, `Include a b` | words `['path']`, `['p q']`, `['a','b']` |
| F-2202.BR-4 | (each) `Match host=m13`, `MATCH HOST m14`, `Match host "m3,m4" user bob` | words `['host=m13']`, `['HOST','m14']`, `['host','m3,m4','user','bob']` |
| F-2201.7.E1 | `Host "abc` (quote never closed) | `parseError` is a non-empty string |
| F-2201.7.E1 | `Host "abc` followed by a line `Host b` | `parseError` is a non-empty string |
| F-2201.BR-9 | empty text | `{directives: []}` |
| F-2201.BR-9 | `garbage line` | result has `directives`, no `parseError` |

| Cite | Given (`listHosts`) | Expected |
|---|---|---|
| F-2202.AC-1 | U: `Host one`, `Host two three   four`, `Host last` | one, two, three, four, last |
| F-2202.AC-2 | U: `Host *`, `Host *.corp`, `Host web-?`, `Host !neg`, `Host alpha *.beta !gamma delta` | alpha, delta |
| F-2202.AC-3 | U: `HOST upperkw`, `host lowerkw`, `Host=eqsyntax`, `Host tabbed<TAB>tabbed2`, `Host "quoted name" afterquote`, `Host trailing # a comment` | upperkw, lowerkw, eqsyntax, tabbed, tabbed2, quoted name, afterquote, trailing |
| F-2202.AC-34 | U: `Host = eqspace`, `Host =eqleft`, `Host= eqright`, `Match canonical`, `Match final`, `Match canonical all`, `Match host ok,!bad`, `Match host "sp ace"`, `Match host plainok`, `Host after` | eqspace, eqleft, eqright, ok,!bad, sp ace, plainok, after |
| F-2202.AC-4 | U: `Host comma1,comma2`, `Host user@at`, `Host [::1]`, a host of 300 letters `n`, `Host ünï-cödé` | each as written, one entry each |
| F-2202.AC-5 | U: `Host dup`, `Host dup`, `Host same same`, `Host Foo`, `Host foo`, `Host FOO` | dup, same, Foo, foo, FOO |
| F-2202.AC-6 | U: `Match host m1,m2`, `Match host "m3,m4" user bob`, `Match exec "false" host execfalse`, `MATCH HOST m14`, `Match host qq user u host second` | m1,m2, m3,m4, execfalse, m14, second |
| F-2202.AC-7 | U: `Match host *.wild`, `Match host !negm`, `Match host ok1,*.wild2`, `Match originalhost om1`, `Match !host m12`, `Match all`, `Match tagged t1` | empty list |
| F-2202.BR-5 | U: `Match host m5 !m6 *.m7` | m5 |
| F-2202.BR-6 | U: `Match canonical host m10`, `Match final host m11`, `Match tagged t1 host m9`, `Host after` | m10, m11, m9, after |
| F-2202.BR-6 | U: `Match user bob`, `Match exec "true"`, `Match all`, `Host after` | after |
| F-2202.AC-8 | U: `Host h1`, `  Tag t1`, `Match tagged t1`, `Host h2` | h1, h2 |
| F-2202.BR-8 | U: `Match host m1`, `Host h2` | m1, h2 |
| F-2202.7.E4 | U: `Host` (no pattern), `Host b` | b |
| F-2201.AC-37 | U: `Port`, then on the next line `Host b` | empty list |
| F-2202.AC-9 | (each) U places `Include inc.conf` at the top of the file; after `Host *`; after `Host a *`; after `Host "*"`; after `Host * !x`; `/home/dev/.ssh/inc.conf` = `Host inc` | inc is listed |
| F-2202.AC-10 | (each) U: `Include inc.conf` after `Host a`; `Host a*`; `Host *.corp`; `Host !x`; `Match all`; `Match host *`; `Match exec "true"` | inc is not listed |
| F-2202.BR-9 | U: `Host *`, `Host a`, `Include inc.conf` | inc is not listed |
| F-2202.AC-11 | U: `Include conf.d/*.conf`; folder `/home/dev/.ssh/conf.d` holds `a.conf`, `b.conf`, `10.conf`, `z.txt`, each containing `Host <its file name>` | b.conf, a.conf, 10.conf; z.txt absent |
| F-2202.BR-12 | same include; folder holds `Z.conf`, `c1.conf`, `c2.conf`, `c3.conf`, `m.conf` (port lists them in any order), each `Host <file name>` | m.conf, c3.conf, c2.conf, c1.conf, Z.conf |
| F-2202.AC-12 | U: `Include tree/a.conf`, `Include tree/b.conf`, `Host own`; under `/home/dev/.ssh`: `tree/a.conf` = `Host tree-a` + `Include tree/a2.conf`; `tree/a2.conf` = `Host tree-a2` + `Include tree/a3.conf`; `tree/a3.conf` = `Host tree-a3`; `tree/b.conf` = `Host tree-b` + `Include tree/b2.conf`; `tree/b2.conf` = `Host tree-b2` | own, tree-a, tree-b, tree-a2, tree-b2, tree-a3 |
| F-2202.AC-13 | (each) U top line `Include rel.conf`, `Include ../up.conf`, `Include ~/abs.conf`, `Include /opt/abs.conf`, `Include "q.conf"`, `include low.conf`, `Include=eq.conf` | the file read is `/home/dev/.ssh/rel.conf`, `/home/dev/up.conf`, `/home/dev/abs.conf`, `/opt/abs.conf`, `/home/dev/.ssh/q.conf`, `/home/dev/.ssh/low.conf`, `/home/dev/.ssh/eq.conf`; its host is listed |
| F-2202.AC-14 | (each) U: `Include a.conf b.conf` (both exist), `Include ${HOME}/x.conf`, `Include %d/x.conf` | no included host |
| F-2202.AC-15 | (each) U: `Include` of a missing file; of a folder; of a file the port cannot read; then `Host own` | own; no error |
| F-2202.AC-15 | U: `Include config`, `Host own` (includes itself) | own once |
| F-2201.AC-38 | U: `Include b.conf`, `Host a`; `b.conf` = `Include config`, `Host b` (loop) | a, b |
| F-2202.AC-16 | `configFile '/home/dev/custom/config'` = `Include sub/inc.conf`; `/home/dev/custom/sub/inc.conf` = `Host near`; `/home/dev/.ssh/sub/inc.conf` = `Host far`; U and Y exist | near |
| F-2202.AC-17 | U: `Host both`; Y: `Host both`, `Host sysonly` | both (file U), both (file Y), sysonly |
| F-2201.BR-1 | Y: `Include ssh_config.d/*.conf`; `/etc/ssh/ssh_config.d/x.conf` = `Host sysx` | sysx |
| F-2201.BR-1 | `platform 'windows'`, home `C:\Users\dev`, `programDataFolder 'C:\ProgramData'`; `C:\Users\dev\.ssh\config` = `Host winuser`; `C:\ProgramData\ssh\ssh_config` = `Host winsys` | winuser, winsys |
| F-2202.AC-18 | (each) U with CRLF line ends; U with a leading BOM; same three hosts as an LF file | the list of the LF file |
| F-2202.BR-19 | U: 2000 lines `Host a-<n> b-<n>` and 200 lines `Match host m-<n>` | 4200 names in file order |
| F-2202.AC-19 | the text above, then a two-host text; time each call with `performance.now()` | difference under 1000 ms |
| F-2202.BR-20 | one reader: call; replace U's text; call again | the second call shows the new text |
| F-2201.BR-8 | U: `Host "abc`; Y: `Host sysonly` | `{parseError:{file:'/home/dev/.ssh/config', reason}}`, `reason` non-empty; no hosts |
| F-2201.AC-24 | U: `Include bad.conf`, `Host own`; `bad.conf` = `Host "abc` | own; no error |
| F-2201.BR-7 | U missing; Y: `Host sysonly` | sysonly |
| F-2201.AC-42 | U unreadable (port returns nothing); Y: `Host sysonly` | sysonly |
| F-2201.AC-33 | U: `Host *`, `Host *.corp !x` | empty list |
| F-2201.AC-8 | `configFile '/srv/c'` = `Host custom`; U = `Host userhost` | custom |
| F-2201.AC-12 | `configFile '~/alt'`; `/home/dev/alt` = `Host viaalt` | viaalt, file `/home/dev/alt` |
| F-2201.AC-13 | (each) `configFile` `rel/config`, `~`, `$HOME/x`, `${env:HOME}/x`, `   `; U and Y define hosts | empty list (no fallback to U or Y) |
| F-2201.BR-8 | U: `Host own`; Y: `Host "abc` | `{parseError:{file:'/etc/ssh/ssh_config', reason}}` with a non-empty reason; no hosts |
| F-2201.BR-8 | U: `Host own`; Y: `Include ssh_config.d/*.conf`, `Host sys`; `/etc/ssh/ssh_config.d/x.conf`: `Host "abc` | own, sys; no error |
| F-2201.AC-38 | U: the bytes `\u0000\u0001\u0002`, line end, `Host bin`; Y absent | empty list; no `parseError` |

## 4. Rule for the worker

- Write all tests from the table first, one `it` per row (per input for an (each) row), the name starting with the Cite. Run `pnpm test:unit`; fix a module only where a row fails and only to meet that row.
- Never change an exported signature or the contract. Do not add behaviour or tests for anything in section 6.
- Comments only where the Google TypeScript guide requires them; no F-/R-/D- ids or origin framing in code comments or JSDoc (ids may appear in test names). Every identifier at least four characters, properties included. No duplicated code (one `memoryReader`, one table loop per area); no unused exports.
- Coverage for `lexer.ts` and `hosts.ts` at least 90 % lines, 85 % branches, 90 % functions; report unreached branches, do not delete them.
- Full gate list: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: remote-coding-worker-1. PR title: `lib-ssh: tests and fixes for the configuration lexer and host list (task-ssh-02)`. The description answers R1 to R4 and R6 in one line each, and R5 by a list mapping each Cite to its test name; it lists the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

Sent to the lead with a proposed answer; until the answer is written into section 3, the worker stops here.

| # | Case | Question and proposed answer |
|---|---|---|
| 2 | The words of `parseError.reason`; F-2201 Q1 is open | Proposed: the branch's text, not a contract; tests assert only that it is not empty |
| 3 | `#` inside a word: `Host "a#b"` and `Host a#b` | Proposed: `a#b` and `a`, as the branch does (F-2202.BR-1) |
| 5 | `*` and `?` against names starting with a dot; bracket classes in `Include` | Proposed: no match on a leading dot unless the pattern starts with `.`; `[a-c]` and `[!a]` are classes, as the branch does |
| 6 | Relative, `~/` and backslash `Include` paths on Windows; F-2202 Q2 is open | Proposed: relative against the include base with Windows joins; `~/` and `~\` against the home folder; both separators accepted |
| 7 | A limit on `Include` nesting or file count | Proposed: none; the seen-file set already stops loops (F-2202.BR-14, F-2201.7.E5) |
