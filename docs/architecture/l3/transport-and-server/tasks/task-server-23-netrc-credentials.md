# Task card server-23: client downloads read the netrc, per hop, over https; a 401 or 403 fails at once

Issue: #1037 (user priority: a download source that needs credentials answers 401 and the user's `.netrc` is never
read). Size: M. Builder: `task:claude`. Design: athena's ruling on #1033, written into contracts §5 V4 (#1034). Read
it before starting. **Start after server-22 (#1036) merges**: both cards edit `DownloadRequest` and `http-download.ts`.

## 1. The rule

- **Source:** the client's netrc file. When `NETRC` is set and not empty, the file it names is the only one read: a
  missing file there gives no credentials, with no fallback to `~/.netrc`. Otherwise `~/.netrc`, and on Windows, when
  that does not exist, `%USERPROFILE%\_netrc`.
- **Match:** a `machine` entry whose name equals the request's host (`URL.hostname`, ignoring case; the port is
  ignored) and that has both `login` and `password`, neither empty. The first matching entry wins. `default` and
  `macdef` are ignored.
- **Header:** `Authorization: Basic base64(login:password)` (UTF-8), built **per request of the redirect chain** from
  that request's own host. A host with no entry gets none; no credential crosses a host change.
- **https only:** a matching entry on an http request is not sent, and the log says so once per transfer:
  `a netrc entry for <host> was not sent over http`.
- **401 / 403:** a final response of 401 or 403 fails at once, with no retry (§2.4).
- **Never logged:** the header, the password, the login and the file's contents. Host-side downloads (`hostFirst`)
  run the host's tools and do not change. No setting, prompt or secret store.

## 2. The change

### 2.1 The netrc parser (`lib-server/src/transfer/netrc.ts`, new)

```ts
/** One `machine` entry with both a login and a password. */
export interface NetrcEntry {readonly machine: string; readonly login: string; readonly password: string}

/** The usable entries of a netrc text, in file order. */
export function parseNetrc(text: string): readonly NetrcEntry[];

/** The `Authorization` value for `address`, or undefined; see §1. Logs the http case once through `logger`. */
export function authorizationOf(entries: readonly NetrcEntry[], logger: Logger): (address: string) => string | undefined;
```

Tokens are separated by white space, newlines included. Keywords: `machine <name>`, `login <name>`, `password <text>`,
`account <text>` (read and ignored), `default` (starts an entry that is dropped), `macdef <name>` (drops everything up
to the next blank line). A `#` at the start of a token drops the rest of its line. A token starting with `"` runs to
the closing `"`, with `\"`, `\\`, `\n`, `\r`, `\t` as escapes (curl's form); an unterminated quote ends the text.
A keyword with no token after it ends the text. An entry without both `login` and `password` is dropped. Unknown
keywords are skipped with their token.

### 2.2 The port (`ports.ts`) and the node reader

```ts
/** The client's netrc, read by the extension; the library reads no file of its own. */
export interface CredentialsPort {
  /** The text of the netrc file, or undefined when there is none. */
  readNetrc(): Promise<string | undefined>;
}
```

`transfer/node-netrc.ts` (new, exported from `index.ts`):
`nodeCredentialsPort(places: {environment: Readonly<Record<string, string | undefined>>; platform: NodeJS.Platform; homeFolder: string}): CredentialsPort`.
When `environment.NETRC` is set and not empty, that path is the only candidate: its text, or `undefined` on `ENOENT`
(never `~/.netrc` then). Otherwise it tries `<homeFolder>/.netrc`, and on `win32` also `<homeFolder>/_netrc`, in that
order; the first that reads gives its text, `ENOENT` goes to the next and ends in `undefined`. Any other error is
thrown.

### 2.3 The transfer and the download

- `TransferDependencies` gains `credentials: CredentialsPort`. `fetchVerified` reads it once, before the download
  (`parseNetrc(text ?? '')`); a read that throws is logged as `the netrc file could not be read (<error code>)`,
  with no text of the file, and the download goes on with no credentials.
- `DownloadRequest` gains `authorizationFor: (address: string) => string | undefined`, built by `authorizationOf`.
- `HttpGet`'s `init` gains `headers?: {Authorization: string}`. `finalResponse` calls
  `request.authorizationFor(address)` for **every** hop and sets the header only when it is defined.
- Wiring: `remote-containers/src/extension.ts` gives
  `credentials: nodeCredentialsPort({environment: process.env, platform: process.platform, homeFolder: os.homedir()})`
  to the transfer's dependencies; `remote-ssh/src/node-machine.ts` the same with its `facts.environment` and
  `facts.platform`. Fixtures that build transfer dependencies gain a fake port (the compiler lists them).

### 2.4 The 401 / 403 failure

- `DownloadFailureCause` gains `'unauthorized'`; `http-download.ts` returns, for a final response with status 401
  or 403 (checked before the generic `httpStatus`):
  `{kind: 'failed', cause: 'unauthorized', status, detail}` with the detail
  `the source asks for credentials. Add a "machine <host>" entry with a login and a password to your netrc file, or put the token in the address template of the server download setting (?token=...)`
  (`<host>` of the final response's address). The status is not in the detail: S071 puts it first (below).
- `transfer.ts`: `TransferFailure`'s `localDownload` cause union gains `'unauthorized'`; `downloadFailure` maps the
  port's cause to it, keeping `status` and `detail`.
- `remote-ssh/src/pipeline/failure.ts` (`localDownloadValue`): `unauthorized` returns
  `Server returned <status>: <detail>` (athena on #1033, contracts §5 V4 in #1042): it starts as for any HTTP error
  (`Server returned 401`, F-2405 AC-12), then the hint. So connect-38 R4's list of S071 `{0}` forms gets a fourth
  case. `remote-containers/src/connect/server-steps.ts`: the one retry of a `localDownload` runs only when the
  failure's cause is not `unauthorized`; the log line `the server was not installed: localDownload (unauthorized):
  <detail>` already carries the hint. V3's placement fallback is unchanged: `unauthorized` falls back exactly as the
  other `localDownload` causes do, and the row for it says so (§3).

## 3. Rows

`lib-server/test/unit/netrc.test.ts` (parser): one entry; several entries and the first match wins; a quoted
password with a space and with `\"`; `#` comments; `default` and `macdef` (with its lines) ignored and not matching
any host; an entry with only a login, or an empty password, dropped; `account` skipped; unterminated quote; keyword
with no token; empty text. `authorizationOf`: a host matched ignoring case gets `Basic …` of the exact bytes; another
host gets none; an http address gets none, and the log line is written once for two http addresses.

`lib-server/test/unit/node-netrc.test.ts` (real temporary folder): `NETRC` wins over `~/.netrc`; `NETRC` naming a missing file gives `undefined` even when `~/.netrc` exists; an empty `NETRC` is ignored; `~/.netrc`; `_netrc`
only on `win32`; none gives `undefined`; an unreadable path (a folder) throws.

`lib-server/test/unit/http-download.test.ts` (fake `httpGet`): the header is set on a hop whose host has an entry;
**a redirect to another host carries no header** (its first request had one); an http hop carries none; no entry means
no `headers` key; 401 and 403 give `unauthorized` with the status and the detail naming the host; 404 stays
`httpStatus`; the fake `httpGet` is called once for a 401 (no retry in the port).

`lib-server/test/unit/transfer.test.ts`: a fake `CredentialsPort` is read once per transfer; a throwing port is
logged and the download goes on; an `unauthorized` result is a `localDownload` / `unauthorized` failure with the
status; an `unauthorized` failure follows the same placement fallback as `httpStatus` (the existing fallback row, repeated for it); a log capture shows neither the password nor the login nor the file's text in any row above.

`remote-containers` server-steps test: a first failure with cause `unauthorized` is not retried (one transfer call);
an `httpStatus` failure still is. `remote-ssh` `failure.test.ts`: S071's value for 401 is `Server returned 401: ` followed by the detail, for 403 likewise with `403`; the other three forms are unchanged.

**Mutations** (list them in the PR): build the header once for the chain and the other-host row fails; drop the
scheme test and the http row fails; let `default` match and the default row fails; drop the 401 branch and the retry
row fails.

## 4. Gates and review

All gates with the changed files at 100 %. PR title: `lib-server: client downloads read the netrc per hop, and a 401
fails at once (card server-23, #1037)`. Request athena only. Cite athena's ruling on #1033 in the PR's answer to R1.
