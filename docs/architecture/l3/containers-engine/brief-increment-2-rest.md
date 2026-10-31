# Brief: Remote - Containers, increment 2, the rest (Podman, the extension cache, Docker hosts and contexts)

Status: ruled by athena (architect), 2026-10-31, for daedalus's question on remote#1204. This is the last part of
`brief-release-1.md` §2's "Increment 2": "The rest: the extension-cache half of F-0419; Features (F-0414); Podman;
`DOCKER_HOST` and contexts from settings (F-0205)". Features are carded already (containers-93 to 95), so three items
remain. Sources: the published spec issues (F-0201 #18, F-0419 #92, F-0205 #84), `components.md`, `contracts.md`, the
transport contracts, ADR-0009 and the register.

## 1. The order, and why

| # | Item | Spec | Can be carded |
|---|---|---|---|
| 1 | **Podman as the engine** | F-0201 6.2, BR-1, AC-4 (#18, `spec:reviewed`) | **now** |
| 2 | The extension-cache half of F-0419 | #92, `spec:draft` | after its review |
| 3 | `DOCKER_HOST` and contexts from settings | F-0205 #84, `spec:draft` | after its review |

- **Podman first:** its spec is reviewed, and its design is mostly a measurement, because release 1 already spawns
  `dev.containers.dockerPath` for every engine call (F-0201 BR-1).
- **The other two wait for their reviews,** by the rule that a card citing a criterion waits until the ids it cites are
  final. hermes asks the dirty side to review #92 and #84 (pointers through metis, D-79). Until then their lines stay as
  they are: F-0419 AC-4, 5, 39, 41 and 42 `deferred` under `increment 2 (the extension-cache half of F-0419)`, and F-0205
  with no lines, seeded at its review.
- **Sections 3 and 4 below are the design they'll be carded to.** Only the criteria ids are missing.

## 2. Podman (card it now)

**The rule (F-0201 BR-1):** every engine call of a run goes to the configured executable, verbatim. The product
already does that: C2 is the one place that spawns the engine CLI, and C3 passes `--docker-path` to the dev container
CLI. So Podman is **one measured launch, and a product change only where a measurement finds one.**

1. **The launch:** `containers-podman`, the `containers` launch with `dev.containers.dockerPath: "podman"` and Podman 5 on
   the runner.
   - **The rows that use the engine** read it through one harness helper (`engineCli()`, the launch's executable), not a
     hard-coded `docker`.
   - **The run's own infrastructure** (the SSH host, the registry, the download host) stays on Docker. Only the
     extension's engine is Podman.
2. **The rows:**
   - **F-0201 AC-4 whole:** the container and the `vscode` volume only in Podman's storage (`podman ps`,
     `podman volume ls`, and absent from `docker ps -a`), the three labels in `podman inspect`, and the indicator.
   - **Smoke rows over release 1's path, citing no criterion:** open, reuse, rebuild and a Dockerfile build.
3. **What to measure first.** These are the places where a "Docker-compliant" CLI can differ, each with its own result
   on the card:
   - C2's pre-flight version and API check against `podman version`'s output;
   - a Dockerfile build: the dev container CLI uses `buildx` when it finds it and otherwise `build`, and Podman has no
     `buildx`;
   - the `-uid` image (F-0416);
   - `docker exec -i` (C11's channel);
   - the label filters C7's matching uses;
   - the `events` stream C15 and the shutdown helper read, whose JSON format differs between Docker and Podman.

   **A difference is fixed in our code only when it's ours** (C2's parse, C15's events reader), through the mechanism
   ADR-0009 allows for the CLI (a flag, the spawn environment, post-processing). Never fork or patch the CLI.
4. **Platforms:** Linux only, as the spec observed (6.2 step 6, `[linux-arm64]`). Windows and macOS stay `deferred`
   with the OS legs.
5. **Podman with Compose** stays with Compose ("Later", F-0201 6.2 step 7).

## 3. The extension cache (after #92's review)

**What it is:** the server's extensions are kept in a shared extensions cache on the `vscode` volume, with
per-container symlinks, so a second container with the same extension list doesn't download them again. The folder is
`cacheFolders`' `extensionsCache` (for VSCodium `/vscode/extensionsCache-codium`), our product-specific name, not
F-0419's observed `vscode-server/extensionsCache` (contracts.md, corrected 2026-10-14 on #925; transport contracts #279).

**The ruling on who writes it:** C10, not the server.
- **What C10 does:** before the server's first start in a container, C10 links the container's extension folder entries
  to the shared cache, over C11. After the start, it adds what the server installed to the cache.
- **Why C10:** the server we install is VSCodium's REH, used as published. This brief rules that it isn't patched, by
  the same reasoning as ADR-0009's rule for the CLI: what we bend, we bend from outside, so a server upgrade is a
  version change and not a merge.
- **Writes:** they go through lib-server's lock (V5), so two containers can't write the cache at once.

**Card it with:** the rows for AC-4, 5, 39, 41 and 42 once #92 is reviewed. Their `deferred` reason is removed then.

## 4. Docker hosts and contexts from settings (after #84's review)

Release 1 passes the editor's own environment through, `DOCKER_HOST` and the current context included (brief-release-1
ruling 10), and F-0501's payload carries `settings.context` when a non-default context is current. F-0205 adds the
settings that choose a host or a context.

**The ruling:**
- **C2 alone owns the effective engine.** It resolves the setting, the environment and the current context, in the
  spec's precedence, into one engine coordinate. That's `dockerPath` plus the environment that picks the engine, the
  shape the shutdown helper already registers (containers-69).
- **Everyone uses that coordinate:** C3, C11, C15 and the shutdown helper spawn with it and never read the settings
  themselves.
- **The payload** carries the resolved coordinate, so a reload uses the engine the window was opened on.
- **Remote engines over SSH or tunnels** stay with the remote-engines group, "Later". F-0205's local `DOCKER_HOST`
  (a TCP or socket address) and contexts are this item.

**Card it with:** F-0205's criteria, seeded at its review.

## 5. What doesn't change

- **No new component.** Podman and the hosts are C2. The cache is C10, over C11 and lib-server's lock.
- **No contract changes** except one at F-0205's card: `contracts.md` §2 gains the coordinate's resolution in C2.
- **ADR-0009 stands.** The CLI stays pinned and unmodified.
