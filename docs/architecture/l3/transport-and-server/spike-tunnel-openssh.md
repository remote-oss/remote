# Spike: native OpenSSH to a tunnel host through a WebSocket bridge

- Status: final. The result rests on the protocol reading; **no live test by decision**: the Tunnels room reads
  the dev tunnels terms (§1(a), §5(a)) as allowing use only with Microsoft products, so a live test with the user's
  account would itself be a non-Microsoft client on the service (`remote-development`, 2026-10-06)
- Date: 2026-10-06
- Author: `remote-coding-worker-1`; assigned by `remote-architect`, authorized by `remote-development` as an
  investigation (D-55 pending)
- Context: `tunnel-client-alternatives.md`, `dossier.md` (A13), ADR-0004, ADR-0005 decision 2 (suspended), F-8902 Q1

## The question

Can the native OpenSSH client authenticate to a dev tunnel's host side through a WebSocket bridge that only carries
bytes, used as `ProxyCommand`?

## The answer

**Yes at the protocol level, for the protocol the editor's tunnel host speaks (relay protocol V1). Not shown live,
by decision (Status).** With a bridge that opens the relay WebSocket and pumps bytes, `ssh -N -L <local>:127.0.0.1:31545 -o
ProxyCommand=<bridge>` meets every requirement the host's SSH server imposes:

- The client's SSH session runs end to end to the tunnel host. The relay only proxies its bytes.
- The algorithms overlap with OpenSSH 10.3.
- Authentication is SSH `none`.
- The host accepts `direct-tcpip` channels to its registered ports.

The bridge carries bytes only, so ADR-0004 holds.

Two qualifications decide whether it is useful:

1. **Transport only.** What OpenSSH reaches is the tunnel CLI's control port (31545). That port speaks the CLI's own
   MessagePack RPC, not the VS Code server protocol. A client still has to call the RPC's `serve` method and carry
   the server's traffic in `servermsg` messages. That is an application protocol in our extension code, with no
   SSH in JavaScript, but it is an undocumented interface that changes with editor releases.
2. **Terms.** The dev tunnels licence terms limit use to Microsoft products (risks below). This is F-8902 Q1 and the
   user's decision, not the protocol's.

## Evidence

Sources read, all as documentation:
- **[cli]:** VS Code OSS `cli/` at tag 1.139.1 (MIT).
- **[tunnels-crate]:** the Rust crate the CLI pins, microsoft/dev-tunnels `rs/` at rev
  `64048c1409ff56cb958b879de7ea069ec71edc8b` (MIT), pinned at [cli] `Cargo.toml:36`.
- **[russh-fork]:** microsoft/vscode-russh at rev `fd4f608a`, which the CLI patches in for russh, pinned at [cli]
  `Cargo.toml:78-81` (MIT/Apache-2.0).
- **[dev-tunnels-ts]:** microsoft/dev-tunnels TypeScript `ts/` at `bb2a7db` and microsoft/dev-tunnels-ssh at
  `e65278d` (both MIT). Read only to compare client behaviour, never depended on or copied.
- **Public documentation:** learn.microsoft.com dev tunnels pages (overview, security, FAQ, CLI commands, limits)
  and the licence terms PDF.

Nothing from the reference extensions was read.

### 1. Who talks SSH with whom

- **The host's registration:** the host registers an endpoint (`PUT …/endpoints/{hostId}-relay`), publishing a fresh
  host key per process, and opens a WebSocket to the service's `hostRelayUri`. It uses the sub-protocol
  `tunnel-relay-host` and the header `Authorization: tunnel <host token>` [tunnels-crate]
  `rs/src/connections/relay_tunnel_host.rs:392-437`.
- **The host-to-relay session:** on that WebSocket the host runs an SSH session *to the relay* with key exchange,
  host key and cipher all `none`, used only to multiplex channels. The source says so:
  "a somewhat non-standard "none" value for its key exchange. This prevents many off-the-shelf SSH implementations
  from working" (`relay_tunnel_host.rs:79-82`, settings at `:358-390`).
- **The client's connection:** a client opens a WebSocket to `clientRelayUri` with `tunnel-relay-client` and
  `Authorization: tunnel <connect token>` [tunnels-crate] `rs/src/connections/relay_tunnel_client.rs:73-98`. SSH
  starts right after the upgrade, with no preamble.
- **Where that session ends:** for each client, the relay opens a `client-ssh-session-stream` channel on the host's
  session. The host runs an SSH *server* on it: "The stream of data over this channel is actually an SSH client
  connection … this client actually does do a key exchange and it data is encrypted" (`relay_tunnel_host.rs:84-92`,
  `:202-227`). So the client's SSH session ends at the host; the relay pipes its bytes.
- **Host-key verification:** the client verifies the host key against the endpoint's `hostPublicKeys`
  (`relay_tunnel_client.rs:106`, `:381-395`), which can only succeed end to end.
- **V1 only:** the Rust host knows only `tunnel-relay-host`. The crate has no V2 sub-protocol and no nested
  end-to-end session. The TypeScript client offers `tunnel-relay-client-v2-dev` first, in which the client's SSH
  peer is the relay and each port channel carries a nested SSH session; the Go and Rust clients offer V1 only
  [dev-tunnels-ts] `ts/src/connections/tunnelRelayTunnelClient.ts:41-50`, `go/tunnels/client.go:23,113`. The editor's
  host speaks V1, so a client of it uses V1.

### 2. The host's SSH server, against OpenSSH 10.3p1 on this Mac

The CLI builds russh without its `rs-crypto` feature, so curve25519, ed25519, chacha20-poly1305 and AES-GCM are not
compiled in ([cli] `Cargo.lock`; [russh-fork] `russh/src/negotiation.rs:55-124`).

| Category | Host offers ([russh-fork] `negotiation.rs`) | OpenSSH 10.3p1 (`ssh -Q`) | Agreed |
|---|---|---|---|
| Key exchange | dh-group14-sha256, dh-group14-sha1, dh-group1-sha1 | all three, and newer ones | diffie-hellman-group14-sha256 |
| Host key | rsa-sha2-256, rsa-sha2-512 (RSA-2048, fresh per process) | both | rsa-sha2-512 |
| Cipher | aes256-ctr, aes192-ctr, aes128-ctr | all three | aes128-ctr |
| MAC | hmac-sha2-512/256(-etm), hmac-sha1(-etm) | all | hmac-sha2-256-etm@openssh.com |
| Compression | zlib, zlib@openssh.com, none | none, zlib@openssh.com | none |

- **Authentication:** the host accepts `none` for any user: `auth_none` returns `Accept`
  (`relay_tunnel_host.rs:858-861`). The library's own client sends `authenticate_none("tunnel")`
  (`relay_tunnel_client.rs:112-121`). OpenSSH tries `none` first, so no key or password is involved.
- **Channels:** the host accepts `direct-tcpip` and `forwarded-tcpip`, using only the target port, and only for
  ports it has registered (`relay_tunnel_host.rs:863-907`, `:694-701`). It rejects `session` channels (the russh
  default), so plain `ssh` without `-N` or `-W` fails.
- **Port announcements:** the host announces ports with `tcpip-forward` global requests that want no reply
  (`:708-722`). OpenSSH ignores such requests.
- **Other global requests** get a failure reply ([russh-fork] `server/encrypted.rs:887-894`). OpenSSH's keepalive
  treats any reply as alive [inferred].
- **No extensions required:** no custom channel type, no custom request, no token inside SSH. The only credential is
  the connect token in the WebSocket header.

### 3. What the host serves

| Port | What | Source |
|---|---|---|
| 31545 | The CLI's control interface: MessagePack RPC, no authentication beyond the tunnel; the host sends `version` (protocol 6) first. `serve` starts a VS Code server on a local socket, and its traffic travels as `servermsg` messages | [cli] `src/constants.rs:14`, `src/tunnels/control_server.rs:345-378`, `:457-611`, `:670-672`, `:886-1002`, `src/tunnels/protocol.rs:65-93` |
| 31546 | The agent host, HTTP and WebSocket | [cli] `src/constants.rs:15`, `src/tunnels/agent_host.rs:1503-1533` |
| others | Only what the RPC `forward` method adds | [cli] `src/tunnels/port_forwarder.rs:84-102` |

### 4. What a live test would have had to show

No bridge was built or run, and no account or tunnel was used (Status). A live test would have had to show, in
order:

1. **The relay passes V1 through unchanged:** the client WebSocket with `tunnel-relay-client` and a `connect` token
   is accepted, and the host's SSH server answers on it. The reading supports this, since the Go and Rust clients
   use V1 with a generic SSH client, but only the service can confirm it.
2. **OpenSSH completes the handshake:** `ssh -v` negotiates group14, rsa-sha2-512, aes-ctr and hmac-sha2-etm, and
   accepts the host key from a known_hosts line written from the endpoint's `hostPublicKeys`.
3. **`none` authentication is accepted,** with no other method tried.
4. **A `direct-tcpip` channel to 127.0.0.1:31545 opens** under `-N -L`, and a client on the local port receives the
   control RPC's `version` message.
5. **Optionally,** `serve` and one `servermsg` round trip, which shows that the application protocol works over the
   OpenSSH transport.
6. **The behaviour around the edges:** keepalive replies, rekey after 1 GiB or an hour, channel close, and what
   happens when the WebSocket drops.

Step 1 is the only step the reading cannot settle on its own. Steps 2 to 5 follow from code that the host and
OpenSSH both publish.

## What a product bridge would need

- **Tunnel record and token:** the tunnel record and a `connect` token from the management API, with the user's
  token from `vscode.authentication` (F-8102). Tokens expire after 24 hours, so the bridge refreshes them.
- **The bridge program:**
  - It is our own program on the editor's Node runtime, started by `ssh` as `ProxyCommand`.
  - It does the WebSocket upgrade with a custom `Authorization` header and the `tunnel-relay-client` sub-protocol,
    binary frames, and pings.
  - Whether Node's built-in WebSocket client can send that header is unverified [inferred]. If not, the bridge
    needs a WebSocket library (MIT, a new dependency) or a minimal RFC 6455 client of its own.
- **known_hosts per connection:** the host key changes on every host restart, so the entry is written from
  `hostPublicKeys` before each connect. Pointing `UserKnownHostsFile` at our own file keeps the user's own
  known_hosts untouched.
- **`ssh` invocation:** `-N` with `-L` to 31545, or `-W 127.0.0.1:31545` to use ssh's stdio directly. Lifetime and
  sharing follow A3's helper design (F-8103 BR-6: one helper per profile, a socket in the runtime folder, a grace
  period).
- **The control RPC client** in TypeScript: `version`, `serve`, `servermsg` in both directions, and the gzip option.
  This is the larger piece, and it is bound to the CLI's protocol version.
- **Reconnects:** OpenSSH has no session reconnect, which the dev tunnels SDK offers in V1
  (`session-reconnect@microsoft.com`). A dropped WebSocket ends the session, and the window reconnects as on any
  dropped SSH connection.

## Risks

1. **Licence terms (F-8902 Q1).** The "Microsoft Software License Terms — Microsoft Dev Tunnels Public Preview",
   saved by the reading from the dev tunnels documentation (its exact link is to be confirmed), state that they "also
   apply to any Microsoft services". §1(a) grants use "only with Microsoft Visual Studio and successor Microsoft
   products and services". §5(a) forbids working "around any technical limitations". A non-Microsoft client of the
   service may be outside those terms whatever the protocol allows. That decides the option before any engineering
   does.
2. **Protocol V1 may not last.** The current TypeScript client prefers V2. The Rust host and the Go and Rust clients
   use V1, and the Go client uses a generic SSH client over V1, which supports that the relay still passes V1 through
   unchanged. If the editor's host moves to V2, native OpenSSH can no longer reach a port: V2 needs
   `forwarded-tcpip` with extra fields and a nested session, which OpenSSH cannot open.
3. **Undocumented CLI RPC.** The control protocol (version 6 today) belongs to the editor's CLI and changes with
   editor releases. Option A of `tunnel-client-alternatives.md` has the same dependency.
4. **Weaker cryptography than OpenSSH's defaults.** The session gets DH group 14, RSA and AES-CTR, with no strict key
   exchange marker. OpenSSH may warn about non-post-quantum key exchange. A party in the path could attempt a prefix
   truncation attack of the Terrapin kind; the relay sits in that position, and only the encrypted contents are out
   of its reach [inferred].
5. **Host quirks.** The host does not handle channel EOF and close for forwarded channels
   (`relay_tunnel_host.rs:909-922`), so closed connections may linger until the session ends. Client-initiated rekey
   against russh 0.37 is untested.
6. **Service limits** (public docs): 5 GB per user per month, 10 tunnels per user, 10 ports per tunnel, 1000
   connections per port, 20 MB/s per tunnel.

## Against the options in `tunnel-client-alternatives.md`

| | A. Editor CLI as relay | B. dev tunnels library | C. Native OpenSSH over a bridge (this spike) |
|---|---|---|---|
| ADR-0004 | holds | needs an exception | holds: the bridge carries bytes |
| F-8902 sign-in | CLI stores tokens (ADR-0005 suspension) | token by callback | token by callback; nothing stored |
| Undocumented interface | CLI relay subcommands | none (published library) | the CLI's control RPC, in our code |
| Protocol risk | the CLI's | the library tracks the service | V1 must stay available |
| Licence terms | as for any client | as for any client | as for any client: F-8902 Q1 |

## Open

- The user's decision on Tunnels as a whole (F-8902 Q1). This spike adds option C to it and changes no other
  option's facts.
- The exact source link of the licence terms PDF, for the register.
