# Task card tooling-27: a download host for the server install rows (F-2403, F-3902)

Issue: #578. Why: the install rows of batch 6b (F-2403 AC-10, 13, 24, 26; F-3902 AC-3, 14, 16, 19, 21, 23) need a
download source the run controls. It must:
- serve the server archive;
- fail in the ways the specs name: 404, 503, a body that isn't an archive, a request accepted and never answered, a
  transfer cut mid-body, an untrusted certificate;
- be reachable under the update service's name.

This card is the one design for that source. Builder: hestia or iris (hermes assigns). Size: M. Depends on nothing beyond
main.

## 1. The process

`tests/acceptance/downloads/download-host.ts`, a plain Node HTTP and HTTPS server. The VSCodium run starts it before
the first launch and stops it at the end, whatever happens. It listens on `0.0.0.0` on two ports the run picks:
- `HTTP_PORT`: HTTP;
- `HTTPS_PORT`: HTTPS with a certificate the run makes for `downloads` and `update.code.visualstudio.com`, signed by
  nobody the host trusts (self-signed, made with `openssl req -x509` into the run's folder).

It writes `<run>/downloads/requests.log`, one line per request: `<time> <method> <path> <user-agent>`.

**Behaviour by the path's first segment.** Whatever follows it is the archive's path, which the template's placeholders
fill:

| Segment | Answer |
|---|---|
| `ok` | 200 with the server archive (below), `Content-Length` set |
| `missing` | 404, empty body |
| `busy` | 503, empty body |
| `junk` | 200 with 64 KiB of random bytes (not an archive), `Content-Length` set |
| `hang` | accepts the connection and the request, sends nothing, and keeps the socket open until the run ends or the test calls `dropHung()` |
| `cut` | 200 with the archive's `Content-Length`, sends the first 1 MiB, then destroys the socket |
| `slow` | 200 with the archive, 64 KiB every 100 ms (for progress rows) |

Over HTTPS the same table applies. The certificate is the failure there: a client that checks it fails before any
answer.

**The archive.** The run fetches the VSCodium server for the host (`vscodium-reh-alpine-<arch>-<VSCODIUM_RELEASE>`) once
into `<cache>/downloads/` from the release the client is pinned to, and checks it against a sha256 added beside
`VSCODIUM_RELEASE`'s client checksums. A cached file that matches is reused. The `ok` answer serves that file.

## 2. Reaching it

- **From the host container:** `docker run` gains `--add-host downloads:host-gateway` and `--add-host
  update.code.visualstudio.com:host-gateway` (`tools/acceptance-run.ts`). The host then reaches
  `http://downloads:<HTTP_PORT>/…` and `https://update.code.visualstudio.com:<HTTPS_PORT>/…`.
- **From the editor (local download):** the same names don't resolve on the client, so the client's own downloads use
  `http://127.0.0.1:<HTTP_PORT>/…`. A row that needs the client to download sets the template to that form.
- **Harness variables:** `HARNESS_DOWNLOADS_HTTP` and `HARNESS_DOWNLOADS_HTTPS` are the two bases as the host sees them,
  and `HARNESS_DOWNLOADS_LOCAL` is the client's base. Every launch gets them.

## 3. Using it

A row sets `remote.SSH.serverDownloadUrlTemplate` in its launch's `settings`, for example
`${HARNESS_DOWNLOADS_HTTP}/missing/${os}-${arch}/${commit}` (the placeholders are lib-product's `PlaceholderName`s). It
reads `requests.log` to see what was asked. Helpers in `tests/acceptance/suite/downloads.ts`:
- `downloadRequests()`: the log's lines;
- `dropHung()`: closes every `hang` socket;
- `templateFor(behaviour, scheme = 'http' | 'https' | 'local')`.

## 4. Rows

**Unit rows** (`tools/acceptance-downloads.test.ts`, the server started on ephemeral ports in the test):
- each behaviour's status, length and body;
- `hang` holds until `dropHung`;
- `cut` sends 1 MiB and then resets;
- the request log line;
- the certificate names both hosts.

**Capability rows** (`tests/acceptance/server/downloads.test.ts`, the harness host, `pnpm test:acceptance:server`):

| Name | Expected |
|---|---|
| `tooling-27: the host downloads the archive from the download host` | `wget -O- http://downloads:<port>/ok/x` on the host gives the archive's length |
| `tooling-27: the host sees 404 and 503` | BusyBox `wget` exits non-zero for `missing` and `busy` |
| `tooling-27: the host doesn't trust the download host's certificate` | `wget https://update.code.visualstudio.com:<port>/ok/x` fails with a certificate error, and works with `--no-check-certificate` |
| `tooling-27: the request log names each request` | one line per request above |

`tests/acceptance/README.md`: a "Download host" section with the table and the reaching rules.

## 5. Review

PR title `tests: a download host for the install rows (card tooling-27)`. themis or triton reviews; proteus checks the
run's new process, ports and `--add-host`.
