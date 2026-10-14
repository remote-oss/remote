# Task card tooling-47: a routed alias to the harness host, cut as unreachable or silent

Issue: #873. Gating: milestone 0.2. It unblocks the rows of F-2303 AC-17, F-2501 AC-18 and F-2601 AC-4. R-99: tools
and tests only, nothing under `packages/*/src`. Size: M. Builder: `task:claude`.

## 1. Why

`tools/acceptance-network.ts`'s cut drops port 22 inside the host container. Every alias reaches the host through
Docker's published port on `127.0.0.1`, and Docker's proxy accepts the TCP connect for the container. So a cut host
never fails ssh's connect: ssh only times out in the banner exchange. The two reasons the specs ask for never occur:
- `ssh: connect to host … port …: No route to host`: F-2303 7.E2 and AC-17, and F-2601 BR-3's No-route row;
- `ssh: connect to host … port …: Connection timed out`: F-2501 AC-18, and F-2601 AC-4 and BR-3's timeout row.

**proteus measured the way out**, in a room and on CI runners ci-2, ci-6 and ci-7 (Docker 29, OpenSSH 10.2):
- A job reaches a container's address on a user-defined network directly.
- Inside the container (`NET_ADMIN`), `iptables -A INPUT -p tcp --dport 22 -j REJECT --reject-with
  icmp-host-unreachable` gives exactly `ssh: connect to host 172.18.0.2 port 22: No route to host`.
- `iptables -A INPUT -p tcp --dport 22 --syn -j DROP` gives exactly `ssh: connect to host 172.18.0.2 port 22:
  Connection timed out`.

## 2. The change

### 2.1 `tools/acceptance-run.ts`: the run network

1. `export function runNetworkOf(runId: string): string`, which gives `remote-oss-acceptance-${runId}`.
2. `export function connectRunNetwork(command: CommandRunner, runId: string, container: string, now: () => number =
   Date.now): string`:
   1. **The sweep of left-over networks** (proteus, #874: killed and cancelled runs leave theirs, and Docker's default
      address pool runs out after about 30). For each id of `docker network ls --quiet --filter label=${RUN_LABEL}`
      (the label's key, any run), read `docker network inspect --format '{{.Created.Unix}} {{len .Containers}}' <id>`.
      When the network is older than `STALE_RUN_SECONDS` (`now() / 1000 - created`) and has no container, run
      `command('docker', ['network', 'rm', id])`, ignoring its status, since another job may remove it first. A
      network that's younger, or has a container, is another job's: leave it. An `inspect` that fails or doesn't
      give two numbers skips that network.
      - Rename `STALE_EDITOR_SECONDS` (`acceptance-run.ts:22`) to `STALE_RUN_SECONDS`, and make its JSDoc "How old
        an editor or a network of a CI run is before the opening clean takes it for one a killed job left behind:
        two hours". The editor sweep in `cleanRun` uses the new name.
   2. `docker network inspect <name>`: when its status isn't 0, run `checked(command, 'docker', ['network', 'create',
      '--label', `${RUN_LABEL}=${runId}`, name])`. A run with two host containers (the variants) shares one network.
   3. `checked(command, 'docker', ['network', 'connect', name, container])`.
   4. `checked(command, 'docker', ['inspect', '--format', `{{(index .NetworkSettings.Networks "${name}").IPAddress}}`,
      container]).trim()` is the address. An empty address throws `the host ${container} has no address on ${name}`.
   - JSDoc: "Connects the host container to the run's own network as well as Docker's default one, and returns its
     address there: the address the `routed` alias reaches without Docker's published port."
3. **`cleanRun`:** after the containers are removed, and before the image:

   ```ts
   for (const networkId of containersOf(
     checked(command, 'docker', ['network', 'ls', '--quiet', '--filter', filter]),
   )) {
     checked(command, 'docker', ['network', 'rm', networkId]);
   }
   ```

   `containersOf` splits any `--quiet` answer. Rename it to `idsOf`, and update its JSDoc to "The ids of a `docker …
   --quiet` answer". A network that's left after the clean-up fails the run, as a container does: extend the
   `remaining` check to name the networks too.

### 2.2 `tools/acceptance-network.ts`: the route cuts

Keep `cutNetwork` and `restoreNetwork` as they are; the drop cut's own rows depend on them. Add:

```ts
/** How the route to the host's own address fails: refused as unreachable, or silent, so the connect times out. */
export type RouteCut = 'unreachable' | 'silent';

/** The rule of a route cut, scoped to the host's address on the run network, so the published port keeps working. */
function routeRule(address: string, cut: RouteCut): {chain: string; match: readonly string[]} {
  const port = ['-d', address, '-p', 'tcp', '--dport', '22'];
  return cut === 'unreachable'
    ? {chain: 'INPUT', match: [...port, '-j', 'REJECT', '--reject-with', 'icmp-host-unreachable']}
    : {chain: 'INPUT', match: [...port, '--syn', '-j', 'DROP']};
}
```

- `export function cutRoute(command, container, address, cut: RouteCut): void`:
  - inserts `routeRule(address, cut)` with `-I` unless `holdsRule` says it's there;
  - first deletes the other cut's rule if it's held, so a switch leaves exactly one rule.
- `export function restoreRoute(command, container, address): void` deletes each of the two rules that's held.
- Both throw as `cutNetwork` does, through `checked`. Both are idempotent.
- Reuse `iptablesCommand` and `holdsRule`; no second copy.
- Update the file's `@fileoverview` to name both kinds of cut.

### 2.3 The `routed` alias

1. **`harnessSshConfig(port, runFolder, agentSocket, routedAddress)`** (`tools/acceptance.ts:244`): after `Host
   stranger`, add:

   ```
   Host routed
     HostName <routedAddress>
     Port 22
     User harness
     IdentityFile <runFolder>/id_ed25519
     IdentitiesOnly yes
     IdentityAgent none
     StrictHostKeyChecking accept-new
     BatchMode yes
     UserKnownHostsFile <runFolder>/known_hosts_routed
   ```

   - It has **no `ConnectTimeout`**, so F-2501 AC-18 and F-2601 AC-4 get the default connect timeout (about 15 s).
   - Add `routed` to the function's JSDoc list: "`routed` (the harness account at the host's own address on the run
     network, which a route cut makes unreachable or silent)".
2. **`tools/acceptance.ts`, the windows harness start (line 579):** after `startHostContainer`, call `const routedAddress
   = connectRunNetwork(command, runId, host.container);`. Pass it to `harnessSshConfig`, and add `HARNESS_ROUTED_ADDRESS:
   routedAddress` to `HarnessVariables` (`:146`) and to the variables object (`:622`).
3. **`tests/acceptance/server/host-fixture.ts`, `startHost`:** the same call after `startHostContainer`. Pass the
   address to `harnessSshConfig`. `RunningHost` gains `/** The host's address on the run network, which the `routed`
   alias names. */ routedAddress: string;`.
4. **Moved (athena on #895):** the windows harness's `cutRoute(cut)` and `restoreRoute()` wrappers go with their
   first caller, coverage-42's AC-17 row (#730, its §1.1), or the F-2501 AC-18 / F-2601 AC-4 card if that lands first.
   This card adds no export to `tests/acceptance/windows/harness.ts` (ADR-0003: no export without a caller).
5. **`tests/acceptance/README.md`:** a new section, "Cutting the route to the host", after "Cutting the host's network".
   It describes the run network, the `routed` alias and the two cuts, with proteus's measured lines. It also says when
   to use which: the network cut for a session that stalls, a route cut for a connect that fails.

## 3. Rows

**Unit rows:**

| File | Name | Expected |
|---|---|---|
| `tools/acceptance-network.test.ts` | `tooling-47: an unreachable cut inserts the REJECT rule for the address` | over a recording command where `-C` fails: one `docker exec <c> iptables -I INPUT -d 10.1.2.3 -p tcp --dport 22 -j REJECT --reject-with icmp-host-unreachable` |
| same | `tooling-47: a silent cut inserts the SYN DROP rule for the address` | one `-I INPUT -d 10.1.2.3 -p tcp --dport 22 --syn -j DROP` |
| same | `tooling-47: a cut held already inserts nothing` | `-C` succeeds, so there's no `-I` |
| same | `tooling-47: switching from unreachable to silent deletes the REJECT rule first` | `-D …REJECT…` before `-I …DROP…` |
| same | `tooling-47: restoreRoute deletes the held rules and nothing else` | only the held rule is deleted; with neither held, no `-D` |
| same | `tooling-47: a refused rule throws with iptables' error` | as the existing `cutNetwork` row |
| `tools/acceptance-run.test.ts` | `tooling-47: connectRunNetwork creates the labelled network once, connects the host and gives its address` | the calls in order; a second container with `inspect` status 0 gets no `create`; returns the trimmed address |
| same | `tooling-47: the opening sweep removes a labelled network older than two hours with no container` | `inspect` gives `<now − 7201> 0`, so there's one `network rm <id>`, before the run's own `network create` |
| same | `tooling-47: the sweep leaves a younger network, one with a container, and one it can't read` | `<now − 7199> 0`, `<now − 9000> 1` and an `inspect` with status 1 give no `network rm` |
| same | `tooling-47: a host with no address on the run network throws` | `inspect` gives `''`, so it throws, naming the container and the network |
| same | `tooling-47: cleanRun removes the run's networks after its containers` | `network ls --filter label=…` then `network rm <id>`, after `rm --force`, before `image rm` |
| same | `tooling-47: a network left after the clean-up fails the run` | the error names it |
| `tools/acceptance.test.ts` | `tooling-47: the run's ssh_config has the routed alias at the run-network address, with no connect timeout` | the `Host routed` block exactly as in §2.3 |

**Acceptance rows** in `tests/acceptance/server/network-cut.test.ts`, a new `describe('the route to the host's own
address')` with an `afterEach` that calls `restoreRoute`. Run ssh with `-F <runFolder>/ssh_config routed true`.

| Name | Given | Expected |
|---|---|---|
| `tooling-47: the routed alias connects` | nothing cut | status 0 |
| `tooling-47: an unreachable route gives ssh's No route to host` | `cutRoute(…, 'unreachable')` | status 255, and a stderr line exactly `ssh: connect to host <routedAddress> port 22: No route to host` |
| `tooling-47: a silent route times the connect out` | `cutRoute(…, 'silent')`, ssh with `-o ConnectTimeout=5` | status 255, and a stderr line exactly `ssh: connect to host <routedAddress> port 22: Connection timed out`, between 4 and 9 s |
| `tooling-47: a route cut leaves the published port working` | either cut | `ssh -F … harness true` has status 0 |
| `tooling-47: after restoreRoute the routed alias connects again` | a cut, then a restore | status 0 |

## 4. What this unblocks (rows for later, not in this PR)

- F-2303 AC-17 (coverage-42, #730): open the new window on `routed` with `cutRoute('unreachable')`. Its dialog reason
  is `No route to host` (STR:S097).
- F-2501 AC-18 and F-2601 AC-4: open on `routed` with `cutRoute('silent')`. The reason is `The connection timed out`
  (STR:S137), after about the default 15 s.
- The banner-exchange case stays a spec question (remote-ssh#68). These rows no longer depend on it.

## 5. Gates and review

Run all gates, the server suite (`pnpm test:acceptance:server`, all of it) and the VSCodium run, which proves that
the windows harness starts with the new network. PR title: `tools: a routed alias to the harness host, cut as
unreachable or silent (card tooling-47, #873)`. Request athena only; hermes assigns the peer.

## 6. Open rows (stop and report on #873)

1. `docker network connect` to a running container with a published port changes the published port, or breaks it.
2. A runner refuses `docker network create`, for example from the address pool: report the error, don't change the
   pool.
3. `docker network inspect --format '{{.Created.Unix}} …'` isn't accepted by a runner's Docker: report the error and
   the Docker version.
4. ssh's line differs from §3's text (for example `Connection refused` for the REJECT): report it with the iptables
   rule and the OpenSSH version.
