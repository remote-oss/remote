# ADR-NNNN: Distros are named by their registered spelling, read fresh, and paths are translated by WSL itself

- Status: proposed (draft by `remote-architect-worker-4` for the lead, who assigns the number)
- Date: 2026-10-06
- Deciders: the lead
- Scope: `lib-wsl` (D2, D3), the `remote-wsl` engine and B's WSL surfaces that show distro names or paths
- Requirements:
  - remote-wsl F-6201 BR-1, BR-10, Q2;
  - F-6103 BR-3;
  - F-6203, F-6204 BR-1 to BR-5;
  - F-6206 R1;
  - F-6207 BR-3;
  - F-6503;
  - F-6701 BR-3;
  - F-6101, F-6202, F-6501 and F-6502 (pending; this ADR is revised when they land).

## Context

Several features name a distro: authorities, labels, rows, pickers, the cache of sessions and the rendezvous. The
name comes from three places, each in its own case and form:
- what a user typed into an authority;
- what WSL registered;
- a `\\wsl.localhost` share.

Paths cross between Windows and the distro in reopen, open-folder, reveal and the server install. A distro can mount
the Windows drives somewhere other than `/mnt` (`[automount] root`).

## Decision

1. **The registered spelling is the identity.**
   - D2 matches a typed name case-insensitively against WSL's list and returns the registered spelling.
   - Every `wsl.exe` call, label, row, log line, session key and rendezvous key uses it (F-6201 BR-1).
   - The codec passes names through unchanged (B, PR #26).
2. **The empty name is the default distro**, resolved by D2 at each use (F-6201 Q2 (a), F-6103 BR-3). The authority
   keeps the empty name, so a window follows a later change of default only when it is reopened.
3. **Nothing about distros is stored.** The list, the default, the versions and the states are read fresh from
   `wsl.exe` at each use (F-6201 BR-10). The only state is the advisory flags (F-6206) and the background-download
   entries (F-6301 BR-13), all in global state under our id.
4. **Paths are translated by WSL.**
   - Drive paths go through `wslpath` in the target distro, so a custom automount root is honoured without parsing
     `wsl.conf` (F-6204 BR-1/BR-2).
   - Share paths (`\\wsl.localhost\<d>\…`, `\\wsl$\<d>\…`) are translated as text, and only `wsl.localhost` is ever
     produced (F-6207 BR-3).
   - The `/mnt/<letter>/` advisory test is a literal shape test by design (F-6206 R1).
5. **A path is translated as one unit.** A workspace file moves as a file; its folders are core's (F-6204 BR-3).
6. **Nested distros** carry the outer authority in the codec's `outer` field. The registered spelling is that of the
   remote host's WSL (F-6701).

## Options considered

| Option | For | Against |
|---|---|---|
| Registered spelling, fresh reads, `wslpath` (chosen) | Matches the observations; honours `wsl.conf` without parsing it; no stale cache after a distro is added, renamed or removed | One `wsl.exe` start per translation and per list read |
| Keep the typed name | No lookup | Labels and calls differ from WSL's spelling (F-6201 6.7) |
| Cache the list per window | Fewer processes | Stale after `--install`, `--unregister` or a default change, which the specs exercise |
| Parse `wsl.conf` and translate drive paths in TypeScript | No process | Re-implements WSL's rules (automount options, drive letters); breaks on WSL changes |

## Consequences

- D3's share translation and URI building are pure and unit-tested. Drive translation needs the fake or a real
  distro.
- Rows and pickers that refresh often (F-6501, pending) may need the coalescing D2 already allows within one refresh.

## Check

Unit tests for case matching, the empty name, share forms and URI round trips through B's codec. A conformance case
with a custom automount root (F-6204 W6, F-6301 S13).
