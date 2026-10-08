# Task ssh-06: the prompt classifier (S6) and the client locator's decision part (S1)

Base: branch `feature/lib-ssh-pure` (its head), brought to the contract. The modules exist; this card writes their tests and fixes what fails. `locate.ts` imports `pathsFor` and `ClientPlatform` from `config/files.ts` (task ssh-03).

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-ssh/src/prompts/classify.ts` | `classifyPrompt` |
| `packages/lib-ssh/src/client/locate.ts` | `candidates`, `judge`, `scpProgram`, `VERSION_ARGUMENTS` |
| `packages/lib-ssh/test/unit/prompts-classify.test.ts`, `packages/lib-ssh/test/unit/locate.test.ts` | new |
| `packages/lib-ssh/test/fixtures/banners/recorded.json` | new, `{source, text}`: the worker's own `ssh -V` output (stderr and stdout joined) |

Nothing else may change. Fixture origin: recorded with the worker's own OpenSSH (`source` holds the command); the prompt texts are inline literals constructed from the public ssh(1) and ssh_config(5) pages and the host-key question forms OpenSSH prints (the worker may check them against `SSH_ASKPASS` recordings made against 127.0.0.1 only).

## 2. Contract

`contracts.md` section 3, headings "### S6 prompt-classifier" (rules 1 to 5, first match wins) and "### S1 client-locator (decision part)". The contract governs. Branch signatures:

- `classifyPrompt(text: string, displayHost: string): PromptSurface`; surfaces `fingerprintPick` and `continuationPick` carry `title`, `placeholder`, `items`; `maskedInput` carries `placeholder`.
- `candidates(settingValue: string, environment: {searchPath: string, programFilesFolder: string}, platform: ClientPlatform): {program, origin}[]`; `E(path, files)` below stands for `{searchPath: path, programFilesFolder: files}`.
- `judge(exitStatus: number | undefined, output: string): boolean`
- `scpProgram(accepted: ClientCandidate, platform: ClientPlatform): string`, `VERSION_ARGUMENTS`.

Notation. `PICK(host, fp)` is `{surface:'fingerprintPick', title:{id:'S001', values:[host, fp]}, placeholder:{id:'S013', values:[]}, items:[{label:{id:'S028', values:[]}, answer:'yes'}, {label:{id:'S015', values:[]}, answer:'no'}]}`. `MASK(t)` is `{surface:'maskedInput', placeholder:{text:t}}`, `MASKID(id, values)` the same with `{id, values}`. `Q` is `Are you sure you want to continue connecting (yes/no/[fingerprint])? `. `A` is `The authenticity of host 'h.invalid (192.0.2.1)' can't be established.` and a line end. Display host is `myalias`. (each) means one `it` per listed input.

## 3. Test table

Rows marked (provisional) rest on a spec reading, not a confirmed answer; they are tested like any other row.

| Cite | Given (`classifyPrompt` text) | Expected |
|---|---|---|
| F-2305.AC-8 | `A` + `ED25519 key fingerprint is SHA256:abcDEF123+/xyz.` + line end + `This key is not known by any other names.` + line end + `Q` | PICK(myalias, `SHA256:abcDEF123+/xyz`) |
| F-2305.BR-2 | (each) `<TYPE> key fingerprint is SHA256:x.` + line end + `Q`, with TYPE `RSA`, `ECDSA`, `ECDSA-SK`, `ED25519` | PICK(myalias, `SHA256:x`) |
| F-2305.BR-2 | (each) `ED25519 key fingerprint is SHA256:x.` + line end + one of `Are you sure you want to continue connecting (yes/no)? ` or `Are you sure you want to continue connecting?` | PICK(myalias, `SHA256:x`) |
| F-2305.AC-10 | `RSA key fingerprint is MD5:aa:bb:cc.` + line end + `Q` | PICK(myalias, `MD5:aa:bb:cc`) |
| F-2305.AC-9 | the AC-8 text with displayHost `host.example` | `values[0]` is `host.example` |
| F-2305.AC-43 | `A` + `ED25519 key fingerprint is SHA256:abc` (no final full stop) + line end + `Q` | MASK(one space + the whole text) |
| F-2305.BR-2 | (each) the colon forms `ED25519 key fingerprint is: SHA256:abc.` and `...is: SHA256:abc` with `A` before and `Q` after | MASK(one space + the whole text) |
| F-2305.BR-2 | (each) the fingerprint line alone; `Q` alone; `Q` first, then the fingerprint line | MASK(one space + the whole text) |
| F-2305.AC-39 | `WARNING: the key for IP differs.` + line end + `Offending key for IP in /home/dev/.ssh/known_hosts:3` + line end + `Matching host key in /home/dev/.ssh/known_hosts:5` + line end + `Are you sure you want to continue connecting (yes/no)? ` | `{surface:'continuationPick', title:{text: the first three lines joined by a line end}, placeholder:{id:'S012', values:[]}, items: the two items of PICK}` |
| F-2305.BR-2 | the Offending and Matching lines and the question, no warning line | continuationPick, title the two lines |
| F-2305.BR-2 | (each) warning line + question only; Offending line + question only | MASK(one space + the whole text) |
| F-2305.BR-2 | fingerprint line, Offending line, Matching line, question | PICK (first rule wins) |
| F-2307.BR-3 | `Enter passphrase for key '/home/dev/.ssh/id_ed25519': ` | MASKID(`S064`, `['']`) |
| F-2307.BR-3 | ` Add key /home/dev/.ssh/id_x (comment) to agent? ` | MASK(the text unchanged) |
| F-2306.BR-2 | (each) `lab@127.0.0.1's password: `; `Login for bob's password: `; ` (lab@h) lab@h's password: `; `lab@h's password:` | MASKID(`S066`, `['lab@127.0.0.1']`), `['bob']`, `['lab@h']`, `['lab@h']` |
| F-2306.BR-2 | (each) `Password: `; `Password:`; `Your Password: `; `Password: (or press Enter) `; `Password: Verification code: ` | MASKID(`S065`, `[]`) |
| F-2306.BR-2 | `lab@h's password: Verification code: ` | MASKID(`S066`, `['lab@h']`) |
| F-2306.BR-2 | (each) `Verification code: `; `Verification code:`; `Verification code: (6 digits) ` | MASK(`Enter verification code`) |
| F-2306.BR-2 | (each, with ssh's leading space) ` password: `; ` Password for lab: `; ` Verification Code: `; ` verification code: `; ` Verification code for lab: `; ` OTP: `; ` Current password:`; ` New password:`; ` Retype new password:`; ` Changing password for lab.` + line end + `Current password: ` | MASK(the same text, unchanged) |

| Cite | Given (S1) | Expected |
|---|---|---|
| F-2101.BR-1 | `candidates('', E('/usr/bin:/bin', ''), 'linux')` | `[{program:'ssh', origin:'path'}]` |
| F-2101.BR-1 | `candidates('/opt/ssh/bin/ssh', E('/usr/bin', ''), 'linux')` | setting first, then path: `[{program:'/opt/ssh/bin/ssh', origin:'setting'}, {program:'ssh', origin:'path'}]` |
| F-2101.BR-1 | `candidates('', E('/usr/bin', ''), 'macOS')` | `[{program:'ssh', origin:'path'}]` |
| F-2101.BR-1 | `candidates('', E('C:\Windows\System32', 'C:\Program Files'), 'windows')` | `[{program:'ssh.exe', origin:'path'}, {program:'C:\Program Files\Git\usr\bin\ssh.exe', origin:'gitForWindows'}]` |
| F-2101.BR-1 | `candidates('C:\x\ssh.exe', E('C:\Windows\System32', 'C:\Program Files'), 'windows')` | origins in order `setting`, `path`, `gitForWindows`; the setting entry's program is `C:\x\ssh.exe` |
| F-2101.BR-2 | (each) setting `~/bin/ssh`, `$HOME/ssh`, `ssh-custom`, `C:\Program Files\OpenSSH\ssh.exe`, `   ` | the first entry is origin `setting`, program equal to the input |
| F-2101.BR-3 | `VERSION_ARGUMENTS` | `['-V']` |
| F-2101.BR-4 | (each) `judge(0, ...)` with `OpenSSH_9.6p1 Ubuntu-3ubuntu13, OpenSSL 3.0.13 30 Jan 2024`; `openssh_9.0p1`; `OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2`; `OpenSSH_6.5p1, OpenSSL 1.0.1 14 Mar 2012` | true |
| F-2101.BR-4 | `judge(0, <recorded banner>)` | true |
| F-2101.Q2 | `judge(0, '')` | false |
| F-2101.BR-5 | (each) `judge(1, 'OpenSSH_9.6p1')`; `judge(255, 'OpenSSH_9.6p1')`; `judge(undefined, 'OpenSSH_9.6p1')`; `judge(undefined, '')` | false |
| F-2101.BR-5 | (each) `judge(0, ...)` with `Plink: Release 0.80`; `ssh: command not found`; `Open SSH 9`; a single blank-and-newline text | false |
| F-2405.BR-6 | `scpProgram({program:'/opt/ssh/bin/ssh', origin:'setting'}, 'linux')`; `({program:'/opt/s/ssh', origin:'setting'}, 'macOS')` | `/opt/ssh/bin/scp`; `/opt/s/scp` |
| F-2405.BR-6 | `({program:'ssh', origin:'path'}, 'linux')`; `({program:'ssh-custom', origin:'setting'}, 'linux')` | `scp`; `scp` |
| F-2405.BR-6 | `({program:'C:\Tools\OpenSSH\ssh.exe', origin:'setting'}, 'windows')`; `({program:'ssh', origin:'path'}, 'windows')`; `({program:'C:\Program Files\Git\usr\bin\ssh.exe', origin:'gitForWindows'}, 'windows')` | `C:\Tools\OpenSSH\scp.exe`; `scp.exe`; `C:\Program Files\Git\usr\bin\scp.exe` |
| F-2405.BR-6 | `scpProgram({program:'ssh.exe', origin:'path'}, 'windows')` | `scp.exe` |
| F-2307.BR-3 | (each) `Enter passphrase for /home/dev/.ssh/id_x: `; `Enter PIN for ED25519-SK key /home/dev/.ssh/id_sk: ` | MASK(the text, which already starts with no space, plus one leading space) |
| F-2101.BR-1 (lead 2026-10-07) | `candidates('', E('', ''), 'linux')` | `[]` |
| F-2101.BR-1 (lead 2026-10-07) | `candidates('', E('', 'D:\Apps'), 'windows')` | `[{program:'D:\Apps\Git\usr\bin\ssh.exe', origin:'gitForWindows'}]` |
| F-2101.BR-1 (lead 2026-10-07) | `candidates('', E('C:\Windows', ''), 'windows')` | `[{program:'ssh.exe', origin:'path'}]` |
| F-2306.BR-2.4 (provisional) | ` Verification code for x: ` (already starts with a space) | MASK(the text unchanged) |
| S6 rule 5 (provisional) | `` (empty) | MASK(` `) |
| F-2306.BR-2.1 (provisional) | `'s password: ` | MASKID(`S066`, `['']`) |

## 4. Rule for the worker

- Record the banner fixture first; write all tests from the table, one `it` per row (per input for an (each) row), the name starting with the Cite. Run `pnpm test:unit`; fix a module only where a row fails and only to meet that row.
- Never change an exported signature or the contract. Do not add behaviour or tests for anything in section 6.
- Comments only where the Google TypeScript guide requires them; no F-/R-/D- ids or origin framing in code comments or JSDoc (ids may appear in test names). Every identifier at least four characters, properties included. No duplicated code (table loops, `PICK`/`MASK` as small helpers); no unused exports.
- Coverage for both files at least 90 % lines, 85 % branches, 90 % functions; report unreached branches, do not delete them.
- Full gate list: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: remote-coding-worker-1. PR title: `lib-ssh: tests and fixes for the prompt classifier and client locator (task-ssh-06)`. The description answers R1 to R4 and R6 in one line each, and R5 by a list mapping each Cite to its test name; it states the OpenSSH version of the recording, lists the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

None: every row is decided in section 3.
