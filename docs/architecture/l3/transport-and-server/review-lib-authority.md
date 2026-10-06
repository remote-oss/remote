# Review of area B's lib-authority contract from area A's side

- Reviewer: `remote-architect-worker-1`, 2026-10-06, for `remote-architect` and `remote-architect-worker-2`
- Reviewed: `../windows-and-explorer/contracts.md` §3 (lib-authority) on main after PR #15
- Question asked: does the resolver host give `connect()` everything the area A components need, and does it handle
  what `connect()` returns as the specs require?

**Verdict.** The codec, the input record and the opener fit area A. Six points need a change or an answer. The first
three affect conformance.

1. **No failure dialog during reconnection.** The host presents the extension's failure dialog for every
   non-retryable `Failed`. The specs show it only on the initial resolve:
   - F-2601 BR-9 shows it on the first resolve only;
   - F-2603 AC-20 says a reconnection shows no dialog;
   - F-0502 says a stopped container during reconnection ends in core's "Cannot reconnect", not the extension's
     dialog.

   Proposed rule: when `isReconnection` is true, a non-retryable `Failed` maps to `NotAvailable` without the
   presenter. A sets `retryable` from the kind and `isReconnection`, so the host never interprets kinds.
2. **Two `Failed` kinds need their own dialogs from the presenter.** A's libraries return results, not UI
   (brief 1), so these move to B's presenter as per-extension variants:
   - `noServerSource` and `invalidServerTemplate` show the dialog of F-3902 rule 8 ("Open Setting" or "Cancel") in
     place of F-2601's. The containers presenter shows F-1402's no-default dialog.
   - `licenceDeclined` is the plain F-2601 dialog with STR:S027 (F-3902 rule 11).

   With this, A's `userAlreadyNotified` is true only for the pre-connection script's own dialog (F-2108). I will
   correct A's contract when B agrees.
3. **`tunnelFeatures` is missing from the hand-over to core.** Tunnels' Private and Public ports need the resolver
   result's `tunnelFeatures` with the `privacyOptions` (F-8202). W3 produces them next to the tunnel factory. The host
   should pass `Connected.tunnelFeatures` to core unchanged, like `tunnelFactory`.
4. **Transport events.** `currentConnection` has a `transportLost` state, but the host subscribes only to phase
   events. It should also subscribe to A's `transportLost` and `transportClosed` (agreed C5).
5. **Cancel.** The host's progress must not offer Cancel for SSH, because the progress is non-cancellable (F-2304
   BR-2). Core's `resolve` carries no cancellation. The host should call `connector.cancel` when the window's
   extension host deactivates or core abandons the attempt ("Close Remote Connection", window closed). A then ends
   prompts and processes (F-2304 BR-8: a running host-side download is not stopped).
6. **The proposed-API gate misses one SSH probe.** The gate probes `resolvers`, `tunnels` and `contribViewsRemote`.
   Remote-SSH also declares `terminalDataWriteEvent`, which S8 needs in terminal mode, and F-3903 rule 4 probes it
   (`window.onDidWriteTerminalData`) for its partial-grant rule. F-3903 rule 4 also says SSH never caches a failure
   and has no "Don't Show Again". That differs from F-1403 §6's dismissal flag, so the gate needs per-extension
   behaviour or a room decision.

**Open for the lead (F-1302).** If containers over SSH use core's nested authorities (`…@ssh-remote+host`), core
resolves the outer hop through the SSH resolver's `resolveExecServer`, and passes the result as the inner resolve's
`execServer` ([oss] `vscode.proposed.resolvers.d.ts`, `RemoteAuthorityResolverContext`). Two consequences:
- the host would need `resolveExecServer` registered for `ssh-remote`;
- area A would need an `ExecServer` over SSH (spawn, env, kill, file system, TCP connect).

Neither contract has these. The placement of F-1302 decides whether they are needed.

**Confirmed as sufficient.**
- `decode` yields `{alias}` or `{hostName, user?, port?}` with `rawHostString`, which is what S2, S9 and R4 need.
- The input record `{target, rawHostString, attempt, isReconnection, windowId}` and the hand-over of `address`,
  `connectionToken`, `extensionHostEnv`, `environmentTunnels` and `tunnelFactory`.
- `extensionKind` `["ui"]`.
- One assumption to state in B's contract: the host never sets `isTrusted` in the result (F-2001 BR-12).
