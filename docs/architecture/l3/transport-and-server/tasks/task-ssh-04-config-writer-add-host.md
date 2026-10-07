# Task ssh-04: the Add New SSH Host parser and the host-block writer (S4)

Base: branch `feature/lib-ssh-pure` (3c0463a). The modules exist; this card writes their tests and fixes what fails. At least one row (option parsing after the destination) is expected to fail on the branch.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-ssh/src/config/add-host.ts` | `parseAddHostCommand` |
| `packages/lib-ssh/src/config/writer.ts` | `writeHostBlock` |
| `packages/lib-ssh/test/unit/add-host.test.ts`, `packages/lib-ssh/test/unit/writer.test.ts` | new |

Nothing else may change (`choices.ts` included). No fixtures: every input is an inline literal of the table. Flag meanings follow the public ssh(1) and ssh_config(5) manual pages.

## 2. Contract

`contracts.md` section 3, heading "### S4 config-model (parser and writer)", operations `parseAddHostCommand` ("the text the user typed" to "a Host block; one of the four errors of F-2204") and `writeHostBlock` ("file text, block" to "the new file text"). The contract governs. Branch signatures, both with a defaulted last parameter `choices` that the tests do not pass (section 6 row 1):

- `parseAddHostCommand(command: string): {block: {alias, lines: {keyword, value}[]}} | {problem}`; `problem` is `{kind:'missingHost'|'unknownFlag'|'missingFlagArgument'|'optionWithoutValue', message}` or `{kind:'shellCharacter', character}`.
- `writeHostBlock(fileText: string, block: HostBlock): string`.

Notation. `L(...)` is the `lines` array shown as `Keyword value` pairs; every block starts with `HostName <alias>`, so rows write `alias; rest`. `\n` and `\r\n` are literal line ends. (each) means one `it` per listed input.

## 3. Test table

Parser, rows give `Given` (the typed text) and `Expected`.

| Cite | Given | Expected |
|---|---|---|
| F-2204.BR-1 | `host1` and `  ssh   host1  ` | alias host1; no more lines (two rows) |
| F-2204.BR-1 | `user@host` | host; `User user` |
| F-2204.BR-4 | `ssh://user@host` and `ssh://host:2222` | host; `User user`. host; `Port 2222` (two rows) |
| F-2204.BR-4 | `a@b@host45`; `HOST20` | host45; `User a@b`. HOST20 (case kept); none |
| F-2204.BR-10 | `ssh -p 2222 -i ~/.ssh/key user@host4` | host4; `Port 2222`, `IdentityFile ~/.ssh/key`, `User user` |
| F-2204.BR-3 | (each) `-p2222 host`; `-oUser=dan host`; `-AC host` | `Port 2222`; `User dan`; `ForwardAgent yes`, `Compression yes` |
| F-2204.BR-5 | (each) `-l bob h`; `-i k h`; `-J jump h`; `-D 1080 h`; `-R 9000:localhost:22 h`; `-S /tmp/s h`; `-m hmac h`; `-b 0.0.0.0 h`; `-w 0:0 h` | `User bob`; `IdentityFile k`; `ProxyJump jump`; `DynamicForward 1080`; `RemoteForward 9000:localhost:22`; `ControlPath /tmp/s`; `MACs hmac`; `BindAddress 0.0.0.0`; `TunnelDevice 0:0` |
| F-2204.BR-5 | (each) `-A h`; `-v h`; `-C h`; `-X h`; `-x h`; `-Y h`; `-4 h`; `-6 h`; `-k h`; `-K h`; `-g h`; `-M h` | `ForwardAgent yes`; `LogLevel verbose`; `Compression yes`; `ForwardX11 yes`; `ForwardX11 no`; `ForwardX11Trusted yes`; `AddressFamily inet`; `AddressFamily inet6`; `GSSAPIDelegateCredentials no`; `GSSAPIAuthentication yes`; `GatewayPorts yes`; `ControlMaster yes` |
| F-2204.BR-5 | `-L 8080:localhost:80 h` | `LocalForward 8080 localhost:80` |
| F-2204.BR-5 | `-L 127.0.0.1:8080:localhost:80 h` | `LocalForward 127.0.0.1:8080 localhost:80` (bind address form, ssh(1)) |
| F-2204.BR-5 (adapted) | `-c aes128-ctr -I /usr/lib/p.so h` | `Ciphers aes128-ctr`, `PKCS11Provider /usr/lib/p.so` |
| F-2204.BR-5 (adapted) | `-W target:22 h` | no line besides `HostName` |
| F-2204.BR-6 | (each) `-t h`, `-T h`, `-N h`, `-f h`, `-n h`, `-s h`, `-q h`, `-G h`, `-V h`, `-y h`, `-a h` | alias h; no more lines |
| F-2204.BR-6 | (each) `-F cfg h`, `-E log h`, `-e ^ h`, `-B addr h`, `-O check h`, `-Q cipher h` | alias h; no more lines (the flag's argument is consumed) |
| F-2204.BR-6 (adapted) | `-P tag host36` | alias host36; no more lines |
| F-2204.BR-7 | (each) `-o Foo=bar h`; `-o port=2201 h`; `-o HostName=x h`; `-o hostname=h44 h` | `Foo bar`; `port 2201`; no extra line (alias h); `hostname h44` after `HostName h` |
| F-2204.BR-7 | `-o "Foo=bar baz" h`; `-o "ProxyCommand=nc %h %p" h` | `Foo bar baz`; `ProxyCommand nc %h %p` (no quotes added) |
| F-2204.BR-8 | (each) `-i "~/my key" h`; `-l 'bo b' h`; `-o "IdentityFile=~/my key" h` | `IdentityFile "~/my key"`; `User "bo b"`; `IdentityFile "~/my key"` |
| F-2204.BR-8 | (each) `-p abc h`; `-l -bob h`; `!!!` | `Port abc`; `User -bob`; alias `!!!` |
| F-2204.BR-2 | `-i my\ key h` | `IdentityFile "my key"` |
| F-2204.BR-2 | `ssh -- -bad`; `ssh -p 22 -- h` | alias `-bad`, no more lines; alias h, `Port 22` |
| F-2204.BR-9 | `-l bob carol@host46` | host46; one line `User bob` |
| F-2204.BR-9 | (each) `-p 2222 -p 3333 h`; `-o ForwardAgent=no -A h`; `-A -o ForwardAgent=no h`; `-p 1 -i k -p 2 h` | `Port 3333`; `ForwardAgent yes`; `ForwardAgent no`; `Port 2`, `IdentityFile k` (one line per keyword, first position, last value) |
| F-2204.7.E1 | (each) empty text; `ssh`; `ssh -p 22`; `-oProxyCommand=x`; `user@` | problem `missingHost`, message `Missing host in SSH connection string` |
| F-2204.7.E8 | `@host47` | alias host47; no `User` line |
| F-2204.7.E2 | `ssh -Z x host` | problem `unknownFlag`, message `Unknown flag Z` |
| F-2204.7.E3 | `ssh -p` | problem `missingFlagArgument`, message `Expected flag -p to have an argument but it did not` |
| F-2204.7.E4 | `-o "ProxyCommand nc %h %p" h` | problem `optionWithoutValue`, message `Argument missing for option ProxyCommand nc %h %p` |
| F-2204.BR-3 (adapted) | `ssh host19 ls -la`; `ssh host -p 2222`; `ssh host48 -p` | alias host19; alias host, no `Port`; alias host48 and no problem (options end at the destination) |
| F-2204.7.E5 | (each) `host50;id`, `host53\|x`, `host62&`, `host61>out`, `host65<in`, `host66(x)`, `host66)`, `host64*`, `host67?`, `host63 # c`, `host73#c` | problem `{kind:'shellCharacter', character}` with `;`, `\|`, `&`, `>`, `<`, `(`, `)`, `*`, `?`, `#`, `#` |
| F-2204.7.E5 | (each) `'host57;id'`; `"host72*"`; ``host68`id` ``; `host69[1]`; `host70{a,b}` | alias without the quotes: `host57;id`; `host72*`; `` host68`id` ``; `host69[1]`; `host70{a,b}` |
| F-2204.7.E8 | `ssh -i "unterminated host49` | host49; `IdentityFile unterminated` (a quote never closed is ignored) |
| F-2204.7.E8 | `host54$x` | alias host54 (the `$x` part is dropped) |
| F-2204.7.E9 | `user@fe80::1`; `::1` | alias `fe80::1` with `User user`; alias `::1` |
| F-2204.BR-8 | `host:abc` | host; `Port abc` |

Writer. B is the block alias `host4`, lines `HostName host4`, `Port 2222`; "W(...)" is the expected file text.

| Cite | Given (file text) | Expected |
|---|---|---|
| F-2204.BR-11a | `` (empty) | `Host host4\n  HostName host4\n  Port 2222\n` |
| F-2204.BR-11b | `Host old\n  HostName o\n` | `Host host4\n  HostName host4\n  Port 2222\n\nHost old\n  HostName o\n` |
| F-2204.BR-11b | `# top\nInclude x\nServerAliveInterval 5\n\nHost old\n  Port 1\n` | the same text with B (then a blank line) inserted directly before `Host old` |
| F-2204.BR-11b | `Match all\n  X 1\n` | B, blank line, then the file |
| F-2204.BR-11b | `host a\n  X 1\n` (lower case keyword) | B, blank line, then the file |
| F-2204.BR-11c | `# only comments\nServerAliveInterval 5\n` | file, blank line, `Host host4\n  HostName host4\n  Port 2222\n` |
| F-2204.BR-11c | `# c` (no final newline) | `# c\n\nHost host4\n  HostName host4\n  Port 2222\n` |
| F-2204.BR-11c | `# c\n\n` | `# c\n\nHost host4...` (one blank line, not two) |
| F-2204.BR-11c | `HostName g\n` (a global line that only starts like a block) | `HostName g\n\nHost host4\n  HostName host4\n  Port 2222\n` |
| F-2204.BR-12 (adapted) | `\n\nHost a\n  X 1\n` | `\n\n` + B + blank line + `Host a\n  X 1\n` |
| F-2204.BR-12 (adapted) | `Host a\n  X 1` (no final newline) | B, blank line, `Host a\n  X 1` (no newline added) |
| F-2204.BR-12 (adapted) | `Host a\r\n  X 1\r\n` | `Host host4\r\n  HostName host4\r\n  Port 2222\r\n\r\nHost a\r\n  X 1\r\n` |
| F-2204.BR-12 (adapted) | `# c\r\n` | `# c\r\n\r\nHost host4\r\n  HostName host4\r\n  Port 2222\r\n` |
| F-2204.BR-13 | `Host a\nHostName x\n\nHost b\n    HostName y\n` | `Host` line indented 2, option lines 4, then blank line, then the file |
| F-2204.BR-13 | `Host a\n      # note\nHostName x\n` | `Host` indented 4, options 6 |
| F-2204.BR-13 | (each) options indented by `\t`; 8 spaces; 3 spaces; 2 spaces | `Host` indented by none; 6; 1; none; options keep the indentation |
| F-2204.BR-13 | `  Foo 1\nHost a\nHostName x\n` (indent only before the first block) | `Host` unindented, options 2 spaces |
| F-2204.BR-13 | `Host a\nHostName x\n` | `Host` unindented, options 2 spaces |
| F-2204.BR-14 | `Host host4\n  HostName host4\n` | B, blank line, then the existing block (both present) |
| F-2204.BR-12 (adapted) | `  Host a\n    X 1\n` (first line indented) | B inserted at the start of that line; the line stays untouched |

## 4. Rule for the worker

- Write all tests from the table first, one `it` per row (per input for an (each) row), the name starting with the Cite. Run `pnpm test:unit`; fix a module only where a row fails and only to meet that row. The row `F-2204.BR-3 (adapted)` is expected to fail first.
- Never change an exported signature or the contract. Do not add behaviour or tests for anything in section 6.
- Comments only where the Google TypeScript guide requires them; no F-/R-/D- ids or origin framing in code comments or JSDoc (ids may appear in test names). Every identifier at least four characters, properties included. No duplicated code (one table loop per table); no unused exports.
- Coverage for `add-host.ts` and `writer.ts` at least 90 % lines, 85 % branches, 90 % functions; report unreached branches, do not delete them.
- Full gate list: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: remote-coding-worker-1. PR title: `lib-ssh: tests and fixes for the host parser and block writer (task-ssh-04)`. The description answers R1 to R4 and R6 in one line each, and R5 by a list mapping each Cite to its test name; it lists the rows that failed first, the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

| # | Case | Question |
|---|---|---|
| 1 | The `choices` parameter and `choices.ts`: the nine switches are all fixed to the confirmed values, so their other branches are unreachable from the table and count as dead code under the coding standard | Remove the parameter and the switches (a signature change), or keep them? |
| 2 | Order of `User` and `Port` when one destination gives both (`user@host:2222`): the branch writes `User` first | Is that the order? |
| 3 | Bracketed IPv6: the branch drops the brackets (`user@[::1]` gives alias `::1`; `[::1]:2222` gives alias `::1`, `Port 2222`) | Brackets kept or dropped in the alias? Is the port after a bracket accepted? |
| 4 | Malformed destinations: `host:` (empty port, the branch writes an empty `Port`), `[::1` (no closing bracket), `host:1:2` | Error, or written as typed? |
| 5 | Several unquoted shell characters (`a;b\|c`): the branch names the first | First, or all? |
| 6 | `-L` with fewer than three parts (`-L 8080`): the branch writes the value as typed | Error, or as typed? |
| 7 | A file indented by one space only; a file with mixed line endings; a file holding only blanks | Indentation, line end and placement? |
