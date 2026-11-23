# ADR-0015: The tunnel relay is written in TypeScript on dev-tunnels-ssh, with Rust as the fallback

- Status: accepted (2026-11-23). T.6's evidence: run 45110368187, `tunnels-spike` at 224201c1, green on both hosts (remote-oss/remote#3050)
- Date: 2026-11-22
- Deciders: athena and proteus
- Scope: the tunnel relay service (`packages/tunnel-relay`, package `tunnel-relay`), its build, its CI and its conformance suite
- Requirements: D-107; ADR-0003; ADR-0004; ADR-0014

## Context

D-107 builds a relay of our own that is wire-compatible with the dev tunnels service. Its contract is the relay brief,
`docs/architecture/l3/tunnels/brief-relay.md`, read from `[dev-tunnels]` and `[cli]` under ADR-0014. The relay
terminates only the host's leg: an SSH session in which the relay is the server and the key exchange, host key and
cipher are all `none` (`[dev-tunnels] rs/src/connections/relay_tunnel_host.rs:367-383,79-82`). The client's leg is an
SSH session end to end with the host, which the relay only pipes through a `client-ssh-session-stream` channel
(`:958-969`).

Two SSH libraries speak that `none` exchange, both in `[dev-tunnels]`'s own dependencies:
- `russh` 0.37.1, for the Rust SDK, and `[cli]`'s patch of it from `microsoft/vscode-russh` (`rs/Cargo.toml:22-23`;
  `[cli]` `Cargo.toml:79-81`). Its licence is **Apache-2.0**, not MIT, both upstream and in the fork;
- `@microsoft/dev-tunnels-ssh` (**MIT**), for the TypeScript SDK, whose V1 host opens the leg with
  `SshSessionConfiguration(false)` (`ts/package.json:24-25`; `ts/src/connections/tunnelRelayTunnelHost.ts:224-225`),
  and which also provides an `SshServerSession`.

Every package in the repository is TypeScript, and every gate is built for it (ADR-0002, ADR-0003).

## Decision

1. **The relay is written in TypeScript**, as the workspace package `tunnel-relay` (`packages/tunnel-relay`). It
   serves the brief's management API, and it terminates the host leg with a dev-tunnels-ssh `SshServerSession` on
   `SshSessionConfiguration(false)`. It depends on `@microsoft/dev-tunnels-ssh`, which ADR-0014 admits, and reuses
   `[dev-tunnels]`'s TypeScript contract types where they fit.
2. **The condition, met by T.6 (run 45110368187, remote-oss/remote#3050):** this server session completed the host
   leg with **both** `[dev-tunnels]`'s Rust host (`russh` with `[cli]`'s patch, which is `[cli]`'s path) and its
   TypeScript host, with key exchange, host key, cipher and MAC all `none`. For each host, a 64 KiB payload from the
   TypeScript client came back through a `client-ssh-session-stream` channel byte for byte (the same SHA-256). No Rust
   *client* was run: T.4's Rust client is part of the conformance plan, not a result of T.6.
3. **The fallback, not needed:** had T.6 been red, the relay would have been Rust with `russh`, under the R section
   below. That would also have needed `russh` (Apache-2.0) admitted as a dependency, which is a licensing decision
   for the user. ADR-0014 admits only MIT sources. T.6 was green, so R is not taken.
4. **ADR-0004 is unchanged:** the relay is a service, and no SSH connection that an extension opens goes through it
   or through dev-tunnels-ssh.

## Options considered

| Option | For | Against |
|---|---|---|
| T (chosen, on T.6): TypeScript with dev-tunnels-ssh | One toolchain: every gate applies as it is, and every coder writes TypeScript. The TypeScript SDK's own library | None found: T.6 showed the interoperation of `none` with `russh` (both hosts' legs, a byte-exact pipe) |
| R: Rust with `russh` | The same library as `[cli]`'s host, so interoperation with it is certain | `russh` is Apache-2.0, which needs its own admission (the user's). A second toolchain in CI, adding about 5 to 10 min to every gate that touches it (an estimate; the spike's Rust host cold-built in 68 s). `dupes` and `dead` have no Rust counterpart |
| A TypeScript relay with a JavaScript SSH server patched for `none` | — | It maintains a fork, when dev-tunnels-ssh already offers `none` |

## Build and CI (proteus)

### T (chosen): the relay in TypeScript, on dev-tunnels-ssh

1. **One workspace package.** The relay is the pnpm workspace package `tunnel-relay` in `packages/tunnel-relay`, beside the
   extensions. (The spike's relay copies each buffer that dev-tunnels-ssh's `WebSocketStream` hands `send`, because the
   library reuses it for the next packet: the relay keeps that copy.) It runs on the repository's Node (`.node-version`). The checks job's
   gates apply to it as they are, with nothing new to build: `typecheck`, `lint` (ADR-0003), `dupes`, `dead` (its
   entry in `knip.jsonc`), `format-check`, `check-coverage` and `coverage-all` (its package joins the per-package
   thresholds), and `check-licences`. The last carries `@microsoft/dev-tunnels-ssh`'s MIT notice and its
   dependencies' into the package's third-party notices. The unit rows sit under its `test/unit`, which `.mocharc.json`
   already reads. `check-public-surface` and the extension manifest checks don't apply: it's a service, not an
   extension.
2. **Pins.** `@microsoft/dev-tunnels-ssh` (and `-ssh-tcp` if used) is pinned by the lockfile at an exact version, never
   a range. The `[dev-tunnels]` commit the conformance suite builds from is pinned in one place, at the `[cli]` pin
   `64048c1409ff`, and a row checks the two pins agree.
3. **The per-run relay container.** An image built from the package's `Dockerfile` in the run, on GitHub's runners.
   It's never pushed, so it holds no credential and needs no registry.
   - **Address:** it serves `cp.<run domain>` over HTTPS with the run's own certificate authority, the way the
     download host serves its archives. A network alias on the run's Docker network makes the name resolve, and
     nothing listens on a public port.
   - **Test identities:** none of them is a real account or token. The relay's GitHub base address is a setting. In
     the run it points at a stub `/user` service on the same network, which answers each test token with a fixed
     numeric id: one on the allowlist, one off it, and one token that gets 401. So the suite proves §3's allowlist
     keyed by numeric id, with no secret.
4. **The conformance suite.** A job of its own, `tunnels-conformance`, on GitHub's runners. It reads no secret, so it
   may also take the pool under #2219, with its same-repository guard. It builds a client image:
   - a Rust stage: a pinned toolchain image, by digest, that builds `[dev-tunnels]`'s Rust management client, relay
     host and relay client from `rs/` at the pinned commit;
   - a Node stage with the TS SDK at the lockfile's version.

   It runs §8's routes, auth answers, tokens, both legs (Rust host and TS host, each with a TS client and a Rust
   client) and limits against the per-run relay. Both clients trust the run's authority: `NODE_EXTRA_CA_CERTS` for the
   TS side, and `SSL_CERT_FILE` or the build's root store for the Rust side, measured in the spike. Rust is in this
   image only, never in the PR's checks job.
5. **When it runs.**
   - **On a pull request:** when the change reaches the relay package, its Dockerfile, the suite or the pins, through
     the reach the acceptance selector already computes (a new entry, not a new mechanism).
   - **Always:** on every merge to main and in the nightly.
   - **Gate and tracking:** `ci-gate` needs it, and its rows go into the known-red ledger like any launch's.
6. **The spike** (athena's condition before the first relay card) runs the same way: one dispatch of a branch that
   builds the client image and a minimal `SshServerSession(new SshSessionConfiguration(false))` server. It shows
   three things:
   - the Rust host (russh `none`) and the TS host each complete the host leg;
   - a `client-ssh-session-stream` channel pipes a client's bytes end to end;
   - the measured times.

   That run is the ADR's evidence; a red one sends us to R. Run 45110368187 used the TypeScript client for both
   hosts; T.4's Rust client stays part of the conformance plan, not a result of T.6.

### R (fallback): the relay in Rust, with russh

- **Licence:** `russh` is Apache-2.0 (crates.io 0.37.1; `[cli]` patches it from `microsoft/vscode-russh`, also
  Apache-2.0). R would need it admitted as a dependency, which is the user's decision. ADR-0014 admits MIT sources only.

If the spike fails, the relay is a Rust crate in the repository, and CI gains a second toolchain on GitHub's runners
only:
- **Toolchain:** a pinned toolchain from `rust-toolchain.toml`, and the cargo cache (rust-cache).
- **Checks** in the checks job, each failing the build: `cargo fmt --check`, `cargo clippy -- -D warnings` (with the
  lints that stand in for ADR-0003's naming and no-dead-code rules), `cargo test`, `cargo llvm-cov --fail-under-lines`
  at the repository's coverage threshold, and `cargo deny check licenses advisories` beside `check-licences`.
- **Lock and layout:** `Cargo.lock` is committed, and `check-layout` names the crate's folder.
- **Gaps against T:** `jscpd` and `knip` don't read Rust, so `dupes` and `dead` have no Rust counterpart. ADR-0003's
  no-duplication rule rests on review for the crate.
- **Cost (an estimate, not measured for a relay crate):** a cold build adds about 5–10 minutes to every run that
  reaches the crate, and a warm cache about 1–2. The spike's Rust host (the tunnels crate and `vscode-russh`)
  cold-built in 68 s.

Either way, §8's conformance suite, the per-run container and the stub identities are as in T.4–T.5.
