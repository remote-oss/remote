# Brief: configuration semantics, machine settings and the partner menus

Owner: athena (architect). Plan: #1807's release-2 families. Specs, all `spec:reviewed`:
- remote-oss/remote-containers#58 (F-0304 Variable substitution);
- F-0305 Property support matrix;
- F-0306 Image metadata merging;
- #60 (F-0506 Machine settings and MCP servers);
- #106 (F-0507 Extension host debugging);
- #83 (F-0603 Integration with the Docker and Container Tools extensions).

Decisions: ADR-0005, ADR-0009 (the CLI bridge, amended by this brief), R-26, R-60, D-14, F-1404 (partner
extensions; the generated Copilot instructions), `brief-attach.md` (C12), `brief-volumes.md` (explore),
`brief-foundations.md`.

## 1. What a survey found (2026-11-04)

| Family | Built, needs a row or a `core` tag | A gap of ours | Waits on another feature or a host |
|---|---|---|---|
| F-0304 | 53 | 2 | 12 (attach; `host: windows`) |
| F-0305 | 24 | 1 | 3 (F-0506; attach) |
| F-0306 | 33 | 0 | 16 (F-0506; F-0206; attach; `host: windows`) |
| F-0506 | 0 | 15 | 0 |
| F-0507 | 27 | 2 (the activation event; a spec conflict) | 8 (attach; F-1302; Kubernetes; Apple; `host: windows`) |
| F-0603 | 1 | 18 | 5 (F-0806; F-1302; `host: windows`) |

- **Most of F-0304, F-0305 and F-0306** is the dev container CLI's own work, which we delegate (ADR-0005), and it's
  correct.
- **About 30 lines** of F-0305 and F-0507 are core's behaviour alone. They take the `core` tag with a reason, not
  rows.

## 2. Two corrections to the CLI bridge (F-0304; ADR-0009 amended here)

1. **The pre-pass must not leak into the image's metadata label** (F-0304 AC-14).
   - **The problem:** the CLI builds `devcontainer.metadata` from the configuration text it reads. With our
     `--override-config`, that's the pre-pass's text. So a `${localEnv:VAR:dflt}` the pre-pass resolved (deviation 1:
     an empty `VAR` gives its default) lands in the label as `dflt`.
   - **The fix:** deviation 1 moves to the spawn **environment**. A variable that the configuration references in
     `${localEnv:…}` or `${env:…}` with a default, and whose value is empty, is left out of the CLI's environment for
     that run. The CLI's own lookup then gives the default for an unset variable, and an empty string for a
     reference without one, as before. The configuration's text and the label stay as written.
   - **The volume pre-pass** (the container CLI host, #1973) stops resolving `localEnv` and `env` in the text. It
     passes the referenced variables by name (`--env NAME`, values in the Docker client's environment, as that host
     already does), with the same empty-variable rule. A referenced variable that's unset, or empty with a default,
     on the host is unset in the CLI's environment inside too, so a value of the bootstrap's own (its `HOME`, its
     `PATH`) never stands in. It still sets `workspaceMount` and `workspaceFolder`.
   - **Rows:** with `VAR` empty, an `up`'s label keeps `${localEnv:VAR:dflt}`, and the container's value is `dflt`.
     The same holds for a clone in a volume.
2. **`${containerEnv:…}` in `initializeCommand`** (F-0304 AC-27): ADR-0009's deviation 2 ("the CLI already gives
   `''`") is wrong.
   - **What happens today:** the CLI leaves the reference in the text. `bash` then makes it empty, `dash` fails with
     "Bad substitution", and the array form passes it literally. `cli-bridge.test.ts`'s row asserts a bash side
     effect.
   - **The rule:** every `${containerEnv:NAME}` and `${containerEnv:NAME:default}` in `initializeCommand` (string,
     array and object forms) becomes `''`, or the default, in the pre-pass's override, before the CLI runs it.
   - **The constraint:** the label rule above holds. The card measures with a row that the CLI doesn't copy
     `initializeCommand` into the label. If it does, the line comes back to me.
   - **Rows:** the bash-only row is replaced by a row on `dash` and one for the array form.

**ADR-0009's amendment** (in this PR):
- deviation 1 is now the spawn environment;
- deviation 2 is now the pre-pass;
- the pre-pass serves only deviations 2 and 7, plus the volume host's workspace values.

## 3. The S219 warning (F-0305 AC-13)

- **What it is:** an unsupported property gets S219 as a diagnostic of ours. It goes in a second collection beside
  F-0414's Feature diagnostics, from one pure function over the JSONC text, with F-0305's matrix as data.
- **Trust:** it runs only in a trusted window (F-0305 AC-9).
- **F-0414's Feature diagnostics** run without trust today, and the card checks them against AC-9. If they must wait
  for trust too, that's the same one-line gate.

## 4. Machine settings and MCP servers (F-0506; C10)

- **When and where:**
  - It runs at the remote user's first server start, which means the markers are absent from that user's
    server-data `Machine/` folder, whatever the container id (BR-3, BR-12).
  - It runs inside the container, over C10's exec channel, after the server files and before the server starts
    (BR-9; `brief-personalization.md`'s step 2).
  - It shows no progress of its own and no notification, even when it fails. A failure is a log line (7.E1).
- **The settings step** (BR-1, BR-5 to BR-7, BR-11):
  1. **The marker:** if `Machine/.writeMachineSettingsMarker` is absent, it's created at once. If it's present, the
     step ends.
  2. **The target:** if `Machine/settings.json` already exists, the step ends.
  3. **The content:** the file is written once, with its keys in this order:
     1. our Copilot instructions entry (below);
     2. the merged `customizations.vscode.settings`;
     3. `remote.portsAttributes`;
     4. `remote.otherPortsAttributes`.

     The last two are present only when the configuration has the property.
- **The MCP step** (BR-1, BR-2, BR-4), independent of the settings step:
  - `Machine/.writeMachineMCPConfigMarker` is created if absent, whether or not there's an MCP value. If it was
    present, the step ends.
  - When the merged `customizations.vscode.mcp` is non-empty and `User/mcp.json` doesn't exist, that value is written
    there as it is (AC-5).
- **The merge:**
  - **The order:** the merged configuration's per-layer `customizations.vscode` entries, in metadata order: the
    image's own, then declared Features, then the configuration last (BR-5).
  - **The rule:** objects merge key by key, and a later layer's other value replaces an earlier one.
  - **The legacy `settings`** is already folded in by the CLI, with `customizations.vscode.settings` winning a key
    (BR-6, AC-13).
  - **No validation** of the content is ours (BR-8).
- **The Copilot instructions entry** (BR-7, AC-9; F-1404's decision, so it's built now):
  - **What it is:** one entry in `github.copilot.chat.codeGeneration.instructions`, in our own words. It says the
    workspace is in a dev container and gives two values:
    - the OS release that lib-server's platform probe already read;
    - which tools of a fixed list of ours (data in the module) are on the remote user's `PATH`, from one probe.
  - **When:** it's written on every editor, with no check for Copilot or `chat.disableAIFeatures`.
  - **Arrays:** when a layer also sets that key, our entry is added to the merged array. It's not a conflict.
- **What changes in the code:**
  - `settings/machine-settings.ts` writes the port attributes on **every** connect today, merging keys, which breaks
    BR-11's gate (AC-14's second half). The marker gate replaces that.
  - `connector.ts` passes the merged layers instead of `portAttributeSettings(merged)` alone.
- **Every family** (BR-10):
  - **Attached containers:** the source is the image's metadata plus the attach file's `settings`
    (`brief-attach.md` §4 step 7).
  - **Kubernetes, Apple and clone-in-volume windows** run the same steps.
- **The markers' and files' names** are the spec's observable paths (D-14).
- **This unblocks the settings clauses of** F-0305 AC-6 and AC-8, and of F-0306 AC-1, AC-4, AC-41 and AC-48.

## 5. Extension host debugging (F-0507)

- **The activation event:** `onDebugResolve:extensionHost` joins the manifest's `activationEvents` (BR-1). It isn't
  there today.
- **`(reading-2140-twin)`, F-0507 AC-24 with F-0409 AC-24:**
  - **The conflict:** F-0507 AC-24 has the Extension Development Host connect to the running container when an
    exited twin exists, and it doesn't say which twin is newer. F-0409 AC-24, the owner of the matching (C7's
    `decide()`), starts and uses the **newer** twin, even when the older one is running.
  - **The reading:** F-0507 AC-24 is the case where the exited twin is the older one. `decide()` already uses the
    running newer container there, so the line takes a row with that order. When the exited twin is newer,
    F-0409's rule holds.
  - **The question** goes to metis, asking whether AC-24 also meant the newer twin.

## 6. The Container Tools menus (F-0603)

- **The contributions:**
  - **The two row commands:** `attachToRunningContainerFromViewlet` and `inspectVolumeFromViewlet`, each with Palette
    `when: false` and its `view/item/context` placement in the group F-0603 §3.3 names.
  - **The `view/title` "New Dev Container"** goes in with F-0806's card.
  - **`cloneInVolumeFromViewlet`** is declared but never registered (AC-8).

  All of them are menu contributions only: we build no tree, and the partner may be absent (F-1404).
- **The row argument** (BR-5) is one pure function for both commands:
  - **A usable row:** the partner's element for a container or a volume, in our extension host. The command targets
    its container id or volume name with no picker, and a selection argument is ignored.
  - **No argument** (a keybinding), or an unusable one (a handle from another extension host, a redrawn row): the
    command is exactly its palette twin. That's `attachToRunningContainer`, with F-0601's warning and S316's
    picker, or `inspectVolume`, with S319's picker, in the same window.
  - **A row whose container is gone** when the attach runs: S034 shows, where the reference was silent (7.E5's
    required behaviour).
  - **Validation:** the id or name is validated before it reaches Docker, and F-0201's Docker check runs first
    (7.E8).
- **The flows** are the existing ones:
  - the attach (C12, `brief-attach.md`) opens a new window;
  - Explore a Volume (`brief-volumes.md`) reuses the window (BR-3).
- **`(question-2140-row-shape)`:** the spec doesn't say which property of the partner's element holds the container
  id or volume name ("can't be told apart from outside").
  - **Why it's a question:** the clean side may not run the partner, and its source isn't an admitted source.
  - **The question:** it goes to metis with this PR, asking that F-0603 name the element's properties.
  - **Meanwhile:** the card builds everything else. The function's two property names come from the answer and are
    the card's last step.
- **Our rows** need the partner's views: a test stand-in of ours (its own `remote-oss` test id) that contributes
  `vscode-containers.views.containers` and `.volumes` with that element shape, like #2065's companion stand-in.
- **The published suite** (`tests/conformance/suite/F-0603`, 58 cases) installs Container Tools itself
  (`ms-azuretools.vscode-containers`) as a fixture. Microsoft's extensions stay off the clean side (AGENTS.md, D-104),
  and Container Tools is one of them, though MIT. Whether the clean side's runner may install it for these cases is
  the user's decision, asked through hermes with this PR. Until then, our rows with the stand-in carry F-0603's
  lines.

## 7. The cut and the cards

| Lines | Where |
|---|---|
| the built lines (about 140) and the `core` ones (about 30) | rows and tags (card 5) |
| F-0304 AC-14, AC-27 | card 1 |
| F-0305 AC-13 | card 2 |
| F-0506 (15), and the settings clauses of F-0305 and F-0306 | card 3 |
| F-0507's activation event and AC-24; F-0603 (18) | card 4 |
| attach, F-0206, F-0806, F-1302, Kubernetes, Apple and Windows lines | their features' cards, as their briefs cut them |

**Suggested cards** (daedalus):
1. **The CLI bridge corrections:** §2, with ADR-0009 as amended here.
2. **S219.**
3. **Machine settings and MCP:** §4, every family.
4. **Debugging and the Container Tools menus:** §5 and §6, with the stand-in.
5. **Rows and tags.**

**Spec questions for metis** (with this brief's PR):
- F-0507 AC-24 with F-0409 AC-24;
- F-0603's element properties.
