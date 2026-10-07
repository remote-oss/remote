# Handover notes (work in progress; delete this file before the branch is merged)

## State

Sources match the contract: the argument builder (with the `ssh -G` query), config reader, host list, `ssh -G` reader,
Add New SSH Host parser and writer, stderr and prompt classifiers, and the client candidate order. `src/index.ts` is
the contract surface and `package.json` exports it; the README and the root `tsconfig.json` pair are in place. Missing:
unit tests and fixtures (the six task cards), then `pnpm coverage:update` to record the ratchet, which the integrator
runs once the cards have merged; until then `pnpm coverage` fails for lib-ssh.

## Gate traps

- Property names of four characters or more; no `const` arrow helpers (`func-style`); JSDoc on public class members;
  jscpd also flags five-line clones inside one file.
- Tests import through `../../src/index.ts` where the export exists, so the index is covered.

## Fixture recording

- Local `ssh -G` prints `connecttimeout none` when unset and `localforward 8080 [127.0.0.1]:80`.
- A `ProxyCommand` script that writes chosen lines to stderr and exits 255 reproduces exact texts (an inline command
  breaks, because ssh expands `%`).
- An `SSH_ASKPASS` script with `SSH_ASKPASS_REQUIRE=force` records the real question texts against a local sshd.
  OpenSSH 10.3 prints the colon fingerprint form.
- Remove the local host-key fingerprint, user name and home paths from every recording before commit; record only
  against 127.0.0.1, `.invalid` names and TEST-NET addresses.
