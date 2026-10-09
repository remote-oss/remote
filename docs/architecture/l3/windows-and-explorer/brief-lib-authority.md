# Coding brief: lib-authority (Claude parts) — slice 1, build-order step 10

> Issued by `remote-architect` 2026-10-08; the PM allocates the seat. Design: `components.md` (lib-authority) and
> `contracts.md` §3 (3.1 codecs, 3.2 resolver host, 3.3 window opener, 3.4 proposed-API gate). The pure parts are
> cards already: authority-01 (codecs, per F-2301 BR-4), authority-02 (opener arguments, failure mapping),
> authority-03 (gate decisions), authority-04 (connection state). This brief is the editor-facing remainder.
> Binding: ADR-0002, 0003, 0007 (floor 1.139; the `resolvers`, `tunnels`, `contribViewsRemote`, `extensionsAny`,
> `contribRemoteHelp`, `terminalDataWriteEvent` declaration files pinned per package), 0008. Depends on
> `lib-identifiers`, `lib-standdown`, `lib-log` on main and the four cards merged.

## What is built (packages/lib-authority, Claude parts)

| Piece | Content |
|---|---|
| Resolver host | `registerResolver(family, connector, codec, presenter, {cancellable})` over `vscode.workspace.registerRemoteAuthorityResolver` (proposed `resolvers`): runs `lib-standdown` first (`GuardStandingDown` → registers nothing); checks the proposal grant (`ProposalMissing` → tells the gate, registers nothing); on each core resolve: decode through the codec (malformed → `NotAvailable`, not handled), build the connect input `{target, rawHostString, attempt, isReconnection, windowId, windowWorkspace}`, call `connector.connect`, render phases as core progress with the extension's titles ("(details)" → `connector.revealDetails`; Cancel only when `cancellable`), hand `Connected` to core (address or managed socket factory, connection token, extension-host environment, environment tunnels, tunnel factory, `tunnelFeatures`; `isTrusted` only when `Connected.trusted` and the family allows it), map `Failed` through card authority-02's `mapFailure` and await the presenter's outcome (`handled` → `NotAvailable(handled)`, `reload` → reload the window, `closeRemote` → leave the remote); subscribe to `transportLost`/`transportClosed` and feed card authority-04's tracker; `currentConnection()`; `onFirstResolveSettled`; `connector.cancel` on window teardown only |
| Window opener | `openRemote`, `openLocal`, `reload`, `closeRemote` over `vscode.commands.executeCommand` with card authority-02's command values; `OpenRejected {reason}` as a value; shows nothing |
| Proposed-API gate | the probes of §3.4 (each side-effect-free: `resolvers` through a gated member, `tunnels` through `workspace.tunnels`, `contribViewsRemote` through the generated `<viewId>.focus` in `getCommands(true)`, `terminalDataWriteEvent` through `window.onDidWriteTerminalData`; `contribRemoteHelp` unprobeable); card authority-03's `decide`; the one family-wide notification claimed through the `WindowClaim` port of §3.4 (the `remote-oss.gate.claim` command registration; ruled 2026-10-08, replacing the context key), with the primary action opening `workbench.action.configureRuntimeArguments` and offering the `enable-proposed-api` entries, then the restart offer; F-1403 §6's dismissal flag in global state (not synced); no success cache; the harness-only adapter swap for the notification (ADR-0008 switch, one reader per package) |
| Label formatter registration | `registerResourceLabelFormatter` per family with `workspaceSuffix` passed by the caller (corrected 2026-10-08, #171: `Codec.label` is `user@host:port` for pickers; F-2502 BR-3's host label without the user and with a port only after an IP literal is remote-ssh's own pure function, card remote-ssh-03; the container and WSL suffixes are theirs likewise) |
| Adapters | one adapter module over `vscode` for each of the four pieces; everything else pure and tested with fakes; the recording adapters under `src/testing/` for the packages' tests |

## Behaviour to get right (each a named test; the harness proves the editor-facing ones)

- Order at activation: stand-down → gate probe → registration; nothing registers after `standing`; a missing
  `resolvers` grant registers nothing and the gate decides (notify, silent, or proceed-silenced).
- The failure mapping order of §3.2 end to end: retryable → temporarily not available; reconnection → plain not
  available without presenter; silent → plain; userAlreadyNotified → handled; otherwise the presenter's outcome
  decides, and the host answers core only after the outcome.
- Cancellation: no Cancel in progress for `ssh-remote`; `connector.cancel` called on deactivation and on
  "Close Remote Connection"; never otherwise.
- `isTrusted`: passed only for the container families and only when `Connected.trusted` is true.
- One notification per window for the whole family (two extensions in one window: the second stays silent); the
  dismissal flag silences activation-time failures only.
- Acceptance (harness, slice 1): F-2501 (the resolver resolves `ssh-remote+harness` to the container through a fake
  connector first, then the real one when `remote-ssh` exists), F-2502 (open folder in the current and a new window),
  F-2601 (the dialog on a failed resolve with the presenter's data), F-1403's one notification when the proposal is
  not granted (a harness run without `--enable-proposed-api`).

## Done

Gates green; the four cards' modules consumed, not duplicated; ADR-0008 in README and comments; PR body answers
R1–R6; the proposed-API declaration files committed per ADR-0007.
