# lib-host

The host channel: one narrow interface through which the server lifecycle runs scripts on a remote side and places
files there, whatever the transport. It is bundled into the extensions that use it and never published on its own.

## Contract

- `runScript(request, onLine)` runs a POSIX shell or PowerShell script with added environment variables and standard
  input. Output lines reach `onLine` in order, all before the outcome settles. The outcome is the exit status, which
  the caller interprets, or a failure.
- `copyToHost(request)` places a local file at a remote path.
- `identity()` names the host in locks and records; `platformHint()` gives the operating system as far as the
  transport knows it without a probe.
- Failures are values of a closed set of kinds (`channelClosed`, `spawnFailed`, `copyToolMissing`, `copyFailed`,
  `timeout`, `cancelled`), each with the transport's original message as detail; `failFrom` builds one from a caught
  value. Cancellation is an `AbortSignal`. A channel never interprets output and never retries.

For tests, under `src/testing/` (never imported by a bundle):

- `lib-host/testing/recording-channel`: a channel that replays scripted answers, matched by interpreter and a
  predicate, each used once; it records every call in order, can end any call with any failure, and can hold a call
  open until it is cancelled.
- `lib-host/testing/channel-contract`: the cases every implementation passes. An implementation's test hands a
  harness that stages each scenario on its own transport and runs the returned cases.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-host` (`src/host-channel.ts`), `lib-host/testing/recording-channel`, `lib-host/testing/channel-contract` |
| Allowed imports | `node:assert` in `src/testing/` only; no library, no extension, no `vscode` |
| Coverage exclusions | none |
