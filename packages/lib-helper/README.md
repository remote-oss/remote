# lib-helper

One pattern for every helper process the family runs on the client: a helper outlives the extension
host that starts it, is shared by leases from several windows, and ends by a policy. Windows claim a
helper with an atomic exclusive create of a small record, hello to it with the record's nonce, and hold
leases numbered in arrival order; the oldest live lease is first.

It is bundled into the extensions that run helpers and never published on its own.

## The helper side

`serve` runs inside a helper script, which an extension keeps in `src/helpers/` and the build bundles on its own
into `dist/helpers/`. It listens on the endpoint, a Unix socket that only the user can open (mode 0600) in the
user's runtime folder, named by a digest (`endpointPath`, `runtimeFolder`). Each client opens with a hello that
carries the record's nonce. A wrong nonce, or no hello in time, closes the connection. A right one gets a lease,
the live leases and the record's payload. Requests reach the consumer's handler, which can also broadcast to every
lease. Every change of the live leases reaches every lease. A closed connection is a released lease. The helper ends
by its end policy, after the policy's action where it names one, or when a client sends stop. Messages are one JSON
object per line. The Windows named pipe is not available yet: on Windows, listening and connecting are refused.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-helper` (`src/index.ts`); `lib-helper/testing/*`: the in-memory file port, the in-process endpoint, the fake clock |
| Allowed imports | `node:crypto`, `node:net` and `node:path`; `lib-log` once it lands (a `logLine` function until then); no extension, no `vscode` |
| Coverage exclusions | none |
