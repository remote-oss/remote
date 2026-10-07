# Task ssh-01: the argument builder (S2)

Base: branch `feature/lib-ssh-pure` (3c0463a). The modules exist; this card writes their tests and fixes what fails.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-ssh/src/arguments/target.ts` | `validateTarget` |
| `packages/lib-ssh/src/arguments/invocation.ts` | `buildInvocation`, `expandHome` |
| `packages/lib-ssh/test/unit/target.test.ts` | new |
| `packages/lib-ssh/test/unit/invocation.test.ts` | new |

Nothing else may change (no `package.json`, `tsconfig*`, `coverage.json`, `choices.ts`, other modules). No fixtures: every input is an inline literal of the table.

## 2. Contract

`contracts.md` section 3, heading "### S2 argument-builder". The contract governs; where the branch differs, the row is in section 6.

- `validateTarget(target: SshTarget): TargetProblem | undefined`
- `buildInvocation(request: InvocationRequest): Invocation`
- `expandHome(file: string, homeFolder: string): string`

Base request for the `buildInvocation` rows (a row changes only what it names): `target {host:'alias'}`, `settings {configFile:'', connectTimeout:15, permitPtyAllocation:false, remoteCommandInEffect:false}`, `effective {hostName:'h.invalid', user:'dev', port:'22', localForwards:[]}`, `programs {ssh:'/x/ssh', scp:'/x/scp'}`, `homeFolder '/home/dev'`, `purpose 'connection'`. Argument rows assert that the named adjacent pair or single argument is present (position among options is not asserted, see section 6 row 1) and that the host is the last argument unless the row says otherwise.

## 3. Test table

`TP(kind, reason, char)` means `{kind, reason, character}`. A row marked (each) is one `it` per listed input, the input in the test name.

| Cite | Given (`validateTarget`) | Expected |
|---|---|---|
| F-2205.BR-1 / AC-2 | host `-oProxyCommand=x` | TP(invalidHost, S119, `-`) |
| F-2205.7.E1 | (each) host `-`, `--x` | TP(invalidHost, S119, `-`) |
| F-2205.BR-2 | host `-a%b` (leading dash and a forbidden character) | TP(invalidHost, S119, `-`) |
| F-2205.AC-4 | (each) host `a\b`, `a'b`, `a"b`, ``a`b``, `a!b`, `a%b` | TP(invalidHost, S120, that character) |
| F-2205.AC-5 | (each) host `a%b'c` / ``a!b`c`` / ``a`%b`` / ``a!%\"'`b`` | character `'` / `` ` `` / `` ` `` / `\` |
| F-2205.AC-6 | host `h.invalid`, user `-u` | TP(invalidUser, S121, `-`) |
| F-2205.AC-7 | (each) user `u\x`, `u'x`, `u"x`, ``u`x``, `u!x`, `u%x` | TP(invalidUser, S122, that character) |
| F-2205.BR-3 (user) | user `u%x'y` | TP(invalidUser, S122, `'`) |
| F-2205.AC-8 | host `-h`, user `-u` | TP(invalidHost, S119, `-`) |
| F-2205.AC-8 | host `a%b`, user `u%` | TP(invalidHost, S120, `%`) |
| F-2205.AC-8 | host `-h`, user `u%` | TP(invalidHost, S119, `-`) |
| F-2205.AC-8 | host `a b`, user `-u` | TP(invalidUser, S121, `-`) |
| F-2205.AC-9 | host `a%b`, user `u`, port 2222 | TP(invalidHost, S120, `%`); the port is not part of the host |
| F-2205.7.E10 | (each) host `.ab`, `_ab`, `~ab`, `+ab`, `/ab`, `1ab`, `ab-`, `a-b`, `a*b`, `a?b`, `a#b`, `a[b]`, `a=b`, `a^b`, `a:b`, `äb` | `undefined` |
| F-2205.BR-1 | (each) host `a;b`, `a b`, `a$b`, `a(b`, `a<b`, `a{b`, `a,b` | `undefined` (ssh judges them later) |
| F-2205.7.E10 | (each) user ` `, `$`, `.u`, `1u`, `u-x`, `u*x`, `u?x`, `u#x`, `u,x`, `u[x`, `u=x`, `u;x`, `u(x`, `u<x` | `undefined` |
| F-2205.7.E10 | host `-h`, user `` (empty) | TP(invalidHost, S119, `-`) |
| F-2205.7.E10 | host `` (empty), user `u` | `undefined` |
| F-2205.7.E10 | host `h.invalid`, no user; host `h.invalid`, user `` | `undefined` (two rows) |

| Cite | Given (`buildInvocation`) | Expected |
|---|---|---|
| F-2201.AC-4 | `configFile ''` | no `-F` anywhere |
| F-2201.AC-11 | `configFile '/etc/custom/config'` | pair `-F`, `/etc/custom/config` |
| F-2201.BR-3 | `configFile '~/ssh_alt'` | pair `-F`, `/home/dev/ssh_alt` |
| F-2201.BR-3 | `configFile '~'` | pair `-F`, `/home/dev` |
| F-2201.BR-3 | (each) `configFile` `config`, `$HOME/x`, `${env:HOME}/x` | pair `-F`, the same text unchanged |
| F-2201.BR-2 | `configFile '   '` (spaces only) | pair `-F`, `   ` |
| F-2201.BR-3 | `expandHome('~/a b', '/home/dev')`, `expandHome('~x', '/home/dev')`, `expandHome('/abs', '/home/dev')` | `/home/dev/a b`, `~x`, `/abs` |
| F-2106.BR-1 | purpose connection, (each) `permitPtyAllocation` `false`, `0`, `''`, `null`, `undefined` | `-T` present once |
| F-2106.BR-1 | purpose connection, (each) `permitPtyAllocation` `true`, `1`, `'yes'` | no `-T` |
| F-2106.BR-8 | (each) purpose tunnel, oneShot, `permitPtyAllocation false` | no `-T` |
| F-2105.BR-2 | (each) purpose connection, tunnel, oneShot; `effective.connectTimeout` absent | pair `-o`, `ConnectTimeout=15` |
| F-2105.BR-2 | `effective.connectTimeout '21'` | no argument starts with `ConnectTimeout` |
| F-2105.BR-2 | `effective.connectTimeout '0'` | no argument starts with `ConnectTimeout` |
| F-2105.BR-8 | every purpose, every request above | no argument starts with `ServerAlive` |
| F-2107.BR-1 | (each) purpose connection, tunnel, oneShot; `effective.remoteCommand 'echo hi'`, `remoteCommandInEffect false` | pair `-o`, `RemoteCommand=none` |
| F-2107.BR-1 | `effective.remoteCommand 'echo hi'`, `remoteCommandInEffect true` | no `RemoteCommand` argument |
| F-2107.BR-1 | `effective.remoteCommand` absent, `remoteCommandInEffect false` | no `RemoteCommand` argument |
| F-2109.BR-3 | (each) purpose connection, tunnel, oneShot | exactly one `-v` |
| F-2104.BR-1 | forward `{kind:'dynamic', localPort:51000}` | pair `-D`, `127.0.0.1:51000` |
| F-2104.BR-1 | forward `{kind:'local', localPort:51001, remotePort:8080}` | pair `-L`, `51001:127.0.0.1:8080` |
| F-2410 | forward `{kind:'socket', localPort:51002, socketPath:'/tmp/code-x.sock'}` | pair `-L`, `51002:/tmp/code-x.sock` |
| F-2104.BR-1 | two forwards (dynamic then local), then none | both pairs present in the given order; none: no `-D`, no `-L` |
| F-2205.BR-4 | target `{host:'alias'}` | last argument `alias`; no `-l`, no `-p` |
| F-2205.7.E10 | target `{host:'a b'}` | last argument is the single string `a b` |
| F-2205.7.E10 | target `{host:'h', user:''}` | no user argument |
| S2 contract | purpose oneShot, `remoteProgram 'uname -s'` | last two arguments `alias`, `uname -s` (one argument, unquoted) |
| S2 contract | purpose oneShot, `remoteProgram` absent; purpose connection | last argument `alias` |
| S2 contract | purposes connection, tunnel, oneShot, `programs.ssh '/x/ssh'` | `program '/x/ssh'` |
| F-2309.BR-2 | every purpose | `environment` deep-equals `{}` |
| F-2405.BR-6 | purpose copy, `copy {localFile:'/tmp/boot.sh', remotePath:'/tmp/x/boot.sh'}`, `configFile ''` | `program '/x/scp'`, `arguments ['/tmp/boot.sh','alias:/tmp/x/boot.sh']` |
| F-2405.BR-6 | purpose copy, `configFile '/etc/custom/config'` | `arguments ['-F','/etc/custom/config','/tmp/boot.sh','alias:/tmp/x/boot.sh']` |
| F-2405.BR-6 | purpose copy | no `-T`, `-v`, `-o`, `-D`, `-L` |
| ADR-0004.2 | for every purpose, with and without `configFile`, `connectTimeout`, `remoteCommand`, one forward of each kind | no argument starts with `ControlMaster`, `ControlPath`, `ControlPersist`, `IdentityFile`, `IdentityAgent`, `ProxyCommand`, `ProxyJump`, `UserKnownHostsFile`, `StrictHostKeyChecking`, `HostKeyAlias`; no `-i`, `-J`, `-S`, `-M`; every `-o` value is `ConnectTimeout=<n>` or `RemoteCommand=none` |

## 4. Rule for the worker

- Write all tests from the table first, one `it` per row (per input for an (each) row), the test name starting with the Cite. Run `pnpm test:unit`; fix the module only where a row fails, and only to meet that row.
- Never change an exported signature or the contract. Do not add behaviour or tests for anything in section 6.
- Comments only where the Google TypeScript guide requires them; no F-/R-/D- ids or origin framing in code comments or JSDoc (ids may appear in test names). Every identifier, properties included, has at least four characters. No duplicated code (use a table array and one loop per table); no unused exports.
- Coverage for the two source files at least 90 % lines, 85 % branches, 90 % functions. A branch no row reaches is reported in the PR, not deleted.
- Run the full gate list: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: remote-coding-worker-1. PR title: `lib-ssh: tests and fixes for the argument builder (task-ssh-01)`. The description answers one line each: R1 (every comment deletable?), R2 (names say what values are?), R3 (near-copies?), R4 (callers for everything added, branches reachable?), R6 (coverage before and after, exclusions); R5 is answered by a list mapping each Cite to its test name. It also lists the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

| # | Case | Question |
|---|---|---|
| 1 | Position of options in the list; spelling of the user and port arguments. The branch emits `-l <user>` and `-p <port>` (`invocation.ts:108-113`); the contract says only "host and user go in as their own arguments" and never mentions a port | Which spelling (`-l`/`-p` or `-o User=`/`-o Port=`), and is the order fixed? |
| 2 | Terminal mode: the contract says the remote program is `sh`; the branch ignores `remoteProgram` for purpose `connection` (`invocation.ts:115`) | Is terminal mode purpose `oneShot`, or must `connection` accept a remote program? |
| 3 | `copy` with a user, a port or an IPv6 host: the branch adds `-P`, `user@` and `[..]` (`invocation.ts:158-173`); the contract says the same `-F` and the alias | Keep or remove? |
| 4 | Windows home folder with `~/`: `expandHome` joins with `/` (`invocation.ts:140`) | What does `~/x` and `~\x` expand to on Windows? |
| 5 | Invalid `connectTimeout` setting values (0, negative, fraction, NaN) | What is written into `ConnectTimeout=`? |
| 6 | Contract line "bootstrap on standard input, no remote command in shared mode" | Is it the caller's alone (nothing to test here)? |
