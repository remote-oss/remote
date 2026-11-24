# Brief: the tunnel host agent (Remote - Tunnels, D-107)

Status: proposed by athena, for proteus's agreement (with ADR-0016). Sources:
- `[dev-tunnels]` = `microsoft/dev-tunnels` at `64048c1409ff` (ADR-0014), the TypeScript SDK `ts/src`;
- `[cli]` = VS Code OSS `cli/src` at 1.139.1.

Decisions of the user: D-107 and its answers (remote-oss/remote-server#21, #22). Our rules: `ruling-22-tunnel-rules`
and `ruling-22-open-four` (remote-oss/remote-server#22). The relay's side is `brief-relay.md`; the client's side is
the Remote - Tunnels client brief, which follows this one.

## 1. What the agent is

- **A program a user runs on the machine they want to reach:** it signs in, registers the machine's tunnel with our
  relay, holds the tunnel's host leg, and serves the editor's server to our Remote - Tunnels client through it.
- **Its package:** `packages/tunnel-agent`, a service package (ADR-0016). Each criterion below maps to it, except
  those named as the client's.
- **Release 1's scope** (the user's answers, points 8 and 9):
  - Linux x64 and arm64 only;
  - no self-update;
  - the server for the client's commit by Remote-SSH's rules (F-3902, R-47);
  - a systemd user unit as its service mode;
  - no keep-awake option, and no WSL distributions (ruling item 10).

## 2. Commands

The agent's command line is ours (R-113). It has only what the criteria need (R-60):

| Command | Does | Criteria |
|---|---|---|
| `tunnel-agent login` | Signs in with GitHub by the device flow, or with a token read from standard input (`--token-stdin`), for a host with no browser. The relay accepts any token of a listed account (ruling item 2). | ruling item 2 |
| `tunnel-agent` (no command) | Registers the tunnel (§3) and serves it in the foreground until stopped | F-8201 AC-43 |
| `tunnel-agent service install` / `service uninstall` | Writes and enables a systemd user unit that runs the agent, or stops and removes it (§6) | F-8902 AC-17 |
| `tunnel-agent rename <name>` | Renames the tunnel, keeping its id, by the relay's name rules | F-8201 AC-42 |
| `tunnel-agent unregister` | Deletes the tunnel on the relay and forgets the stored record | ruling item 10 |
| `tunnel-agent --version` | Prints the agent's version. There's no update command. | F-8902 AC-18 |

## 3. Registering the tunnel

- **The relay:** the management client with our domain (`[dev-tunnels]`
  `ts/src/management/tunnelManagementHttpClient.ts:275`, `https://cp.<domain>/`) at the relay's API version
  (brief-relay §2). The domain comes from the archive's shipped `config.json` (§5); release 1 has one relay.
- **The first registration:** the agent creates a tunnel, with a fresh id and the name the user chose or the
  machine's host name. It adds port 31545, `[cli]`'s control port (`[cli]` `constants.rs:14`), and registers its
  host endpoint (brief-relay §5).
- **Every later start:** the agent reads its stored tunnel record (§5).
  - If the tunnel still exists on the relay, it reuses that id and re-registers its endpoint, giving one row with the
    same id.
  - If it's gone, it creates a new tunnel with a new id, and overwrites the record (F-8201 AC-43).
- **Rename** keeps the id and follows the relay's name rules (F-8201 AC-42).
- **The host leg:** `TunnelRelayTunnelHost` (`[dev-tunnels]` `ts/src/connections/tunnelRelayTunnelHost.ts`) holds it.
  It carries the clients' SSH sessions, and forwards each of the tunnel's ports to the same port on the machine's
  loopback (`tunnelRelayTunnelHost.ts:117,748`).
- **What the agent reports:** no WSL distribution (F-8201 AC-41).

## 4. The control protocol: `[cli]`'s, the subset our client calls

- **Where:** port 31545 of the tunnel. The agent serves `[cli]`'s msgpack RPC there (`[cli]`
  `tunnels/control_server.rs`, `tunnels/protocol.rs`), with the protocol version `[cli]` gives, 6
  (`constants.rs:30`).
- **The wire** (daedalus's inventory on #3136, comment 7140321314):
  - MessagePack maps `{id, method, params}` and `{id, result | error}`, with duplex streams;
  - a tunnel connection needs no challenge, so the agent sends `version` first.
- **The methods:** only those our Remote - Tunnels client needs. The client brief confirms the list. Any other method,
  `[cli]`'s exec-server ones (`fs_*`, `spawn*`, `acquire_cli`, `sys_kill`) included, gets an error answer, and the
  connection stays open.
  - **`version`** (agent to client, first): `{version, protocol_version: 6}` (`protocol.rs:238-241`).
  - **`ping`**: an empty answer.
  - **`serve`**: starts the editor's server for the client and answers when it's ready (§7). `[cli]`'s parameters
    (`protocol.rs:65-78`: `socket_id`, `commit_id`, `quality`, `extensions`, `connection_token`, `compress`) gain
    one field of ours, the client's **server source**. It's what lib-server's plan needs by F-3902 rule 5(i): the
    product's server download template, its quality, and the server's data folder name. `use_local_download` stays
    false in release 1.
  - **`servermsg`**, with **`serverclose`** and **`serverlog`** from the agent: `{i: socket_id, body}`
    (`protocol.rs:89-93`). They carry each of the client's connections to the server, bridged by the agent to the
    server's own socket, as `[cli]` does (`tunnels/server_bridge.rs`).
  - **`forward` / `unforward`**: add a port to the tunnel as **private**, or remove it (`ForwardParams {port,
    public}`; a `public: true` is refused). That's how the client reaches a host port through its loopback listener
    (`ruling-22-open-four` point 3). `ForwardResult.uri` carries no web address in release 1, because none is
    served. The client brief fixes what the client does with it. Each forwarded port counts against the relay's 10
    ports per tunnel (brief-relay §6). A private port creates no web address in our relay, so `forward` stays in
    release 1 (F-8202 AC-27's address clauses are the web path's). That keeps the ports limit (F-8203) meaningful,
    since every port the editor forwards is a tunnel port. `net_connect` over the control session isn't used.
  - **`update`**: not implemented. Our client never asks, so it shows no update prompt (F-8104 AC-34), and the agent
    never updates itself (F-8902 AC-18). `makehttpreq` is out too: `use_local_download` is false.
  - **`challenge_issue` / `challenge_verify`**: not implemented. The relay's owner-only connect tokens
    (brief-relay §4) are the access control.
- **Our client is the client meant here.** The `serve` addition makes "the client works unchanged"
  (`ruling-22-tunnel-rules` item 8) mean our Remote - Tunnels client, as F-8902 Q3's accepted compatibility note
  says.

## 5. What the agent keeps

- **One state folder per user:** `~/.remote-oss-tunnel-agent/`, a fixed family name from one lib-identifiers constant
  (D-14, #3159), since the agent may serve several products' clients. The folder is mode 0700.
- **Shipped defaults:** `config.json` inside the archive, `{domain, githubClientId}` (the relay's domain and the
  device flow's public OAuth client id). The release build writes it at the first staging deployment, and tests write
  the per-run values into the unpacked copy (#3160).
- **Its files:**
  - **`tunnel.json`**: the tunnel record `{tunnelId, clusterId, name}`, for §3's re-register;
  - **`host-key`**: the host's SSH key, made once, mode 0600;
  - **`credential`**: the GitHub token, mode 0600.
- **Secrets:** the token, the host key and every relay token are never logged and never printed (R-26). The token
  goes to the relay and to GitHub's `/user` only.
- **The servers it installs** live where Remote - SSH puts them for the same product: the client's server data folder
  (`~/<server data folder>/…`, from the source the client sends). So a machine reached both ways shares one install
  per commit, and Remote - SSH's clean-up rules see the same folders.

## 6. Service mode (F-8902 AC-17)

- **`service install`** writes a systemd **user** unit and runs `systemctl --user enable --now` on it. The unit is
  daedalus's draft on #3136: `Restart=always` after 10 s, after `network-online`, `UMask=0077` and
  `NoNewPrivileges`. Its name is the state folder's lib-identifiers constant plus `.service`, under
  `~/.config/systemd/user/`. The agent never uses `sudo`; if lingering is off, it prints one line saying the unit runs
  only while the user is logged in.
- **`service uninstall`** runs `systemctl --user disable --now` and removes the unit file. Afterwards the unit no
  longer exists.
- **Nothing else:** no system-wide unit, no root, and no keep-awake option.

## 7. Serving the editor's server (F-8104 AC-35)

- **lib-server does the work**, through a **local `HostChannel`** (a new lib-host channel: scripts run with the local
  `sh`, and files are copied locally). It runs the same probe, plan, transfer and start as Remote - SSH, with the
  client's server source and commit.
- **The platform:** the server obtained is the build for the host's platform, x64 or arm64.
- **Locks and clean-up** are lib-server's own (the install lock, F-2408; the old installs' clean-up, F-2413), so two
  clients asking at once share one install.
- **The connection token** is the one the client sent, else a fresh one. It's never logged.
- **The server's lifetime** follows lib-server's start-and-reuse rules. The agent keeps one server per commit while
  clients use it.

## 8. Proof, and the cards this brief makes (cut by daedalus)

- **Proof:** #3076's per-run relay runs the agent as the host. Our client's protocol subset (or a test client that
  speaks it) connects through the relay. A hosted job on Linux x64 and one on Linux arm64 each get the server for a
  commit the host lacks (F-8104 AC-35). #3076's job fits, with these additions (ADR-0016, Build and CI, 3):
  - **an arm64 leg** for the agent rows, on `ubuntu-24.04-arm`. Each leg builds the relay image itself, since two
    runners can't share a Docker network, so the image's Node base is pinned by its multi-platform index digest, not
    one platform's. The Rust client stage stays on x64 only: the agent rows need only the TypeScript test client;
  - **the agent's archive**, run with its own Node, as the host, with the stub identity's allowlisted test token on
    `login --token-stdin`;
  - **service mode on a hosted runner** (F-8902 AC-17) needs `systemctl --user` for the runner's account. That's
    measured first with a probe, not assumed. If it can't run there, the rows run the unit in a systemd container.
- **Cards, in order:**
  1. lib-host's local `HostChannel`, with rows against lib-server's script goldens.
  2. The agent skeleton: the package, check-layout and the network rule (ADR-0016), configuration and state (§5),
     `--version`.
  3. Sign-in (§2 `login`, device flow and `--token-stdin`) and the stored credential.
  4. Registration, re-register and rename (§3; F-8201 AC-41 to AC-43).
  5. The control protocol subset (§4), with daedalus's inventory.
  6. Serving the server through lib-server (§7; F-8104 AC-35).
  7. Service mode (§6; F-8902 AC-17).
  8. The build and release (proteus; ADR-0016, Build and CI; F-8902 AC-18): the archive build with its Node pin and
     notices, the `tunnel-agent` job, the agent rows' arm64 leg in #3076's job, and the tag-triggered release
     workflow.

## 9. For the user, through hermes

- **The OAuth app needs the device flow enabled.** The GitHub OAuth app the user registers at the first staging
  deployment must have the device flow turned on, for the agent's sign-in on a host with no browser.
