# ADR-0014: The tunnel service and its host speak the dev tunnels protocol, read from its MIT code

- Status: accepted (the user, 2026-11-22, D-107: "I approve")
- Date: 2026-11-22
- Deciders: the user (D-101, D-107), for the wire-compatible service and the source's admissibility; design by athena with proteus
- Scope: the tunnel relay service, the remote-server host side, the Remote - Tunnels client, and `lib-tunnels`
- Requirements: D-101, D-107; F-8101 to F-8104, F-8201 to F-8203, F-8902; ADR-0004; ADR-0005; R-76; R-113

## Context

D-107 builds Remote - Tunnels and the remote-server extension against a relay of our own. That relay speaks the dev
tunnels management API and relay protocol, so that the editor's tunnel host and the MIT dev tunnels SDKs work against
it with only the service address changed. The relay, the host side and the client all need that protocol on the
clean side, exactly as clients speak it.

The editor's `cli/` crate, already an allowed source under R-76 (`[cli]`), pins the dev tunnels Rust crate:
`microsoft/dev-tunnels`, `rs/`, at `64048c1`. The same repository holds the TypeScript SDK and the shared contracts,
all under the MIT licence. The public dev tunnels documentation describes the service's concepts. None of it is a
reference extension's file, and none of it is Microsoft's hosted service.

## Decision

1. **`microsoft/dev-tunnels` is an allowed source on the clean side**, cited `[dev-tunnels] <path>@<commit>`:
   - its Rust crate, its TypeScript SDK and its contracts, at the commit `[cli]` pins (`64048c1`) and at each later
     commit a pinned `[cli]` names;
   - the public dev tunnels documentation.

   It is read for the management API (tunnels, ports, endpoints, access tokens), the relay protocol (the
   `tunnel-relay-client` and `tunnel-relay-host` WebSocket subprotocols and the SSH channels they carry) and their
   data shapes.
2. **It may be a dependency where a design calls for it**, with its MIT notice carried. ADR-0004 still holds: no
   SSH connection that an extension opens goes through the SDK's JavaScript SSH implementation. The relay service
   and the host side choose, in their own designs, whether they use the SDK.
3. **Not admitted:**
   - the reference extensions' files, which the wall still keeps out;
   - the hosted service's implementation, which nobody outside can see;
   - any recording of Microsoft's hosted service, until the user decides whether the lab may observe it
     (remote-oss/remote-server#21, question 2).
4. **Where the code and the documentation are silent**, our service sets its own rule. The specs record it as ours
   through a spec question (R-113).
5. **This supersedes ADR-0005's decision 2** (Remote - Tunnels not built) under D-107.

## Options considered

| Option | For | Against |
|---|---|---|
| A (chosen): the MIT dev tunnels code and documentation as the protocol source | The protocol exactly as the clients and the host speak it, with nothing guessed | It admits a new source, so the wall's list grows by one MIT repository |
| B: specify the protocol by observing Microsoft's service | No new source | It waits on the user's question 2, and observation can't show the service's own rules |
| C: a protocol of our own (D-101's reading (b)) | No protocol source is needed | The user chose wire-compatible (D-107), and the editor's tunnel host and the SDKs would not work against it |

## Consequences

- **Citations:** the designs of the relay, the host side and `lib-tunnels` cite `[dev-tunnels]` for every protocol
  and data shape.
- **What the dirty side specifies:** its revision for our service covers only what that code and the documentation
  leave open, scoped by question 2.
- **The `code tunnel` measurement** (can its service address be set?) reads `[dev-tunnels]` `rs/` at the pinned
  commit.
- **Licence:** a dependency, or any copied part, carries the MIT notice in the package's third-party notices.

## Check

- `AGENTS.md`'s list of what may be read names `[dev-tunnels]`.
- Every protocol citation in a design or a card is `[dev-tunnels] <path>@<commit>` or the public documentation, and
  none is a reference extension's file.
- No recording of Microsoft's hosted service exists before question 2 is answered yes.
- No extension's SSH connection goes through the SDK's JavaScript SSH implementation (ADR-0004).
