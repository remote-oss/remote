# Handover notes (work in progress; delete this file before the branch is merged)

## State

Sources for the argument builder, config reader, host list, `ssh -G` reader, Add New SSH Host parser and writer,
stderr and prompt classifiers, and the client candidate order are in `src/`. Typecheck and lint pass. Missing:
unit tests, fixtures, README, package `exports`, and the coverage ratchet.

## Packaging convention (as lib-host does it)

1. `package.json`: no `type` field; `exports` maps subpaths to `src/*.ts` files, `"."` plus one entry per module a
   consumer needs; no barrel file. Test-only helpers go under `src/testing/` and get their own `exports` entry.
2. `knip.jsonc`: no change; test files are entries, so exports used only by tests pass. A type that nothing imports
   must stay unexported.
3. Root `tsconfig.json`: the package pair `packages/lib-ssh` and `packages/lib-ssh/tsconfig.test.json` (already
   added here). It conflicts trivially with lib-host's pair; whoever lands second rebases.
4. `coverage.json`: start with `{}`, then run `pnpm coverage:update` to record the ratchet.
5. lib-host's branch changes `tools/identifiers` to skip `lib-*` folders. Until that lands, the identifiers check
   fails for a library with `src/`, so rebase onto it.
6. The same branch makes the root scripts run `node tools/identifiers.ts` first; take that through the rebase rather
   than copying it.
7. README: follow `packages/lib-host/README.md` (the contract in words; a "For maintainers" table with Maintainers,
   Entry points, Allowed imports and Coverage exclusions).
8. Gate traps: property names of four characters or more; no `const` arrow helpers (`func-style`); JSDoc on public
   class members; jscpd also flags five-line clones inside one file.

## Fixture recording

- Local `ssh -G` prints `connecttimeout none` when unset and `localforward 8080 [127.0.0.1]:80`.
- A `ProxyCommand` script that writes chosen lines to stderr and exits 255 reproduces exact texts (an inline command
  breaks, because ssh expands `%`).
- An `SSH_ASKPASS` script with `SSH_ASKPASS_REQUIRE=force` records the real question texts against a local sshd.
  OpenSSH 10.3 prints the colon fingerprint form.
- Remove the local host-key fingerprint, user name and home paths from every recording before commit; record only
  against 127.0.0.1, `.invalid` names and TEST-NET addresses.
