# Brief: the tunnel relay (Remote - Tunnels, D-107)

Status: agreed by proteus (§1–6 and §8; §7 after his correction). Sources: `[dev-tunnels]` = `microsoft/dev-tunnels` at `64048c1409ff`
(ADR-0014), `rs/src`, with the TypeScript SDK `ts/src` where named; `[cli]` = VS Code OSS `cli/src` at 1.139.1, which
pins that commit (`cli/Cargo.toml:36`). Every protocol fact below cites one of them. Decisions of the user: D-107
and its answers (remote-oss/remote-server#21). Our own rules: `ruling-22-tunnel-rules` (remote-oss/remote-server#22).

## 1. What the relay is

- **One HTTPS service** with the dev tunnels management API at `https://cp.<domain>`, and the relay's WebSocket legs.
  `cp.<domain>` is the SDK's custom-domain form (`[dev-tunnels] management/http_client.rs:578-591`). With a custom
  domain, the client doesn't rewrite cluster host names (`:418-433`), so release 1 is **one cluster**, with a fixed
  `clusterId` that matches the contract's pattern (`contracts/tunnel_constraints.rs:8,11,101`). The client builds
  every later address from what the relay returns, so the domain appears only in the relay's own configuration.
- **Who reaches it:** our client (Remote - Tunnels), our host agent (remote-server), and any MIT SDK client or host
  built with the custom domain. The editor's `code tunnel` can't be pointed elsewhere, since `[cli]` calls only
  `new_tunnel_management` (`tunnels/dev_tunnels.rs:332,350`). That is why the host is our own agent (D-107 question 5).
- **Release 1's scope:**
  - only listed GitHub accounts;
  - private access only;
  - no web addresses for ports (`ruling-22-tunnel-rules` 7; the user, 2026-11-22, via hermes);
  - our own limits (§6).

## 2. The management API the relay serves

- **The API version** is `api-version=2023-09-27-preview` on every call (`http_client.rs:44,684-685`). A request
  with another version gets 400.
- **Query parameters:** `includePorts`, `includeAccessControl`, `tokenScopes=a,b`, `forceRename`, `labels`, `allLabels`
  and `limit` (`:662-690`). `labels` with `allLabels=true` must match every label, since `[cli]` finds its tunnel that way
  (`tunnels/dev_tunnels.rs:431-442,792-805`).
- **Routes** (`http_client.rs:38-42,61-307`):

| Route | Release 1 |
|---|---|
| `GET /tunnels?global=true` and `GET /tunnels` | The caller's own tunnels, in the by-region shape `{value:[{regionName, clusterId, value:[Tunnel]}], nextLink}` (`contracts/tunnel_list_by_region_response.rs:11-18`) |
| `GET /tunnels/{id or name}` | One tunnel |
| `PUT /tunnels/{id}` | Create, with the client choosing the id, which must match the id pattern (`tunnel_constraints.rs:17,23,122`). If it exists and is the caller's, this is an update with **merge** semantics: absent fields are kept, and read-only fields sent back are ignored (`[cli] dev_tunnels.rs:496-500,732-737`) |
| `GET /tunnels/{name}:checkNameAvailability` | `true` or `false` |
| `DELETE /tunnels/{id}` | Delete. 404 if it's absent (`http_client.rs:347-348`) |
| `PUT /tunnels/{id}/endpoints/{eid}?connectionMode=TunnelRelay` | Register a host (§5) |
| `DELETE /tunnels/{id}/endpoints/{eid}` | Unregister. It accepts both `{hostId}-relay` and `{hostId}` (`[dev-tunnels] connections/relay_tunnel_host.rs:251,401`; `[cli] dev_tunnels.rs:599-608`) |
| `GET/PUT/DELETE /tunnels/{id}/ports[/{n}]` | Ports. A PUT of an existing port with the same protocol succeeds, a changed protocol is 400 with the detail `The tunnel port protocol cannot be changed.` (`[cli] dev_tunnels.rs:38,1040-1049`), and 409 is read as "exists" (`relay_tunnel_host.rs:287`) |
| `GET /userlimits` | Our limits as `NamedRateStatus` (`contracts/rate_status.rs:12-26`) |
| `GET /clusters` | Our one cluster, as `[ClusterDetails]` `{clusterId, uri: "https://cp.<domain>", azureLocation: ""}` (the TypeScript SDK's `listClusters`, `ts/src/management/tunnelManagementHttpClient.ts:687-698`; `ts/src/contracts/clusterDetails.ts:11-26`) |
| `GET /clusters/recommendations` | **404**, with a ProblemDetails body. The npm TypeScript SDK 1.3.82, which T.6 ran, asks it before creating a tunnel. In T.6 (run 45110368187) our relay answered 404 and the host carried on with the one cluster. The family's own pin is 1.3.50 (ADR-0016), and the relay answers the same to any version. The route isn't in `[dev-tunnels]` at the pin, so the relay offers no recommendation |

- **Shapes:** the `[dev-tunnels] contracts` types, camelCase, with null fields left out. Every `Tunnel` the relay returns
  carries `clusterId` and `tunnelId`, which `[cli]` unwraps (`dev_tunnels.rs:449,580,638,692-693`).
  - `accessTokens` holds a token per requested scope whenever `tokenScopes` is sent, on get, create and update alike
    (`:274-282,302-307,571-581`).
  - `ResourceStatus` values are plain integers (`contracts/resource_status.rs:8-13,25-43`).
- **The name rules are the contract's.** A name is empty, or 3 to 49 characters matching
  `[a-z0-9][a-z0-9-]{1,47}[a-z0-9]` (`tunnel_constraints.rs:29,35,140`). Labels are at most 100, each 1 to 50
  characters of `[\w-=]` (`:53-59,143`). Descriptions are at most 400 characters (`:41`). Anything else gets 400. The
  relay accepts exactly what the SDK's patterns allow, and compares names case-insensitively, holding them in lower
  case. A rename keeps the id. A name is unique per account (`ruling-22-tunnel-rules` 10).
- **Errors:**
  - every non-2xx answer has an RFC 7807 body `{title, detail}` (`contracts/problem_details.rs:16-28`) and a
    `VsSaaS-Request-Id` header, which the client records (`http_client.rs:345-362`);
  - texts are ours, except the two the clients match: `TunnelsPerUserPerLocation` (§6) and the port-protocol detail
    above.

## 3. Sign-in and the allowlist

- **Accepted schemes** (`[dev-tunnels] management/authorization.rs:10-32`):
  - `github <token>`;
  - `github client_id=<id> <token>`, the `[cli]` form (`auth.rs:491-503`), where the relay takes the last field as the
    token;
  - `tunnel <token>` for the relay's own tokens (§4).

  `aad` and `bearer` get 401, with the detail "Sign in with a GitHub account." (GitHub only, D-107 question 4).
- **Who the token belongs to:** the relay calls `GET https://api.github.com/user` with the token, and caches the
  answer for five minutes, keyed by a hash of the token (at most 1,000 accounts, least recently used out first). A
  token GitHub refuses is held as refused for 60 s, keyed the same way. A source address gets at most 10 lookups a
  minute for tokens in neither cache, then 429 with `Retry-After`. An unauthenticated `/user` counts against the
  relay's own limit at GitHub (`ruling-3207-relay-hardening`). The account is its **numeric `id`**. Any GitHub token that
  identifies an account works, a personal access token included (`ruling-22-tunnel-rules` 2). The scopes our client
  and agent ask for are `read:user`, the identity part of `[cli]`'s `read:user+read:org` (`auth.rs:96`). The relay
  needs no organization data.
- **The allowlist:** a file of numeric GitHub ids in the relay's deployment, kept by the operator (the user, 2026-11-22,
  via hermes; `ruling-22-tunnel-rules` 4, remote-oss/remote-server#22). An account not on it gets **403** with the detail
  `The tunnel service doesn't admit the GitHub account {login}.`. Our client shows that text, and offers to sign in
  with another account (F-8101's re-sign-in sequence).

## 4. Tunnels, ownership and tokens

- **The owner:** a tunnel is its creator's, by numeric id. Release 1's access is **owner only**: the owner manages,
  hosts and connects. That is "private" in the protocol's terms.
- **Access control:** the relay stores the ACL it's given (`contracts/tunnel_access_control_entry.rs:16-89`), and
  honours only deny entries and the owner. An **allow** entry of type `Anonymous` (public) gets 400 with the detail
  "Public access isn't offered." `[cli]`'s private ports send an `Anonymous` *deny* entry (`[cli] dev_tunnels.rs:1288-1317`),
  which is accepted. Other entry types are kept, and grant nothing in release 1.
- **Tokens:**
  - The relay issues a JWT per scope it's asked for (`host`, `connect`, `manage:ports`;
    `contracts/tunnel_access_scopes.rs:15-32`), signed with the relay's own key, with the claims `exp`, `scp`, `tid`
    and `cid`. The TypeScript SDK reads only `exp` (`ts/src/management/tunnelAccessTokenProperties.ts:11-12,70-72`).
  - The lifetimes are 24 h for `host`, and 1 h for `connect` and `manage:ports`. `[cli]` fetches the host token again
    on each reconnect (`[cli] dev_tunnels.rs:156-180`).
  - `tunnel <token>` is valid only for its tunnel and its scopes. The claims also carry `own`, the owner's numeric id,
    and `gen`, a random generation stored with the tunnel at its creation: new on every create, kept on update. On
    use, the stored tunnel must match both, so a deleted id created again, by anyone, refuses every older token
    (`ruling-3207-relay-hardening`).

## 5. The relay's two WebSocket legs

- **Registering a host:** `PUT …/endpoints/{uuid}-relay` with `{id, connectionMode:"TunnelRelay", hostId,
  hostPublicKeys:[ssh-rsa base64]}` and `Authorization: tunnel <host token>` (`relay_tunnel_host.rs:144,396-428,450-467`).
  The answer adds `hostRelayUri`, `clientRelayUri` and `portUriFormat`. `[cli]` requires the last (`dev_tunnels.rs:247-249`),
  so release 1 returns `https://{tunnelId}-{port}.<domain>/`, an address that answers 404 while ports have no web
  addresses.
- **The host leg:** `hostRelayUri`, with subprotocol `tunnel-relay-host` and `Authorization: tunnel <host token>`
  (`relay_tunnel_host.rs:430-437`).
  - The relay echoes the subprotocol, and acts as the **SSH server** of the host's session. That session is
    anonymous, with key exchange, host key and cipher all `none`, and no compression (`:367-383,951-956`). The source
    calls it non-standard (`:79-82`).
  - For each client, the relay opens a channel of type `client-ssh-session-stream` on the host's session, and pipes
    the client's bytes through it (`:82-106,958-969`).
- **The client leg:** `clientRelayUri`, with subprotocol `tunnel-relay-client` and `Authorization: tunnel <connect
  token>` (`relay_tunnel_client.rs:78-91`).
  - The relay doesn't read the client's bytes: they are an SSH session end to end with the host, whose key the client
    checks against `hostPublicKeys` (`:112-121,137-149,369-395`).
  - So port forwarding (`tcpip-forward`, `direct-tcpip`; `relay_tunnel_host.rs:708-763`) and the control protocol on
    port 31545 (`[cli] constants.rs:14-15`) are the host agent's and the client's business, not the relay's.
- **Keep-alive:** each side pings after 60 s idle and closes if no pong comes in 10 s (`ws.rs:147-187`). The relay
  answers pings, and closes a leg idle for 120 s.
- **Not offered in release 1:** the TypeScript SDK's `-v2-dev` subprotocols (`ts/src/connections/tunnelRelayTunnelHost.ts:63`,
  `tunnelRelayTunnelClient.ts:42`). A client that asks only for them is refused at the upgrade.

## 6. Our limits (F-8203), as the user answered (2026-11-22, via hermes; remote-oss/remote-server#22)

- **Tunnels per account:** 10. One more create gets **429** with a detail containing `TunnelsPerUserPerLocation`,
  which `[cli]` matches to delete an idle tunnel and retry (`dev_tunnels.rs:37,657-679,746-773`).
- **Ports per tunnel:** 10, then 429 with the detail "This tunnel already has 10 ports."
- **Connected clients per tunnel:** 10, then a refused client WebSocket upgrade (403).
- **What `/userlimits` reports:** these limits, by name.

## 7. The relay's language: TypeScript (ADR-0015)

**A correction, from proteus's read:** an earlier draft said no JavaScript SSH library offers the host leg's `none`
exchange. `[dev-tunnels]`'s own TypeScript SDK depends on one, `@microsoft/dev-tunnels-ssh` (MIT, `ts/package.json:24-25`).
Its V1 host opens that leg with `new SshClientSession(new SshSessionConfiguration(false)); // no encryption`
(`ts/src/connections/tunnelRelayTunnelHost.ts:224-225`), and the same library has `SshServerSession` (`:23,89-95`).

- **Chosen: TypeScript.** The relay's host leg is a dev-tunnels-ssh `SshServerSession` with
  `SshSessionConfiguration(false)`.
  - **Why:** it keeps one toolchain, so every gate we have applies unchanged, and every coder writes TypeScript.
  - **What it needs:** ADR-0014 also admits `microsoft/dev-tunnels-ssh` (MIT, the SDK's own dependency) as a source and
    a dependency.
  - **ADR-0004 is unaffected:** the relay is a service, and no extension's SSH connection goes through it.
- **Settled by the spike (ADR-0015, accepted 2026-11-23):** run 45110368187 (remote-oss/remote#3050) showed the
  TypeScript server session completing the host leg, all `none`, with **both** `[dev-tunnels]`'s Rust host (`russh` with
  `[cli]`'s patch: the path `[cli]` takes) and its TypeScript host. It also showed a 64 KiB payload from the TypeScript
  client coming back byte for byte through a `client-ssh-session-stream` channel, for each host. So the Rust fallback
  wasn't needed. It would also have needed `russh` (Apache-2.0) admitted, as ADR-0015 records.
- **Carried into the relay cards:** dev-tunnels-ssh's `WebSocketStream` reuses the buffer it hands `send` for the next
  packet, so the relay copies each buffer before sending it (ADR-0015 T.1).

## 8. Proof, and the cards this brief makes (cut by daedalus)

- **Wire compatibility is proven with both SDKs' own clients.** A conformance suite drives `[dev-tunnels]`'s Rust
  host (`[cli]`'s path) and its TypeScript client (the Remote - Tunnels extension's path), and the Rust management
  client, against the per-run relay (proteus's container). The Rust parts are built inside that container's image, so
  no Rust enters the PR gates. It covers: every route in §2,
  the auth answers of §3, the tokens of §4, a host and a client through §5's legs, and each limit in §6.
- **Cards, in order:**
  1. ~~The language spike (§7), then ADR-0015~~: done (run 45110368187; ADR-0015 accepted, #3056).
  2. The relay skeleton: the HTTPS service, the store (one SQLite file) and the routes of §2 with the contract types.
  3. Sign-in, the allowlist and tokens (§3, §4).
  4. The WebSocket legs (§5).
  5. Limits (§6).
  6. The per-run relay container and the conformance suite: proteus.

  The host agent's and the client's briefs follow this one.
