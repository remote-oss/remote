# Task card coverage-02: acceptance rows name the acceptance criteria they prove (#142)

Why: #464; athena's ruling on #142, item 2. Every acceptance row's name starts with the AC id(s) it proves, so that
`tools/check-coverage` (card coverage-01) can count coverage mechanically. A feature-level cite such as `F-2409:` no
longer counts. This card renames the 54 acceptance rows that cite a feature, a BR or a section but no AC. The mapping is
decided below, row by row (daedalus, from the spec issues). The worker applies it and decides nothing. Reviewing
coder: `remote-coding-worker-1`.

## 1. The rule for a name

- A row that proves an AC: `<feature> AC-<n>[, AC-<m>…]: <the rest of today's name, unchanged>`. Example: `F-2409 AC-16:
  reuses the server that runs instead of starting another`.
- A row that proves no AC by itself (a library or contract row whose AC needs the editor window): `contracts <section>:
  <the rest>`. Example: `contracts V7: gives a connection token of 32 letters and digits, kept in a file only the user
  reads`. These rows stay. They don't count as AC coverage, and coverage-01's check ignores them.
- Change nothing but the name's prefix: no test code, no description text after the colon.

## 2. The mapping

`file:line` is at main de9e480. Find the row by its name if lines moved.

**`tests/acceptance/server/connection.test.ts`**

| Line | Today's prefix and name (start) | New prefix |
|---|---|---|
| 74 | `F-2102: two windows share one ssh login and one SOCKS port` | `F-2102 AC-13:` |
| 91 | `F-2102: what the first window stores for the server reaches the second` | `contracts S9:` |
| 120 | `F-2102.BR-7: killing the server ends its ssh session on the host and its record` | `F-2102 AC-6:` |
| 133 | `F-2102.BR-7: killing a server that does not run is a success, silently` | `F-2102 AC-16:` |
| 140 | `F-2601: a TEST-NET host ends as a failed login of a kind that says so, with its hints, within the bound` | `contracts S5:` |
| 162 | `F-2101: a program that is not there is told as a failed start of a vanished client` | `F-2101 AC-19:` |
| 191 | `F-2305: the question is shown as a masked input, and the answer lets the login finish` | `F-2307 AC-3:` (the row is about a passphrase: F-2307, not F-2305) |
| 215 | `F-2305: the question closes for every window once it is answered` | `F-2102 AC-10:` |
| 233 | `F-2305: the passphrase is kept in no record and no file the helper wrote` | `F-2307 AC-24:` |
| 288 | `F-2307: yes to the question lets the login finish` | `F-2305 AC-11:` (the row is about a host key: F-2305, not F-2307) |
| 293 | `F-2307: the question is a pick of the fingerprint` | `F-2305 AC-8:` |
| 301 | `F-2307: no refuses the host, as a rejected host key` | `F-2305 AC-12:` |

Also rename the two `describe` titles of that file: `F-2305 a passphrase asked by ssh …` becomes `F-2307 a passphrase
asked by ssh …`, and `F-2307 a host key that ssh does not know` becomes `F-2305 a host key that ssh does not know`.

**`tests/acceptance/server/shared-session.test.ts`**

| Line | Today's name (start) | New prefix |
|---|---|---|
| 62 | `F-2102: probes, installs and starts the server over the session, with the one login of the session` | `F-2102 AC-10:` |
| 97 | `F-2102: a text input arrives as its UTF-8 bytes` | `contracts S10:` |
| 112 | `F-2102: a binary file input arrives byte for byte, every byte value included` | `contracts S10:` |
| 134 | `F-2102: runs the scripts of two callers one after the other on the session` | `contracts S9:` |
| 152 | `F-2102: sees an environment variable of the run and the exit status of the script` | `contracts S10:` |

**`tests/acceptance/server/probe.test.ts`**

| Line | Today's name (start) | New prefix |
|---|---|---|
| 60 | `F-2401: finds an Alpine host to be a musl Linux with the tools of BusyBox` | `F-2401 AC-2:` |
| 74 | `F-2401: reads the user's home, the login shell and the temporary folder` | `contracts V2:` |
| 82 | `F-2401: reads the host's architecture as the editor names it` | `F-2401 AC-11:` |

**`tests/acceptance/server/start.test.ts`**

| Line | Today's name (start) | New prefix |
|---|---|---|
| 103 | `F-2409: starts the server and reads its port from the ready line` | `F-2409 AC-1:` |
| 111 | `F-2409: picks a free port when the range is empty` | `contracts V7:` |
| 121 | `F-2409: gives a connection token of 32 letters and digits, kept in a file only the user reads` | `contracts V7:` |
| 136 | `F-2409: passes the options of the contract, telemetry off, and no licence flag before acceptance` | `contracts V7:` |
| 153 | `F-2409: adds the licence flag once the user accepted the terms` | `contracts V7:` |
| 162 | `F-2409: replaces a bind host it rejects with the loopback address, and says so` | `F-2409 AC-7:` |
| 177 | `F-2409: reuses the server that runs instead of starting another` | `F-2409 AC-16:` |
| 184 | `F-2409: refuses a reversed port range before it asks the host anything` | `F-2409 AC-13:` |
| 192 | `F-2409: fails to start when no server is installed` | `contracts V7:` |
| 199 | `F-2409: reports a server that exits at once as a failed start` | `contracts V7:` |
| 206 | `F-2409: reports a server that lacks libraries on the host as missing prerequisites` | `F-2401 AC-3:` |
| 213 | `F-2409: gives up on a server that never reports a port, after the time it was given` | `F-2409 AC-25:` |

**`tests/acceptance/server/install.test.ts`**

| Line | Today's name (start) | New prefix |
|---|---|---|
| 79 | `F-3902.6: removes a copied archive after the install` | `contracts V4:` |

The other `F-2407:` rows of this file are F-2407's (not in slice 1) and keep their names.

**`tests/acceptance/server/real-server.test.ts`**

| Line | Today's name (start) | New prefix |
|---|---|---|
| 287 | `F-2403: the host downloads the archive itself and unpacks it where the plan says` | `F-2403 AC-5:` |
| 300 | `F-2403: the unpacked server has its folders and an executable launcher` | `contracts V4:` |
| 316 | `F-2409: the real server starts on musl and reports its port` | `F-2401 AC-2:` |
| 323 | `F-2409: the server answers with the commit it was built from` | `F-3902 AC-1:` |
| 363 | `F-2403: the host cannot download, so the client downloads and the archive is copied to the host` | `F-2403 AC-11:` |
| 376 | `F-2403: the archive the client kept is the one the product published` | `F-3902 AC-1:` |
| 384 | `F-3902.6: the copy on the host is gone after the install` | `contracts V4:` |
| 391 | `F-2409: the server installed from the copy starts and answers with its commit` | `F-2403 AC-11:` |

**`tests/acceptance/server/fetch-tools.test.ts`** (landed after the first mapping; themis on #465)

| Line | Today's name (start) | New prefix |
|---|---|---|
| 192 | `F-2403: the host has the wget this variant names` | `contracts harness:` (it checks the fixture) |
| 199 | `F-2403: the host has the curl this variant names` | `contracts harness:` |
| 203 | `F-2401: the probe lists exactly the downloaders of this variant` | `contracts V2:` |
| 217 | `F-2401: the probe tells a BusyBox wget from a GNU one` | `contracts V2:` |
| 225 | `F-2403: the host downloads the archive and installs it` | `F-2403 AC-23:` |
| 233 | `F-2403: the install folder holds the launcher of the stand-in` | `contracts V4:` |
| 246 | `F-2403 BR-8: a wgetrc with an unreachable proxy is kept out with --no-config` | `F-2403 AC-15:` |
| 255 | `F-2403 BR-8: the same wgetrc is read when the configuration files are used` | `F-2403 AC-16:` |
| 269 | `F-2403 BR-8: a curlrc with an unreachable proxy is kept out with -q` | `F-2403 AC-15:` |
| 278 | `F-2403 BR-8: the same curlrc is read when the configuration files are used` | `F-2403 AC-16:` |
| 292 | `F-2403: with no downloader and the client as a fallback the client downloads and copies` | `F-2403 AC-11:` |
| 309 | `F-2403, S043: with no downloader and no fallback the install fails as no downloader` | `F-2403 AC-9:` |

Also rename that file's `describe` title `F-2403 the download with the tool …` to `the download with the tool …`.

**`tests/acceptance/suite-failure/failure-window.test.ts`**

| Line | Today's name (start) | New prefix |
|---|---|---|
| 49 | `F-2601 5.0: the window is one of the failing connects` | `contracts harness:` (it checks the launch, not the product) |

## 3. Test table

No new rows. The gates:
- `pnpm test:acceptance:server` passes, with the same number of passing rows as on main;
- the VSCodium run isn't needed (one name changes there, and `tsc` checks it);
- this command, which applies coverage-01's rule 6 (an acceptance row or cite that starts with a slice-1 feature id
  followed by anything but ` AC-` or `.AC-`), prints nothing. Paste its output (empty) in the PR:

  ```sh
  F='F-(2001|2101|2102|2201|2202|2206|2301|2304|2305|2306|2307|2401|2403|2409|2501|2502|2601|3902)'
  grep -rhoE "\\bit\\(\\s*['\"\`]$F[^'\"\`]*" tests/acceptance --include=*.test.ts | grep -vE "^it\\(\\s*['\"\`]$F[ .]AC-"
  grep -hoE "\"cite\": *\"[^\"]*\"" tests/acceptance/suite-failure/cases.json | grep -vE "$F[ .]AC-"
  ```

  At main de9e480 (before this card), the first line finds 54 rows (themis on #465): the 42 of the first mapping and
  the 12 of `fetch-tools.test.ts`.

## 4. Gates and review

PR title `tests: acceptance rows name the criteria they prove (card coverage-02, #142)`.

## 5. Open rows

None.
