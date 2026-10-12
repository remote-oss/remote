# Task card tooling-14: harness host variants, one per login shell and per download tool (#443, the 0.2 gate)

Why: #446 for #443's 0.2 gate (athena; register entry). Today every acceptance row runs on one host: Alpine 3.22, the login
shell BusyBox `sh`, the downloader BusyBox `wget`, and no curl. No row runs bash, zsh, dash, fish, tcsh or csh, or
GNU wget or curl, or a host with no downloader. The user has seen other remote extensions fail exactly there. This card
adds the variants in proteus's measured shape: one image, the variant chosen at container start, and only the rows
that depend on it run per variant. Reviewing coder: `remote-coding-worker-1`; proteus reviews the CI part.

**Depends on ssh-34** (#443's fix; it adds the shells and `HOST_SHELL`). The shell rows of ssh-34 and ssh-35 are this
card's per-shell job.

## 1. Package and file boundary

| File | Change |
|---|---|
| `tests/acceptance/host/Dockerfile` | `curl` and GNU `wget` added to the `apk add` (the shells came with ssh-34) |
| `tests/acceptance/host/start-sshd` | `HOST_FETCH` (section 2) |
| `tests/acceptance/server/host-fixture.ts` | `startHost({shell?, fetch?})` passes `-e HOST_SHELL=…`, `-e HOST_FETCH=…` |
| `tests/acceptance/server/fetch-tools.test.ts` | new: the download rows per tool (section 3) |
| `tests/acceptance/server/variants.ts` | new: the variant lists of section 2 and the variant this process runs, from `HARNESS_HOST_SHELL` and `HARNESS_HOST_FETCH` |
| `package.json` | `test:acceptance:variants` (section 4) |
| `.github/workflows/ci.yml` | the job `acceptance (host variants)` (section 4) |
| `tests/acceptance/README.md` | a section "Host variants" |

## 2. The variants

**Shells** (`HOST_SHELL`, ssh-34): `/bin/sh` (default), `/bin/bash`, `/bin/zsh`, `/usr/bin/dash`, `/usr/bin/fish`,
`/bin/tcsh`, `/bin/csh`, `/bin/mksh`.

**Download tools** (`HOST_FETCH`). `start-sshd` makes the host have exactly these, before sshd starts:

| `HOST_FETCH` | What `start-sshd` does | `command -v wget`, `command -v curl` |
|---|---|---|
| unset or `busybox-wget` (today's) | `apk del` is not used; `rm -f /usr/bin/curl /usr/bin/wget`, then `ln -s /bin/busybox /usr/bin/wget` | `/usr/bin/wget` (BusyBox), none |
| `gnu-wget` | `rm -f /usr/bin/curl` | `/usr/bin/wget` (GNU), none |
| `curl` | `rm -f /usr/bin/wget` | none, `/usr/bin/curl` |
| `none` | `rm -f /usr/bin/wget /usr/bin/curl` | none, none |

Use `rm`, never `apk del`: measured on the pinned image, `apk del wget` puts BusyBox's `/usr/bin/wget` link back. After
`none`, `busybox wget` can still be called by that name, but the script looks for `wget` and `curl` only, so the host has
no downloader as the script sees it. Each variant's fixture asserts both `command -v` lines of the table on the host
before its rows run.

## 3. The download rows (`fetch-tools.test.ts`), per `HOST_FETCH`

**The source.** No network. BusyBox on the pinned image has no `httpd` applet, so the fixture serves the archive with
BusyBox `nc`, started in the container with `docker exec -d`:

```sh
while true; do
  { printf 'HTTP/1.0 200 OK\r\nContent-Length: %s\r\n\r\n' "$(wc -c </srv/server.tar.gz)"; cat /srv/server.tar.gz; } |
    nc -l -p 8099 -s 127.0.0.1 >/dev/null 2>&1
done
```

The archive is a stand-in written by `writeStandInArchive`, copied in with `docker cp` to `/srv/server.tar.gz`. Measured
on the pinned image: BusyBox wget, GNU wget and curl each fetched a 100 000-byte file exactly from this source. The rows
run `transfer` as `real-server.test.ts` does, with `plan.where: 'host'`, the address
`http://127.0.0.1:8099/server.tar.gz` and `verification: ['lengthOnly']`.

| Cite | `HOST_FETCH` | Expected |
|---|---|---|
| F-2403 | `busybox-wget`, `gnu-wget`, `curl` (one `it` each) | `transfer` is `placed` from the host's download, and the install folder holds the stand-in's launcher |
| F-2403 BR-8 | `gnu-wget` with a `~/.wgetrc` of `use_proxy = on`, `http_proxy = http://127.0.0.1:9/`, `no_proxy = none`; `useConfigurationFiles: false` | `placed` (`--no-config` keeps the file out) |
| F-2403 BR-8 | `gnu-wget`, the same `~/.wgetrc`, `useConfigurationFiles: true` | not `placed` by the host (the file was read; measured exit 4) |
| F-2403 BR-8 | `curl` with a `~/.curlrc` of `proxy = 127.0.0.1:9`, `useConfigurationFiles: false` | `placed` (`-q` keeps the file out) |
| F-2403 BR-8 | `curl`, the same `~/.curlrc`, `useConfigurationFiles: true` | not `placed` by the host (the file was read; measured exit 7) |
| F-2403 | `none`, `clientFallback: true` | `placed`, with the phases of the client download and the copy |
| F-2403, S043 | `none`, `clientFallback: false` | the failure `serverDownload` with cause `noDownloader` |
| F-2401 | each variant | the probe's `tools` lists exactly the variant's downloaders, and `busyboxWget` is true only for `busybox-wget` |

The client download of the fallback row fetches from the same source through the test's own forward of 8099 (`ssh
-L` on the harness config), so nothing leaves the machine. The `nc` loop serves one connection at a time, which is
enough for these rows.

## 4. Runs and CI

- `pnpm test:acceptance:variants` runs, one after the other:
  - for each shell: ssh-34's `login-shells.test.ts`, plus `start.test.ts` and `shared-session.test.ts`, on a host
    started with that shell (`HARNESS_HOST_SHELL`);
  - for each download tool: `fetch-tools.test.ts` (`HARNESS_HOST_FETCH`).
  The rest of `server/` runs once, on the default host, in `test:acceptance:server` as today.
- CI: a job `acceptance (host variants)`, parallel to `acceptance-server`, with the same runner and cache, running
  `pnpm test:acceptance:variants`. It runs on every PR (it doesn't download from the network). proteus reviews its
  shape and time. It must stay under 10 minutes; report the measured time in the PR.

## 5. Rule for the worker

As card log-01. The rows need Docker; put the local run's output in the PR, one line per variant with its counts.

## 6. Gates and review

PR title `tests: harness host variants for login shells and download tools (card tooling-14, #443)`.

## 7. Open rows

- Windows and macOS hosts are later (athena, #443).
- A Debian-family host (glibc, GNU coreutils) is not in this card: the tool and shell behaviour it would add is covered
  by the variants above, and glibc is a separate axis of the real server (F-6302).
