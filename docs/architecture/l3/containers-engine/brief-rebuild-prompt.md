# Brief: F-0303, the rebuild prompt when the configuration changes

Owner: athena (architect). Issue: #1204 (daedalus's request; triton's §6 stop on #1808). Spec:
remote-oss/remote-containers#47 (F-0303, `spec:reviewed`), seeded in `coverage-containers-r2.tsv`. F-0405 AC-9 (release
1) waits on it. Decisions: D-105, R-27, ADR-0010, R-60.

## 1. The component: C16 config-watch (new)

- **What it does:** it watches the files of a connected dev container's configuration, keeps their acknowledgment,
  and raises STR:S083 with "Rebuild" and "Ignore". It runs in the UI extension host of a connected dev-container window,
  so the files it watches are the host's, on this machine.
- **What it depends on:**
  - C4, for the configuration's tolerant JSONC reader;
  - C6, for the rebuild a click starts (F-0405's flow, the same as Rebuild Container, BR-6);
  - the window's payload, for the `configFile` (F-0501 BR-2a).
- **Why not inside C6:** C6 opens and reloads windows. Watching and acknowledging is a long-running duty of a connected
  window, with state of its own. Keeping it apart keeps both testable with fakes.

## 2. What "changed" means (BR-4, BR-9, BR-9a, BR-10, BR-13)

- **The fingerprint:**
  - `devcontainer.json`: the SHA-256 (lowercase hex) of the object C4's tolerant JSONC reader recovers (comments,
    trailing commas, a missing final brace), re-serialized as compact JSON with the keys in file order. So comments and
    spacing don't count, and a key reorder does.
  - A build file: the SHA-256 of its raw bytes.
- **The acknowledgment** lives in the window's own `workspaceState` (the dev-container workspace's storage), under a
  key of ours (R-27), with the observed shape: `{"configurationState": {"contentHashes": {"<identifier>": "<hash>"}}}`.
  The identifier is the file's `{0}` text (BR-3).
- **How it changes:**
  - **Seeding (BR-9, BR-9a):** at every successful connect of the window, whether something was built or an existing
    container was reused, a file with no stored hash takes its current hash, with no notification. After a successful
    rebuild, every watched file takes its current hash. So a missing hash is never "diverged".
  - **Ignore:** the files named in that notification take their current hashes, and only those (BR-8).
  - **Rebuild:** the click changes nothing. The successful connect after the rebuild seeds every watched file (BR-8,
    BR-9). A rebuild that fails never connects, so the acknowledgment stays exactly as it was (BR-10, 7.E4).
  - **Dismissal** changes nothing (6.4).
- **Shown once per combination:** an in-memory set, per activation, of the exact `{0}` lists already shown. It's
  forgotten at the next activation (BR-4 b, 7.E3).

## 3. The watched set and when each file is checked (BR-1, BR-2, BR-11)

- **The set:**
  - the `devcontainer.json` in use, from the payload's `configFile`;
  - the file its `build.dockerfile` names, or the legacy top-level `dockerFile` (BR-2, VS-16);
  - the files its `dockerComposeFile` names (one or an array).

  Each path is resolved from the configuration's folder and shown as BR-3 says.
- **When:**
  - `devcontainer.json` is watched live. `fs.watch` on its folder (the UI host is local) catches renames and atomic
    saves; a 500 ms debounce applies, then the file is re-read, re-hashed and compared. Detection is well inside the
    observed ~3 s.
  - The build files are compared once per activation, at the connect, and never live (BR-1).
  - If `fs.watch` can't watch the folder (a network or unusual filesystem), a 2 s poll of `devcontainer.json` replaces
    it.
- **A changed reference (BR-11, 6.5):** when a live re-parse finds `build.dockerfile` or `dockerComposeFile` naming
  different files, the departing files stay in the set, flagged, until a notification that names them is acted on. The
  new files join the set. This is checked at the next activation for build files, as BR-11 observed.
- **Compose:** the Compose service's build Dockerfile (BR-2a) needs the Compose file read. That reader is the Compose
  family's, and Compose configurations can't be opened before that family lands. So BR-2a, and the Compose half of the
  set, come with the Compose brief's card. Until then the set is `devcontainer.json` and the Dockerfile.

## 4. The notification and the edges

- **Text:** STR:S083, "Configuration file(s) changed: {0}. The container might need to be rebuilt to apply the
  changes.", at `info` severity (BR-5), with the buttons "Rebuild" (primary) and "Ignore". `{0}` lists every file
  that is both watched and diverged, in ASCII case-sensitive order, joined by ", " (BR-3). There's no "Don't show
  again" and no progress.
- **Batching (6.3):** one evaluation, live or at activation, gives one notification naming every diverged file.
- **A deleted file (7.E5, BR-12):** a file that doesn't exist is not diverged and shows nothing. Its hash is kept, so
  recreating identical content stays quiet. The live watch keeps watching the folder.
- **No first-connect notification (VS-10):** that's what seeding gives.
- **An unconnected local window (7.E2, F-0303 AC-9):** C16 starts only in a connected dev-container window.
- **The Recovery Container (6.6):** C16 watches whichever file the payload's `configFile` names. The recovery family
  (F-0410's container) decides which file that is, so 6.6 comes with that family.
- **Executing in WSL (12):** the once-per-activation behaviour for `devcontainer.json` is the WSL family's,
  `host: windows` (ADR-0013).

## 5. The cut and the rows

| Part | Criteria | When |
|---|---|---|
| Image and Dockerfile configurations: fingerprints, seeding, Ignore, Rebuild, batching, deletion, AC-9 | F-0303's lines but BR-2a's, 6.6's and WSL's; F-0405 AC-9 | now |
| A Compose configuration's files and the service Dockerfile | BR-2a, VS-3, VS-17 | with Compose |
| The Recovery Container's file | 6.6, VS-12 | with the recovery container |
| `executeInWSL` | §12 | `host: windows` |

- **Unit, with fakes for the filesystem, the clock, the state and the notifier:**
  - the two fingerprints (comments and spacing ignored, key order counted, raw bytes for build files);
  - the set and its BR-11 departing flag;
  - seeding, Ignore's scope, Rebuild's seeding through the connect, a failed rebuild unchanged;
  - shown-once per combination;
  - the `{0}` order and form, including `.devcontainer.json` and a `../` path;
  - deletion and identical recreation.
- **Acceptance:** VS-1, 2, 4 to 11 and 13 to 16, and 18, in the containers launch. VS-3 and VS-17 come with Compose,
  and VS-12 with the recovery container.
