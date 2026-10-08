# lib-log

The log of the family: lines with a level, a scope and a time, written to a sink a package holds for its
own output channel. A logger is created with a sink and a level taken from settings; a package with no
log channel creates one without a sink and stays silent by construction. Every message is redacted before
it reaches a sink: named secrets, and anything that still looks like a token, are replaced by a fixed
marker, so a connection token, a prompt answer or a nonce cannot pass through at any level.

It is bundled into the packages that use it and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-log` (`src/index.ts`), `lib-log/testing/memory-sink`, `lib-log/testing/once` |
| Allowed imports | none |
| Coverage exclusions | none |
