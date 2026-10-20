# Task card containers-74: `appPort` rows, "Statically Forwarded", for a local engine (F-1101 BR-8, BR-15, BR-18, BR-22)

Containers increment 2, ports. Size: M. Builder: `task:claude`. Design: athena's ports rulings on #1204, ruling 5.
Spec: remote-oss/remote-containers#42 (F-1101) 6.2, BR-7, BR-8, BR-14, BR-15, BR-18, BR-20 and BR-22. **Depends on
containers-72 (#1232)** for the launch and the rows' helpers.

## 1. What's already true

- **The publish:** CLI 0.89.0's `up` already publishes a numeric `appPort` N on `127.0.0.1:N`, and passes a string as
  written (all interfaces). That was measured (tooling-56 §1), so per ADR-0009's order no override pre-pass is needed.
  AC-5 needs only its row.
- **The contract:** lib-authority's `Connected` already has `environmentTunnels: readonly Tunnel[]`, and
  `vscode-resolver.ts` hands it to core. remote-containers passes `environmentTunnels: []`
  (`connect/connector.ts`, the `Connected` it returns). **No windows-contracts change is needed.** Ruling 5's
  additive change exists already.

## 2. The change (`src/ports/static-forwards.ts`, new, pure, and the connector)

```ts
/** The rows core shows as "Statically Forwarded" for the configuration's appPort, when the engine is local. */
export function staticForwards(appPort: unknown, engineIsLocal: boolean): vscode.TunnelDescription[];
```

- `engineIsLocal` is false for a window on a remote authority (a Dev Container from a Remote-SSH window, BR-22,
  AC-29) and for a `DOCKER_HOST` or context that isn't the local socket (AC-23). Both of those are deferred
  (`later (remote engines)`), so for now it's `true` exactly when the payload's engine is the local one. Read that
  from the payload (`localDocker`) and `DOCKER_HOST`, and write down in the PR which test you used.
- `appPort` comes from the configuration file, not the merged list (it isn't in the metadata label). A single number
  or string is treated as a one-entry list.
  - A number N gives `{remoteAddress: {host: '0.0.0.0', port: N}, localAddress: '127.0.0.1:N'}`.
  - A string `"H:C"` gives `{remoteAddress: {host: '0.0.0.0', port: C}, localAddress: '[::1]:H'}` (BR-20 and AC-40's
    tooltip, `Remote port 0.0.0.0:<C> forwarded to local address [::1]:<H>. `).
  - Anything else is left out. A dash-prefixed host part fails the container's setup through Docker, as today
    (7.E2), so nothing is needed here.
- A Compose configuration gives `[]` (BR-14).
- The connector returns these in `environmentTunnels` instead of `[]`.
- **Measure** that core shows them with Origin `Statically Forwarded`, with the reduced action set of BR-18 and the
  addresses above. If the Forwarded Address column reads otherwise, adjust `localAddress` until AC-40's tooltip
  matches, and say so in the PR.

## 3. Rows

**Unit:** every branch of §2.

**Acceptance** (`tests/acceptance/containers-ports/app-port.test.ts`):

| AC | Case |
|---|---|
| 5 | `appPort: [<A>, "<H>:3000"]`: `docker inspect` shows `127.0.0.1:<A>` and `:<H>`, both reachable from the host, published before the window is connected |
| 6 | a matching attribute added and Rebuild: the row has no label, and its Origin is `Statically Forwarded` |
| 20 | the same port in `forwardPorts` and `appPort`: two rows, `Dev Containers` and `Statically Forwarded` |
| 24 | `portRowActions` on the static row: inline `Copy Local Address`, `Open in Browser`, `Preview in Editor` only; the menu adds only `Forward a Port` |
| 40 | a listener on `<C>`: Running Process filled, the icon `codicon-ports-forwarded-with-process-icon`, the tooltip as in §2, no `Auto Forwarded` row, and the aria label `Forwarded Ports: <C>, <A>` |

**Coverage:** AC-5, 6, 20, 24 and 40 become `acceptance` when their rows pass.

## 4. Done when

- The unit tests pass, with the new file at 100 %.
- The `containers-ports` and `containers` launches pass. Paste the summary line.
- All gates pass. PR title: `remote-containers: appPort rows, Statically Forwarded, for a local engine (card
  containers-74, #1234)`. Request athena only.
