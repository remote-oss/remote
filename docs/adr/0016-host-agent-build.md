# ADR-0016: The tunnel host agent is our own TypeScript program on the dev tunnels SDK and lib-server

- Status: accepted (athena and proteus, 2026-11-24). Build and CI by proteus
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
   - the dev tunnels TypeScript SDK: `@microsoft/dev-tunnels-connections` (`TunnelRelayTunnelHost`),
     `-management` (the management client with our domain) and `-contracts`. These three are new to the lockfile, and
     the agent skeleton card pins them at **1.3.50**, the newest whose peer range (`^3.12.29`) holds the relay's
     `@microsoft/dev-tunnels-ssh` 3.12.29, so the agent and the relay share one ssh (#3159). 1.3.82 needs `^3.12.42`.
     A later move to a newer SDK moves the relay's ssh pin with it, in one change. They come with that
     `@microsoft/dev-tunnels-ssh`, and with
     `@microsoft/dev-tunnels-ssh-tcp`. The connections package peer-depends on that one
     (`[dev-tunnels]` `ts/src/connections/package.json:29-30`), and `TunnelRelayTunnelHost` uses it, so the skeleton
     card pins it beside `-ssh`;
   - lib-server, for the server by F-3902's rules, over a new local `HostChannel`;
   - lib-host, lib-log and lib-identifiers.

   It imports no `vscode` and no extension.
2. **It speaks `[cli]`'s control protocol**, the subset our Remote - Tunnels client calls (the agent brief, §4), on
   `[cli]`'s control port 31545 (`[cli]` `constants.rs:14`). `[cli]`'s `serve` takes a commit and a quality, so our
   client also sends its server source. That addition is ours (R-113), and it means "the client" in
   `ruling-22-tunnel-rules` item 8 is **our** client, as F-8902 Q3's accepted compatibility note says.
3. **It runs on Node.js**, shipped as one archive per platform, Linux x64 and Linux arm64. The archive holds an
   official Node.js build, the bundled agent, and the third-party notices. The agent never updates itself (point 8).
   The Node.js build is one exact version, pinned with its checksums (Build and CI, 2), and the agent's rows run on
   that Node, not the runner's. The Build and CI section below settles the packaging details.
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
  - **What decides whether a dependency may be bundled** is ADR-0002 decision 8 (licences compatible with MIT, checked
    by `tools/licences.ts`'s allowlist, which holds Apache-2.0 and ISC). It is not ADR-0014, which admits **sources
    to read**, not dependencies. So `websocket` (Apache-2.0) and `es5-ext` (ISC) may be bundled without the user's
    admission. ADR-0015's "russh would need the user's admission" conflated the two; for a dependency, ADR-0002
    decision 8 governs.
  - **An Apache-2.0 package's `NOTICE` file**, where it has one, goes into `THIRD-PARTY-NOTICES.txt` whole, beside
    its licence text.

## Build and CI (proteus)

1. **The archive.** There's one per platform, `tunnel-agent-<version>-linux-x64.tar.gz` and
   `…-linux-arm64.tar.gz`. Each has one top folder, `tunnel-agent-<version>-linux-<arch>/`, holding:
   - `bin/tunnel-agent`: a POSIX `sh` launcher. It resolves its own path, so a symlink in `~/.local/bin` and the systemd
     unit both work, and runs the bundled agent with the archive's own Node;
   - `node/bin/node` and `node/LICENSE`, taken from the official Node.js tarball. Nothing else of it is kept: no
     `npm`, no headers;
   - `lib/tunnel-agent.mjs`: the agent, bundled by esbuild (ADR-0002 decision 3) into one file, with its libraries and
     the SDK compiled in;
   - `THIRD-PARTY-NOTICES.txt`: every package the bundle holds, by name and version, with that package's own licence
     text. It's made from esbuild's metafile, so the list is the bundle's and not the lockfile's.

   **The bundle holds no native addon.** The SDK's connections package depends on `websocket`, which asks for
   `bufferutil` and `utf-8-validate`, two native addons (`node-gyp-build`). The bundle leaves both out, and `websocket`
   runs on its JavaScript code paths. The build fails if the metafile names any `.node` file or `node-gyp-build`, and a
   row runs the bundle's `--version` with neither addon present. So the bundle is the same bytes in both archives, only
   the Node binary differs, and one runner builds both.

   **The build is reproducible.** Entries are sorted, the owner is 0 and the modes are fixed. Every mtime is the
   built commit's time, and `gzip -n` keeps the name and time out of the header. Two builds of one commit give the
   same sha256, and a unit row checks it.
2. **Node.js.** `.node-version` names a major (24), which setup-node resolves to that major's latest patch. The
   archive needs one exact build:
   - `packages/tunnel-agent/node.json` pins the version (the latest LTS patch of that major) and the sha256 of
     `node-v<version>-linux-x64.tar.xz` and of `…-linux-arm64.tar.xz`.
   - The build fetches both from `https://nodejs.org/dist/v<version>/`, and fails on any mismatch with the pin.
   - The pin changes only by a reviewed PR, made by `tools/pin-node.ts <version>`. The tool checks the release's
     `SHASUMS256.txt.asc` with gpg, against the Node.js release team's keys, which the repository keeps as one file
     taken from their keys repository at a named commit. Then it writes the two sums.

   A Node.js security release makes a new agent release, since the agent never updates itself.
3. **Hosted jobs.** They run on GitHub's runners, read no secret and push nothing.
   - **`tunnel-agent`** (ci.yml, on `ubuntu-24.04`) builds both archives. It checks each one's layout, its notices and
     the no-native rule. It runs the x64 archive's `bin/tunnel-agent --version` with no network. The agent has no
     update command or method (brief §2, §4). It uploads both archives as the run's artifact, kept 7 days.
   - **The agent rows** run in #3076's `tunnels-conformance`, as a matrix over `ubuntu-24.04` and `ubuntu-24.04-arm`.
     Each job needs `tunnel-agent`, takes its own platform's archive from the artifact, and runs the agent **with the
     archive's Node**, so the program tested is the program shipped. The agent works against the run's relay on the
     same runner (the brief, §8). The rows are the brief's:
     - registration, re-register and rename (F-8201 AC-41 to AC-43);
     - the control protocol subset (§4);
     - `serve` getting the server for a commit the host lacks (F-8104 AC-35), from the product `acceptance (real
       server)` already uses, `lib-product`'s `vscodium-reduced.json`: a public download, no secret;
     - service mode (F-8902 AC-17).
   - **When they run:** on a pull request that reaches them, on every merge to main, and in the nightly, like #3076's
     job. Their reach is the agent's package, lib-server, lib-host, lib-log, lib-identifiers, `node.json`, the build
     tool and `tests/tunnels-conformance/`. `ci-gate` needs both jobs, and their rows join the known-red ledger like a
     launch's.
4. **Releases** (proposed: where builds are published is the user's call, ADR-0002 decision 5):
   - A tag `tunnel-agent-v<version>` on a main commit starts a workflow of its own, on the `push` of that tag only.
     Its first step checks out `main` in full (`fetch-depth: 0`) and fails unless the tagged commit is an ancestor of
     `main` (`git merge-base --is-ancestor`): a tag trigger alone doesn't enforce "on a main commit", and a shallow
     clone would leave `merge-base` nothing to compare. It then runs the same build and agent rows, through a
     reusable workflow that ci.yml also calls. Only then does it attach the two archives and a `SHA256SUMS` to the
     tag's GitHub release in this repository, with a build provenance attestation for each archive.
   - **Proposed, the user's repository setting:** a tag ruleset that lets only the release's owners create
     `tunnel-agent-v*` tags, which closes the trigger itself.
   - The release lives outside ci.yml because `ci-gate` must need every ci.yml job (`check-ci-gate`), and a release
     job can't wait for the gate that waits for it.
   - The one job that writes holds `contents: write`, `id-token: write` and `attestations: write`, on that `push`
     only, which is an event `check-workflow-tokens` allows a write on. No other job writes, and none reads a secret.
   - A user checks a download with `sha256sum -c SHA256SUMS`, or with `gh attestation verify`.
   - The first release waits for the user's yes, through hermes. Until then the run's artifact is the build's
     output.

## Check

- `packages/tunnel-agent` imports no `vscode` and no extension, and check-layout and the network rule name it.
- The agent's archive is offered for Linux x64 and arm64 only, and the agent has no update path (F-8902 AC-18).
- The server it starts for a client is the one lib-server's plan gives for that client's source and commit
  (F-8104 AC-35).
