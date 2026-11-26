# Brief: the Remote - Tunnels client (D-107)

Status: draft by athena. §5's mechanism waits on the user's answer about the SSH library (§9); the rest stands on its
own. Sources:
- `[dev-tunnels]` = `microsoft/dev-tunnels` at `64048c1409ff` (ADR-0014), the TypeScript SDK `ts/src`;
- `[cli]` = VS Code OSS `cli/src` at 1.139.1;
- `[oss]` = VS Code OSS at 1.139.1.

Decisions of the user: D-107 and its answers (remote-oss/remote-server#21, #22). Our rules: `ruling-22-tunnel-rules`,
`ruling-22-open-four` (remote-server#22), `ruling-re21-providers` (remote-explorer#21), `ruling-3095-state-classes`.
The relay is `brief-relay.md`, and the host is `brief-agent.md`.

## 1. What the client is

- **The Remote - Tunnels extension**, `packages/remote-server` (id `remote-oss.remote-server`, F-8901). It signs in
  with GitHub, lists the account's tunnels, and resolves `vscode-remote://tunnel+<name>` windows through our relay to
  a machine running our host agent.
- **What it never does:**
  - send a request to Microsoft's tunnel service, or to any address but the relay's (F-8902 item 8);
  - send telemetry (R-28);
  - update or download a CLI (F-8104 AC-34; F-8902 rule 4).

## 2. The relay's address

- **One domain, in the package:** `relay.json` (`{"domain": "<domain>"}`) beside the manifest. The release build writes
  it, once the user names the domain at the first staging deployment (F-8902 item 8). There's no setting for it
  (R-60).
- **Tests** (proteus's wiring, beside #3076):
  - the acceptance harness writes the per-run relay's domain into the installed copy's `relay.json`;
  - a `tunnels` launch publishes the relay on the runner's loopback (`127.0.0.1:443`), and every name the relay hands
    out resolves there (`cp.<domain>`, `<domain>`, and any `*.<domain>`). The run's domain is under `.localhost`,
    which systemd-resolved on Ubuntu resolves to loopback, so no hosts file or wildcard is needed. A probe on a
    hosted runner confirms this before §8's rows rely on it; the fallback is a local DNS for the run's domain;
  - the editor gets the run's CA as `NODE_EXTRA_CA_CERTS` in its environment, never `NODE_TLS_REJECT_UNAUTHORIZED`.
    So the extension host's `https` and the client leg's TLS both trust it. The skeleton card's first row proves it
    with a management-client `GET`.
- **The management client:** the SDK's, with our domain as its custom domain (`[dev-tunnels]`
  `ts/src/management/tunnelManagementHttpClient.ts:275`), at the relay's API version (brief-relay §2). Its HTTPS goes
  through Node's `https` in the extension host, so the editor's proxy settings apply (F-8203).

## 3. Sign-in (F-8102)

- **The provider:** the editor's `github` provider, through `vscode.authentication.getSession`, with `[cli]`'s
  scopes, `read:user` and `read:org` (`[cli]` `auth.rs:96`; ruling item 2). Core creates a session if there's none
  (BR-4).
- **Microsoft sign-in isn't offered** (D-107 item 4).
- **The token goes to the relay only**, as the `github` scheme brief-relay §3 accepts. It's never logged (R-26).
- **A refused account:** the relay's refusal shows "The tunnel service doesn't admit the GitHub account {0}." ({0} is
  the login, ruling item 1). Connect to Tunnel then offers another account, and a resolve doesn't.
- **What Remote Explorer is told:** the `isAuthenticated` query's answer carries `providers: ["github"]`
  (`ruling-re21-providers`).

## 4. Listing tunnels (F-8101, F-8201)

- **The list** is `GET /tunnels` on the relay: the account's own tunnels, owner-only (brief-relay §4).
- **Its bound:** the relay's answer is bounded at 15 s from sending the request. Past that, the listing fails with
  "Retry" (F-8101 AC-29, 7.E6). A core sign-in dialog waiting for the user is outside the bound.
- **Create a Tunnel** opens the host agent's page, `https://github.com/remote-oss/remote/blob/main/docs/remote-tunnels/host-agent.md` (ruling item 5).
- **For Remote Explorer (`getTunnelsList`, F-8201):**
  - each row is a tunnel by name, with no WSL distribution (AC-41);
  - a rename shows the new name with the same id (AC-42).
- **Folder history per tunnel:** a record many windows add to, so it's class A (`ruling-3095-state-classes`).
  - It's per-session event files under the extension's global storage, through lib-state, keyed by the tunnel's
    **name**. So a rename leaves the old history under no row (AC-42).
  - The catalogue's `remote-tunnels.folder-history` in global state is superseded by this.

## 5. Connecting a window (F-8103)

- **The resolver** for `tunnel+<name>`:
  1. finds the tunnel, and a connect token for it (brief-relay §4);
  2. opens the client leg (§5's mechanism);
  3. connects to the tunnel's port 31545, the agent's control protocol (brief-agent §4);
  4. reads the agent's `version`. A protocol version other than 6 shows "Your tunnel connection is outdated, please
     upgrade to the latest version to continue using tunnels." with "Upgrade". "Upgrade" opens this extension's page
     through core's `extension.open` (`ruling-22-open-four` point 1), and the resolve fails;
  5. runs Remote - SSH's licence gate on its own product (F-2409; F-3902 rule 11), asking the user here if the source
     needs acceptance, then calls `serve` with the editor's commit and quality and **its server source**: a
     `Pick<ProductProfile, …>` of its product (identity, server names, download template and redirect hosts, licence
     fields), carrying `licenceAccepted`. The agent resolves it for its own platform (`ruling-3163-serve-inputs`).
     `ServeParams.extensions` carries the default extensions, and `compress` is false (the agent refuses `true`, as it
     does `use_local_download`, #3162);
  6. returns core's managed authority (`[oss]` `src/vscode-dts/vscode.proposed.resolvers.d.ts:46`,
     `ManagedResolvedAuthority`). Each connection core makes is one `socket_id` over `servermsg`, closed by
     `serverclose`.
- **No CLI update prompt** at any `remote.tunnels.alwaysUpdateCLI` value (F-8104 AC-34). The client never calls
  `update`.
- **The mechanism for the client leg (waits on §9):**
  - **If the user allows the library (option a):** the SDK's own client, `TunnelRelayTunnelClient`
    (`[dev-tunnels]` `ts/src/connections/tunnelRelayTunnelClient.ts`), on `@microsoft/dev-tunnels-ssh`, in the
    extension. Only this extension uses it, and only for the tunnel protocol. ADR-0014 decision 2's sentence and
    ADR-0004's scope note are amended to say so.
  - **If not (option b):** a local helper process holds the client leg, our agent's archive run in a client mode, and
    the extension talks to it over a local socket. That moves §5 and §6's streams into that helper, and adds its
    download to the client machine.

## 6. Forwarded ports (F-8202)

- **Core's tunnel factory** (`[oss]` `vscode.proposed.resolvers.d.ts:417`, `tunnelFactory`) is the client's. For
  each port core forwards:
  1. call the agent's `forward` (private, brief-agent §4);
  2. open one listening socket on the loopback, on the remote port's number if it's free, otherwise another. The SDK
     client does this when it accepts local connections for forwarded ports (`[dev-tunnels]`
     `ts/src/connections/tunnelClient.ts:45,83,96`);
  3. return `localhost:<local port>` as the forwarded address.
- **The Ports view** shows that address, with Visibility "Private" (`ruling-22-open-four` point 3). No web address
  and no "Open in Browser" on a relay address (the user's answer, point 7).
- **Unforward** closes the listener and calls `unforward`.
- **A port refused for the limit** (10 per tunnel, brief-relay §6) shows the relay's refusal with "Show Limits"
  (`STR:S022`, F-8203 7.E3).

## 7. Usage limits (F-8203)

"Remote-Tunnels: Show Usage Limits" reads `/userlimits` (`ruling-22-open-four` point 2):
- `STR:S001` then `STR:S013` when any of the three count limits is reached;
- otherwise `STR:S014` then `STR:S013`.

`STR:S025` and `STR:S026` are never shown.

## 8. Proof, and the cards this brief makes (cut by daedalus)

- **Proof:** the client rows run in a VSCodium acceptance job for a `tunnels` launch, on a hosted Linux runner. Before
  the editor starts, that job starts #3076's relay stack itself (the relay and stub-identity images, built in the job)
  and the agent from the `tunnel-agent` artifact. So that launch's job needs `tunnel-agent`, and the harness gains a
  fixture for the stack. This wiring is proteus's.
- **Cards, in order:**
  1. The package skeleton, `relay.json` and the management client (§2).
  2. Sign-in and the providers answer (§3).
  3. The list, its bound, Create a Tunnel, and `getTunnelsList` (§4).
  4. The folder history on lib-state (§4), after #3100 creates lib-state. It also updates `remote-server-18.json`'s
     folder-history lines.
  5. The resolver and the control protocol (§5), once §9 is answered.
  6. Forwarded ports (§6).
  7. Usage limits (§7).

## 9. For the user, through hermes (asked 2026-11-24)

- **May this extension use `@microsoft/dev-tunnels-ssh` for the tunnel protocol's SSH session?** That session is "none"
  key exchange over the relay's authenticated WebSocket, which OpenSSH can't speak. The recommendation is (a), this
  extension only and only for the tunnel protocol; §5 lists both options.
