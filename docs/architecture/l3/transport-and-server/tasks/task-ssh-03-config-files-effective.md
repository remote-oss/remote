# Task ssh-03: files in effect and the `ssh -G` reader (S4)

Base: branch `feature/lib-ssh-pure` (its head), brought to the contract. The modules exist; this card writes their tests and fixes what fails. This card also owns the shared test helper that task ssh-02 uses.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-ssh/src/config/files.ts` | `filesInEffect`, `pathsFor`, the `ConfigFileReader` port |
| `packages/lib-ssh/src/config/effective.ts` | `parseEffectiveOptions` |
| `packages/lib-ssh/test/unit/files.test.ts`, `packages/lib-ssh/test/unit/effective.test.ts` | new |
| `packages/lib-ssh/test/unit/memory-reader.fixture.ts` | new helper `memoryReader(map)`: a `ConfigFileReader` over a path-to-text map; `listFolder` is derived from the keys |
| `packages/lib-ssh/test/fixtures/effective/recorded.json`, `bare.json` | new, shape `{source, text}` |

Nothing else may change. Fixture origin: recorded with the worker's own OpenSSH against 127.0.0.1 and TEST-NET-1 only. Config used (`rec.cfg`):

```
Host recorded
  HostName 127.0.0.1
  User dev
  Port 2222
  ConnectTimeout 21
  RemoteCommand echo "hi there"
  LocalForward 8080 127.0.0.1:80
  LocalForward 8081 127.0.0.1:81
Host bare
  HostName 192.0.2.10
  User dev
```

Command `ssh -G -F rec.cfg <alias>` for `recorded` and `bare`. Keep only the lines whose keyword is `hostname`, `user`, `port`, `connecttimeout`, `remotecommand`, `localforward` (the sanitising step; no account name or path may remain), and put the `ssh -V` banner and the command in `source`. `ssh -G` makes no connection.

## 2. Contract

`contracts.md` section 3, heading "### S4 config-model (parser and writer)", operations `filesInEffect` and `effectiveOptions` ("`ConnectTimeout`, `RemoteCommand`, `HostName`, `User`, `Port`, `LocalForward` as OpenSSH computes them (`ssh -G` through S3); failure `parseError`"). The contract governs. The pure half of `effectiveOptions` is the reader of the printed text; running `ssh -G` belongs to S3, and its argument list (`buildOptionsQuery`) is task ssh-01's; neither is in this card. Branch signatures:

- `filesInEffect(configFile: string, locations: ClientLocations, reader: ConfigFileReader): FileInEffect[]`
- `pathsFor(platform: ClientPlatform): path.PlatformPath`
- `parseEffectiveOptions(text: string): {options: EffectiveOptions} | {parseError: string}`

`ClientLocations = {homeFolder, platform: 'linux'|'macOS'|'windows', programDataFolder?}`. A `FileInEffect` is `{file, role: 'user'|'system'|'configured', includeBase, exists}`; `exists` is true when the port returns text. (each) means one `it` per listed input.

## 3. Test table

Rows marked (provisional) rest on a spec reading, not a confirmed answer; they are tested like any other row.

Default for `filesInEffect` rows: `locations {homeFolder:'/home/dev', platform:'linux'}`; U is `/home/dev/.ssh/config`, Y is `/etc/ssh/ssh_config`.

| Cite | Given (`filesInEffect`) | Expected |
|---|---|---|
| F-2201.BR-1 / AC-1 | `configFile ''`, port holds U and Y | `[{file:U, role:'user', includeBase:'/home/dev/.ssh', exists:true}, {file:Y, role:'system', includeBase:'/etc/ssh', exists:true}]` |
| F-2201.AC-3 | `configFile ''`, port holds Y only | the same two entries, U with `exists:false`, Y `exists:true` |
| F-2201.AC-3 | `configFile ''`, port holds U as `''` and Y | U `exists:true`; Y `exists:true` |
| F-2201.BR-2 | `configFile '/srv/ssh/custom'`, file present | exactly `[{file:'/srv/ssh/custom', role:'configured', includeBase:'/srv/ssh', exists:true}]` |
| F-2201.BR-2 | `configFile '/srv/ssh/custom'`, file missing | one entry, `exists:false`; no U, no Y |
| F-2201.BR-3 | `configFile '~/alt'` | `file '/home/dev/alt'`, `includeBase '/home/dev'`, role `configured` |
| F-2201.BR-3 | `configFile '~'` | `file '/home/dev'`, `exists:false` when the port returns nothing for a folder |
| F-2201.BR-3 | (each) `configFile` `rel/config`, `$HOME/x`, `${env:HOME}/x` | one `configured` entry, `file` equal to the input |
| F-2201.BR-2 | `configFile '   '` (spaces) | one `configured` entry, `file '   '` |
| F-2201.BR-6 | call, replace the port's content, call again | second result reflects the new `exists` |
| F-2201.12 (Windows) | `{homeFolder:'C:\Users\dev', platform:'windows', programDataFolder:'C:\ProgramData'}`, `configFile ''` | user `C:\Users\dev\.ssh\config`, includeBase `C:\Users\dev\.ssh`; system `C:\ProgramData\ssh\ssh_config`, includeBase `C:\ProgramData\ssh` |
| F-2201.12 (Windows) | the same, `configFile 'C:\cfg\mine'` | one `configured` entry, `file 'C:\cfg\mine'`, includeBase `C:\cfg` |
| F-2201.Q4 (lead 2026-10-07) | (each) the Windows locations, `configFile` `~\cfg`; `~/cfg`; `C:/cfg/mine` | one `configured` entry, `file` `C:\Users\dev\cfg`; `C:\Users\dev\cfg`; `C:/cfg/mine` |
| F-2202.12 (provisional) | `{homeFolder:'C:\Users\dev', platform:'windows'}` (no `programDataFolder`), `configFile ''` | system `C:\ProgramData\ssh\ssh_config` |
| F-2201.12 (provisional) | `{homeFolder:'/Users/dev', platform:'macOS'}`, `configFile ''` | user `/Users/dev/.ssh/config`; system `/etc/ssh/ssh_config` |
| S4 contract | `pathsFor('windows').sep`, `pathsFor('linux').sep`, `pathsFor('macOS').sep` | `\`, `/`, `/` |

| Cite | Given (`parseEffectiveOptions`) | Expected |
|---|---|---|
| F-2105.BR-1 | fixture `recorded.json` text | `{options:{hostName:'127.0.0.1', user:'dev', port:'2222', connectTimeout:'21', remoteCommand:'echo "hi there"', localForwards:['8080 [127.0.0.1]:80','8081 [127.0.0.1]:81']}}` |
| F-2105.BR-2 | fixture `bare.json` text (prints `connecttimeout none`, no `remotecommand`) | `{options:{hostName:'192.0.2.10', user:'dev', port:'22', localForwards:[]}}` with no `connectTimeout` and no `remoteCommand` key |
| F-2105.BR-2 | lines `hostname h`, `user u`, `port 22`, `connecttimeout 0` | `connectTimeout '0'` (zero is a value) |
| F-2107.BR-1 | the three basic lines plus `remotecommand none` | no `remoteCommand` key |
| F-2107.BR-1 | the three basic lines plus `remotecommand sh -c 'a  b'` | `remoteCommand "sh -c 'a  b'"` (inner blanks kept) |
| F-2202.BR-21 | the three basic lines plus `localforward 1 [127.0.0.1]:2` twice, then `localforward 3 [127.0.0.1]:4` | `localForwards` in printed order, three entries |
| F-2202.BR-21 | lines `hostname first`, `hostname second`, `user u`, `port 22` | `hostName 'first'` (first value wins) |
| S4 contract | the three basic lines, then `identityfile ~/x`, `compression no` | only the six known options returned |
| S4 contract | the three basic lines separated by CRLF line ends | same options as with LF |
| S4 contract | blank lines between the basic lines | same options |
| S4 contract | (each) text without `hostname`; without `user`; without `port`; empty text | `parseError` is a non-empty string |
| F-2107.BR-1 (provisional) | the three basic lines plus `remotecommand` with no value | no `remoteCommand` key |
| F-2105.6.2 (provisional) | `HostName h`, `USER dev`, `Port 22` (keywords not in lower case) | `{options:{hostName:'h', user:'dev', port:'22', localForwards:[]}}` |

## 4. Rule for the worker

- Record the two fixtures first; write all tests from the table, one `it` per row (per input for an (each) row), the name starting with the Cite. Run `pnpm test:unit`; fix a module only where a row fails and only to meet that row.
- Never change an exported signature or the contract. Do not add behaviour or tests for anything in section 6.
- Comments only where the Google TypeScript guide requires them; no F-/R-/D- ids or origin framing in code comments or JSDoc (ids may appear in test names). Every identifier at least four characters, properties included. No duplicated code; no unused exports (`knip` counts the test files as entries).
- Coverage for `files.ts` and `effective.ts` at least 90 % lines, 85 % branches, 90 % functions; report unreached branches, do not delete them.
- Full gate list: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: remote-coding-worker-1. PR title: `lib-ssh: tests and fixes for files in effect and the ssh -G reader (task-ssh-03)`. The description answers R1 to R4 and R6 in one line each, and R5 by a list mapping each Cite to its test name; it states the OpenSSH version of the recording, lists the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

None: every row is decided in section 3.
