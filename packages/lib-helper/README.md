# lib-helper

One pattern for every helper process the family runs on the client: a helper outlives the extension
host that starts it, is shared by leases from several windows, and ends by a policy. Windows claim a
helper with an atomic exclusive create of a small record, hello to it with the record's nonce, and hold
leases numbered in arrival order; the oldest live lease is first.

It is bundled into the extensions that run helpers and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-helper` (`src/index.ts`), `lib-helper/testing/memory-file-port` |
| Allowed imports | `lib-log` |
| Coverage exclusions | none |
