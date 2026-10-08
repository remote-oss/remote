# lib-helper

A shared pattern for helper processes that outlive one window: a connection, a watchdog or a relay that several
windows use, ending by its own policy once the last of them lets go. It is bundled into the extensions that use it
and never published on its own.

## Contract

- **Registry.** Each running helper leaves a record (`HelperRecord`): its endpoint, a nonce it repeats when greeted,
  its process id and start time, and a payload of plain values that never holds a secret. `recordPath` places a
  record under its namespace, named by a digest of its key, so that the key never appears in a file name.
  `claim` writes the record only when the key is free and otherwise reads the record that holds it; `isStale` says
  whether a recorded helper is to be replaced, and `replaceStale` removes its record and claims the key once, never
  looping. File access goes through `RegistryFilePort`.
- **Leases.** `LeaseTable` holds the clients' leases in arrival order, numbered and never reused, and reports every
  change.
- **End policies.** `EndPolicyRunner` arms one timer when the last lease closes and disarms it when a lease opens in
  time: `graceAfterLastLease` and `idleAfterLastLease` end the helper, `delayedCheckAfterLastLease` runs the
  consumer's action and then ends it.

For tests, under `src/testing/` (never imported by a bundle): `lib-helper/testing/memory-file-port`, a registry
port in memory, and `lib-helper/testing/fake-clock`, time and timers a test advances.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Allowed imports | `node:crypto` in `src/registry/claim.ts`; `lib-log` once the runtime logs; no extension, no `vscode` |
| Coverage exclusions | `src/types.ts` and `src/registry/file-port.ts`: they declare types only, and nothing in them runs |
