# Task card tooling-56: a Ports-view readout and a launch for the declared-ports rows (F-1101 harness)

Containers increment 2, ports. Size: M. Builder: `task:claude`. Design: athena's ports rulings on #1204 (2026-10-20),
"Harness first". Spec: remote-oss/remote-containers#42 (F-1101). Its rows read the Ports view's rows (label and key,
Forwarded Address, Running Process, Origin, icon, tooltip), the rows' actions, and the forwarded-ports status item.
Nothing in the harness reads the Ports view yet.

## 1. Measured already (daedalus, 2026-10-20, CLI 0.89.0, Docker 29.9.1)

The C17 cards rely on these two facts. Record them in `tests/acceptance/README.md`'s containers section:
- `devcontainer up` with `"appPort": [18741, "18742:8742"]` publishes `18741/tcp` on `127.0.0.1:18741` and `8742/tcp`
  on `:18742`, all interfaces. **The CLI already applies BR-8**, so no `--override-config` pre-pass is needed.
- After `forwardPorts` is edited from `[3000]` to `[4000]` on a running container, `read-configuration
  --container-id <id> --include-merged-configuration` gives `mergedConfiguration.forwardPorts` `[3000]`, which is
  the container's `devcontainer.metadata` label. The configuration says `[4000]`. **The merged configuration is
  BR-1's build-time list.**

## 2. Renderer helpers (`tests/acceptance/windows/renderer.ts`)

The Ports view is core's `~remote.forwardedPorts` panel view, a table. Open it with
`workbench.view.remote.forwardedPorts` or `remote.tunnel.focus`; find which works on main's VSCodium with
`commandsOf`.

```ts
export interface PortsRow {
  /** The Port column as shown: `<label> (<port or key>)`, or the port or key alone. */
  port: string;
  forwardedAddress: string;
  runningProcess: string;
  origin: string;
  /** The row icon's codicon class, e.g. `codicon-ports-forwarded-with-process-icon`. */
  icon: string;
  /** The row's hover, non-breaking spaces read as spaces, as `statusItem` reads a hover. */
  tooltip: string;
}
export async function portsRows(name: string): Promise<PortsRow[]>;
/** The titles of row `port`'s inline actions on hover, and of its context menu's items, in order. */
export async function portRowActions(name: string, port: string): Promise<{inline: string[]; menu: string[]}>;
```

- `portsRows` reads every row of the table in order, scrolling as `viewRows` does when it overflows. Read only the
  DOM, the way the other helpers do.
- `portRowActions` hovers the row, reads its action bar's titles, then opens its context menu (as `rowContextMenu`
  does) and reads the items. It closes the menu with Escape.
- The status item already reads with `statusItem(name, 'status.forwardedPorts')` (text, aria label, hover); reuse it.
- Add unit rows where `renderer.ts`'s other parts have them. Otherwise one acceptance row (§4) proves each helper.

## 3. A listener in the container, and the launch

- A suite helper `listenIn(containerId, port): Promise<() => Promise<void>>`. It starts `docker exec -d <id> nc -lk -p
  <port> -e cat`, with busybox's `nc` in the pinned alpine image (F-1101 AC-39 uses that command line), waits until
  `docker exec <id> netstat -ltn` shows the port, and returns a function that kills it.
- The launch: `{...CONTAINERS_LAUNCH, label: 'containers-ports', suite: 'containers-ports', registry: true, standIns:
  ['ms-vscode-remote.remote-containers'], disabledExtensions: ['ms-vscode-remote.remote-containers']}` (as
  `containers`), with its unit row.

## 4. A smoke row

`tests/acceptance/containers-ports/readout.test.ts`, named `#1228: the Ports view readout reads a hand-forwarded
port`:
1. Open a folder with an image configuration and no ports.
2. Start a listener on 41999.
3. Run core's `remote.tunnel.forwardCommandPalette` (or whatever "Forward a Port" is on main) with the input 41999,
   through the scripted or renderer input the suite uses.
4. Assert:
   - `portsRows` has one row whose `port` is `41999`, whose origin is `User Forwarded`, and whose `runningProcess`
     isn't empty once the process is detected (wait 10 s);
   - `portRowActions` holds `Stop Forwarding Port`;
   - `statusItem(…, 'status.forwardedPorts').ariaLabel` is `Forwarded Ports: 41999`.

This row checks the harness and cites no criterion.

## 5. Done when

- `pnpm package && node tools/acceptance.ts --editor vscodium --launches containers-ports` passes. Paste the summary
  line.
- All gates pass. PR title: `tests: a Ports-view readout and a launch for the declared-ports rows (card tooling-56,
  #1228)`. Request athena only, and tell proteus the new launch's name for CI.
