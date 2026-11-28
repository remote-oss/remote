# Brief: the Remote - Tunnels client (D-107)

Status: proposed by athena, for proteus's agreement. The user answered §9 on 2026-11-28 (relayed by hermes): "Lets use
`@microsoft/dev-tunnels-ssh`". It runs in the extension's local proxy (§5.1). Sources:
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
    The local proxy inherits that environment, so its `https` and the client leg's TLS both trust it. The skeleton card's first row proves it
    with a management-client `GET`.
- **The management client:** the SDK's, with our domain as its custom domain (`[dev-tunnels]`
  `ts/src/management/tunnelManagementHttpClient.ts:275`), at the relay's API version (brief-relay §2). Its HTTPS runs
  in the local proxy (§5.1), so the editor's proxy settings don't reach it by themselves. The window passes
  `http.proxy`, `http.proxyStrictSSL` and `http.noProxy` to the proxy at attach, and the proxy uses them for the
  relay's HTTPS and the client leg's WebSocket (F-8203).

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
- **Online and Offline:** a tunnel is Online when the listing's `status.hostConnectionCount` is above 0. The relay
  counts live host legs (brief-relay §4). Offline tunnels follow under "Offline" (F-8101 AC-22, provisional Q1).
- **A row's description** is the tunnel's host name once the profile has connected to it, and empty before (F-8101
  AC-10). The agent puts the machine's host name in the tunnel's `description` when it registers (brief-agent §3). The
  client records it in the folder history at its first connect and shows it from there.
- **Create a Tunnel** opens the host agent's page, `https://github.com/remote-oss/remote/blob/main/docs/remote-tunnels/host-agent.md` (ruling item 5).
- **For Remote Explorer (`getTunnelsList`, F-8201):**
  - each row is a tunnel by name, with no WSL distribution (AC-41);
  - a rename shows the new name with the same id (AC-42).
- **Folder history** is the global-state entry `remote-tunnels.folder-history` under `remote-oss.remote-server`.
  - It's an empty map at first activation, keyed by the tunnel's **name**, so a rename leaves the old history under no
    row (AC-42).
  - No file is written: not in global storage, not in the window's temporary folder (F-8001 AC-19, AC-25; F-8201
    AC-24, AC-31; F-8203 AC-18).
  - That's the criteria's rule, and it supersedes `ruling-3095-state-classes`' class-A placement for this one record
    (`ruling-3331-history-global-state`).
  - An add is a read, merge and write of the entry, and two windows adding at the same moment keep the later write,
    as the reference does.

## 5. Connecting a window (F-8103)

### 5.1 The local proxy (F-8103 BR-6)

- **One local proxy per profile:** a helper process of this extension holds the tunnel connection, and every window
  of the profile shares it. The user's answer (§9) is about the library; BR-6 fixes the process. The library runs
  there, still in this extension only.
  - **How it starts:** lib-helper's detached start, on the editor's own runtime (`ELECTRON_RUN_AS_NODE`), running the
    extension's bundled proxy program.
  - **Its socket** is `vscode-tunneling-<16 hex>.sock`, a new random name each time, in the user's runtime folder
    (`$XDG_RUNTIME_DIR` on Linux, else lib-helper's endpoint folder; a named pipe on Windows).
  - **Its record:** the profile's proxy record goes in the same runtime folder, not global storage. lib-helper gains a
    record-location option for it, since today it keeps its registry under global storage.
  - It's never shared across profiles (BR-6).
- **Its life:**
  - **A resolve** starts a proxy, or attaches to the profile's running one (AC-21).
  - **A reload** reuses the proxy, with no account question and no "Connecting to" notification (AC-4).
  - **A proxy that doesn't answer for about 30 s** is replaced by a new one on the next resolve (AC-6).
  - **After the last tunnel window of the profile disconnects,** it ends within about a minute. It can outlive a
    window and the editor until then (AC-21, AC-29).
  - **A proxy that can't start** leaves the window failed with an error message and no modal dialog (AC-30).
- **The window gives the proxy the GitHub session's token** over the owner-checked local socket (lib-helper's nonce).
  The proxy uses it for the relay only, and never logs it (R-26).
- **`serve` runs once per proxy:** at its first resolve, with the default-extension list effective then. A window that
  reuses the proxy reuses that server, so a changed list applies only after the proxy has ended (F-8104 AC-10).

### 5.2 The resolver for `tunnel+<name>`

1. **Attach:** start or attach to the local proxy (§5.1).
2. **Find:** the proxy finds the tunnel and a connect token for it (brief-relay §4), and opens the client leg.
3. **Control port:** it connects to the tunnel's port 31545, the agent's control protocol (brief-agent §4).
4. **Version:** it reads the agent's `version`. A protocol version other than 6 shows "Your tunnel connection is
   outdated, please upgrade to the latest version to continue using tunnels." with "Upgrade", which opens this
   extension's page through core's `extension.open` (`ruling-22-open-four` point 1). The resolve then fails.
5. **Serve:** the window runs Remote - SSH's licence gate on its own product (F-2409; F-3902 rule 11), asking the
   user here if the source needs acceptance. The proxy then calls `serve` with:
   - the editor's commit and quality;
   - **its server source:** a `Pick<ProductProfile, …>` of its product (identity, server names, download template and
     redirect hosts, licence fields), carrying `licenceAccepted`. The agent resolves it for its own platform
     (`ruling-3163-serve-inputs`);
   - `ServeParams.extensions` with the default extensions;
   - `compress` false. The agent refuses `true`, as it does `use_local_download` (#3162).
6. **Progress:** the agent's `serverprogress` notifications show "Downloading VS Code Server..." and then
   "Extracting VS Code Server..." while it installs (F-8104 AC-22, AC-32). A present server shows neither (AC-23).
   The agent's `serverlog` lines go to the output channel at the levels the agent gives: an install failure at
   Info, the install's steps at Trace (AC-13, AC-27).
7. **Authority:** the window returns core's managed authority (`[oss]` `src/vscode-dts/vscode.proposed.resolvers.d.ts:46`,
   `ManagedResolvedAuthority`). Each connection core makes is a stream to the proxy's socket, which the proxy carries
   as one `socket_id` over `servermsg`, closed by `serverclose`.

- **No CLI update prompt** at any `remote.tunnels.alwaysUpdateCLI` value (F-8104 AC-15, AC-21, AC-34; F-8902 AC-6).
  The client never calls `update`. F-8104 AC-16 to AC-20 and AC-26 describe a host that reports an update, which the
  project's agent never does. They're asked of metis (§9).

### 5.3 The library

- **The mechanism for the client leg (the user's answer, §9):** the SDK's own client, `TunnelRelayTunnelClient`
  (`[dev-tunnels]` `ts/src/connections/tunnelRelayTunnelClient.ts`), on `@microsoft/dev-tunnels-ssh`, in the local
  proxy.
  - **Only this extension uses it, and only for the tunnel protocol:** the relay's `none`-exchange SSH session over its
    authenticated WebSocket, which OpenSSH can't speak. Every connection to an SSH host stays OpenSSH's (ADR-0004,
    whose scope note and ADR-0014 decision 2 say so).
  - **Versions:** `@microsoft/dev-tunnels-connections`, `-management` and `-contracts` at **1.3.50**, with
    `@microsoft/dev-tunnels-ssh` and `-ssh-tcp` at **3.12.29**. That's the agent's pin (ADR-0016 decision 1,
    `ruling-3159-sdk-pin`), so the family has one SDK and one ssh. 1.3.50 already has `TunnelRelayTunnelClient`, so
    the client needs no other version. A later SDK move moves all three users (relay, agent, client) in one change.
  - **The bundle, per ADR-0016's bundle rules:** esbuild into the proxy program's bundle, with no native addon. The
    connections package's WebSocket is the `websocket` package, whose two addons (`bufferutil`, `utf-8-validate`)
    are left out, so it runs on its JavaScript paths. The build fails if the metafile names a `.node` file or
    `node-gyp-build` (ADR-0002 rule 8). Every bundled package's licence goes into the extension's notices: the SDK
    and ssh (MIT), `websocket` (Apache-2.0, with its `NOTICE` whole) and `es5-ext` (ISC), by ADR-0002 decision 8.

## 6. Forwarded ports (F-8202)

- **Core's tunnel factory** (`[oss]` `vscode.proposed.resolvers.d.ts:417`, `tunnelFactory`) is the client's. For
  each port core forwards, the window asks the local proxy, which:
  1. calls the agent's `forward` (private, brief-agent §4);
  2. opens one listening socket on the loopback, on the remote port's number if it's free, otherwise another. The SDK
     client does this when it accepts local connections for forwarded ports (`[dev-tunnels]`
     `ts/src/connections/tunnelClient.ts:45,83,96`). A port two windows forward is one listener, counted per window;
  3. returns `localhost:<local port>` as the forwarded address.
- **The Ports view** shows that address, with Visibility "Private" (`ruling-22-open-four` point 3). No web address
  and no "Open in Browser" on a relay address (the user's answer, point 7). F-8202 AC-3 and AC-25 describe a port's
  web address, so they're asked of metis (§9).
- **Unforward** drops the window's count, and at zero closes the listener and calls `unforward`.
- **A port refused for the limit** (10 per tunnel, brief-relay §6) shows the relay's refusal with "Show Limits"
  (`STR:S022`, F-8203 7.E3).

## 7. Usage limits (F-8203)

"Remote-Tunnels: Show Usage Limits" reads `/userlimits` (`ruling-22-open-four` point 2):
- `STR:S001` then `STR:S013` when any of the three count limits is reached;
- otherwise `STR:S014` then `STR:S013`.

For a per-tunnel limit, the current value is the highest count over the account's tunnels, which the relay reports
(brief-relay §6, F-8203 AC-30). `STR:S025` and `STR:S026` are never shown.

## 8. Proof, and the cards this brief makes (cut by daedalus)

- **Proof:** the client rows run in a VSCodium acceptance job for a `tunnels` launch, on a hosted Linux runner.
  - Before the editor starts, that job starts #3076's relay stack itself (the relay and stub-identity images, built
    in the job) and the agent from the `tunnel-agent` artifact. So that launch's job needs `tunnel-agent`, and the
    harness gains a fixture for the stack. This wiring is proteus's.
  - **The local proxy is an accounted-for process:** the harness's leftover close (#3293) leaves it alone, and the
    lifetime rows read it.
  - **The web rows (C10)** run on VSCodium's `serve-web` with the extension sideloaded, after a proteus probe shows
    it loads there.
- **Every criterion has a card:** `criteria-cards.tsv`, beside this brief, names each of the family's 340 criteria
  (F-8001 to F-8302, F-8901 and F-8902) with its card. The coverage refresh's check reads it, and reports any
  coverage line it doesn't name. daedalus replaces `C1` to `C11` with card numbers there as he cuts them.
- **Client cards:**
  - **C1, the package and activation** (F-8001's desktop items, F-8901): manifest, activation, coexistence,
    localisation, no telemetry, `relay.json`, and the management client (§2).
  - **C2, sign-in** (F-8102): §3, Switch Account, `signIntoTunnelWithDifferentAccount`, and the providers answer.
  - **C3, Connect to Tunnel** (F-8101): its commands, menus, context keys, settings, and the picker with its groups,
    Learn More, Switch Account, the list's bound, Online and Offline, descriptions, and Create a Tunnel (§4).
  - **C4, Remote Explorer's data and actions** (F-8201): `getTunnelsList`, `getActiveRemote`, `connectToRemote`,
    `deleteFolderFromHistory`, `unregisterTunnel`, `isConnectedToRemote`, `setActiveFolders`, and the folder history
    in global state (§4).
  - **C5, the local proxy** (§5.1): lib-helper's record-location option, the proxy program with the SDK client
    (§5.3), its socket, sharing, lifetime, the once-per-proxy `serve`, and the token hand-over.
  - **C6, the resolver and the connected window** (F-8103, F-8104's client side): §5.2, progress, the output
    channel, the label formatter, Close Remote Connection, reconnection, and the connection's error paths.
  - **C7, forwarded ports** (F-8202): §6.
  - **C8, usage limits** (F-8203): §7.
  - **C9, help, settings and issue reporting** (F-8002).
  - **C10, the web entry** (F-8001's web items, F-8301, F-8302): the browser bundle, the Explorer welcome view,
    Continue Working in VS Code Desktop, and no `vscode-remote` web opener.
  - **C11, the browser resolver:** a `tunnel+` window in a web editor, which F-8301's rows need. It waits on the
    user's F-1403 item (proposal grants in a web build), already queued, and those rows are pending until it lands.
- **Changes to the agent's open cards:**
  - **#3162:** the `serverprogress {phase: "downloading" | "extracting"}` notification during `serve` (ours, beside
    `server_source`), and `serverlog`'s levels (brief-agent §4);
  - **#3163:** the default extensions at a new server's start and into a running server (brief-agent §7);
  - **the registration card (#3286, or its follow-up):** the tunnel's `description` is the host name (brief-agent §3).
- **Relay follow-ups:**
  - **R1:** the listing's `status.hostConnectionCount` from live host legs (brief-relay §4);
  - **R2:** `/userlimits`' per-tunnel current value is the highest over the account's tunnels (brief-relay §6).

## 9. The user's answer, and the questions for metis

- **The user's answer (asked 2026-11-24, answered 2026-11-28):** may this extension use `@microsoft/dev-tunnels-ssh`
  for the tunnel protocol's SSH session? The user: "Lets use `@microsoft/dev-tunnels-ssh`". That's option (a): this
  extension only, and only for the tunnel protocol (§5.3). It runs in the extension's local proxy, which F-8103 BR-6
  requires.
- **For metis, in one design issue:**
  1. F-8104 AC-16 to AC-20 and AC-26 prompt for an update on a host that reports one, which the project's agent
     never does (AC-34). Are they reference data for release 1?
  2. F-8102 AC-8 names the scope `user:email`, while BR-4 and `ruling-22-tunnel-rules` item 2 name `read:user` and
     `read:org`. Which holds?
  3. F-8202 AC-3 and AC-25 test a port's web address, which release 1 doesn't serve (the user's answer, point 7).
     Are they reference data?
