# ADR-0016: The tunnel host agent is our own TypeScript program on the dev tunnels SDK and lib-server

- Status: proposed (athena; proteus's Build and CI section to come before acceptance)
- Date: 2026-11-24
- Deciders: athena and proteus
- Scope: the tunnel host agent (`packages/tunnel-agent`, package `tunnel-agent`), its build, its releases and its tests
- Requirements: D-107 and its answers (remote-oss/remote-server#21, #22); ADR-0003; ADR-0004; ADR-0014; ADR-0015;
  F-3902; R-47; F-8902 AC-17, AC-18; F-8104 AC-34, AC-35; F-8201 AC-41 to AC-43

## Context

D-107 gives the user's answer to Q11: the project builds **its own host agent**. The agent registers a machine's tunnel
with our relay and serves the editor's server to our Remote - Tunnels client over it. The user also answered:
- point 8: Linux x64 and arm64 only, no self-update, and the server for the client's commit by Remote-SSH's rules
  (F-3902, R-47);
- point 9: a systemd user unit as the service mode.

The editor's own CLI (`[cli]`, VS Code OSS `cli/src` at 1.139.1) has a tunnel host, `code tunnel`. It can't be our
agent without a patch we'd have to maintain:
- **It can't reach our relay.** It builds its management client with `new_tunnel_management`
  (`[cli]` `tunnels/dev_tunnels.rs:332,350`), and that builder hard-wires the production service,
  `environment: env_production()` (`[dev-tunnels]` `rs/src/management/http_client.rs:560-572`). The crate's
  custom-domain builder, `new_tunnel_management_for_custom_domain` (`http_client.rs:578-592`), exists, but `[cli]`
  never calls it. This answers ADR-0014's open "code tunnel measurement": the address can't be set.
- **It gets the server its own way.** It downloads from the editor build's update service, not by F-3902's rules,
  which point 8 requires.

The TypeScript SDK already has what a host needs:
- `TunnelRelayTunnelHost` (`[dev-tunnels]` `ts/src/connections/tunnelRelayTunnelHost.ts`): the host leg, the SSH
  sessions it carries, and the forwarding of a tunnel's ports to the machine's local ports;
- a management client that takes a custom domain (`ts/src/management/tunnelManagementHttpClient.ts:275`,
  `https://cp.${customDomain}/`).

lib-server already installs and starts the editor's server by F-3902's rules over a `HostChannel` (lib-host), for
Remote - SSH and Remote - WSL. ADR-0014 decision 2 lets the host side use the SDK. ADR-0004 binds only the SSH
connections an *extension* opens, and the agent is no extension.

## Decision

1. **The agent is a TypeScript program of ours**, the service package `packages/tunnel-agent` (the third service
   kind's second member, `ruling-3062-service-kind`). It is built on:
   - the dev tunnels TypeScript SDK (`TunnelRelayTunnelHost` and the management client with our domain) and
     `@microsoft/dev-tunnels-ssh`, at the versions ADR-0015's lockfile already holds;
   - lib-server, for the server by F-3902's rules, over a new local `HostChannel`;
   - lib-host, lib-log and lib-identifiers.

   It imports no `vscode` and no extension.
2. **It speaks `[cli]`'s control protocol**, the subset our Remote - Tunnels client calls (the agent brief, §4), on
   `[cli]`'s control port 31545 (`[cli]` `constants.rs:14`). `[cli]`'s `serve` takes a commit and a quality, so our
   client also sends its server source. That addition is ours (R-113), and it means "the client" in
   `ruling-22-tunnel-rules` item 8 is **our** client, as F-8902 Q3's accepted compatibility note says.
3. **It runs on Node.js**, shipped as one archive per platform, Linux x64 and Linux arm64. The archive holds an
   official Node.js build, the bundled agent, and the third-party notices. The agent never updates itself (point 8).
   proteus's Build and CI section below settles the packaging details.
4. **Not chosen:**
   - a patched `[cli]`: a fork of the editor's CLI kept in step with every editor release, in Rust, with its own
     server download replaced;
   - a Rust agent on the crate: a second language in the family, which ADR-0015 kept out of the gates.

## Options considered

| Option | For | Against |
|---|---|---|
| A (chosen): our TypeScript agent on the SDK and lib-server | One language with the relay and the extensions; the SDK's host class carries the host leg; lib-server already gives F-3902's server; we own the protocol subset | Node must ship with the agent; the control protocol subset is written by us |
| B: `[cli]` patched to take our domain and F-3902's server | `code tunnel`'s control server exists as written | A maintained patch on the editor's CLI per release; Rust in our builds; its server download replaced anyway; the user chose our own agent (Q11) |
| C: a Rust agent on the `[dev-tunnels]` crate | The crate's custom-domain builder exists | A second language and toolchain, which ADR-0015 kept out of the gates; lib-server unusable |

## Consequences

- **Layout:**
  - `tools/check-layout`'s `SERVICE_FOLDERS` gains `tunnel-agent`;
  - layout.md and c4-l2-containers.md §1 gain the package and its imports (lib-server, lib-host, lib-log,
    lib-identifiers);
  - `network-rule.test.ts` leaves it out by name, with the reason, as it does `tunnel-relay` (`ruling-3062-network-rule`).
- **lib-host gains a local `HostChannel`.** It runs scripts with the local `sh` and copies files locally. It's a card
  of its own, with rows against lib-server's existing script goldens.
- **Proof:** #3076's per-run relay container runs the agent as the host, against our client's protocol subset, in a
  hosted Linux job on each of x64 and arm64 (F-8104 AC-35).
- **Licence:** the agent's archive carries Node.js's own `LICENSE`, and each bundled package's licence from its own
  metadata.

## Build and CI (proteus)

To come: the archive's shape, the Node.js version and how it's fetched and verified, the hosted x64 and arm64 jobs, and
where releases are published.

## Check

- `packages/tunnel-agent` imports no `vscode` and no extension, and check-layout and the network rule name it.
- The agent's archive is offered for Linux x64 and arm64 only, and the agent has no update path (F-8902 AC-18).
- The server it starts for a client is the one lib-server's plan gives for that client's source and commit
  (F-8104 AC-35).
