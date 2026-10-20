# Acceptance tests

The acceptance tests run in the editor under test, with the packaged extensions installed, against an SSH host in a
container. They prove the wiring and the host interaction; what the libraries decide on their own is unit-tested in
the packages.

```sh
pnpm test:acceptance    # on Linux without a display: xvfb-run --auto-servernum pnpm test:acceptance
```

The command packages the extensions, then `tools/acceptance.ts`:

1. builds the host image from `host/` (Alpine with OpenSSH's server and libstdc++, key login only, the user `harness` with the
   POSIX `sh` login shell, TCP forwarding allowed);
2. makes an Ed25519 key pair for the run and starts the host with its public key on a free local port;
3. writes an `ssh_config` whose `Host harness` reaches the host with that key, its own known-hosts file and no agent (and whose `Host 127.0.0.1` block reaches it by the address as typed),
   sets it as `remote.SSH.configFile` in the editor's user settings, and waits until the host accepts SSH;
4. bundles `suite/*.test.ts` into `dist/` and starts `@vscode/test-cli` with `vscode-test.mjs`: VS Code 1.139.1, a
   fresh user-data and extensions folder, the packaged VSIX of each extension under test, and the proposed API
   enabled for them on the command line;
5. removes the container and the run's folder, whatever the outcome.

Prerequisites: Node.js and pnpm as for the repository, Docker (or Podman behind the `docker` command), the OpenSSH
client, and on Linux without a display, `xvfb`.

## Writing a test

A test file is `suite/<area>.test.ts` and uses Mocha's `describe` and `it`; a test is named after the criterion it
proves. `suite/harness.ts` gives:

- `overSsh(command)`: the output of a command run on the host through the harness's SSH configuration;
- `onHost(...command)`: the output of a command run in the host container directly (`docker exec`), to check what an
  extension did there.

The extension host sees these variables:

| Variable | Value |
|---|---|
| `REMOTE_OSS_ACCEPTANCE` | `1`. The one switch with which an extension installs its harness adapters: dialogs answered from a script and recorded, the log readable by the tests. A user's editor never sets it. A package reads it in exactly one place, the adapter selection at activation, and no shipped README or string mentions it. |
| `HARNESS_SSH_CONFIG` | The `ssh_config` with `Host harness`, also set as `remote.SSH.configFile` in the user settings. |
| `HARNESS_CONTAINER` | The host container's id. |
| `HARNESS_RUN_FOLDER` | The run's folder: keys, known hosts, user data, extensions. |
| `HARNESS_VSIX_FILES` | The VSIX files installed, separated by the platform's path delimiter. |
| `REMOTE_OSS_ACCEPTANCE_SCRIPT` | The JSON file `{"entries": [...]}` that remote-ssh's scripted adapters answer from. Each entry names a surface, a text the question must contain, and the answer; the adapters answer only the next entry in order, dismiss anything else, and the licence modal can only be declined. An entry with an `after` is a held one: it answers only after the signal file of that name in `REMOTE_OSS_ACCEPTANCE_SIGNALS` exists. |
| `REMOTE_OSS_ACCEPTANCE_RECORD` | The file the adapters append one JSON line per question to: the surface, the question, the answer (a masked input's text is `<supplied>`, a held entry's waiting line is `held` and its withdrawal `withdrawn`) and whether an entry matched. |
| `REMOTE_OSS_ACCEPTANCE_SIGNALS` | The folder the signal files of held entries live in: the harness's `signal(name)` creates `<folder>/<name>` in it, and a held entry whose question ends first records `withdrawn` and gives nothing. |

The extension reads the script at every question, so a test may append entries at any time — they count from the next
question on — and a window's place in the script, its cursor, is the count of its matched record lines, so a reloaded
window continues where it left off. A test that needs its own script writes it before it opens the window that
connects, and `appendScript` of `windows/harness.ts` adds entries to the launch's script, atomically, between steps.

## The server lifecycle without the editor

`pnpm test:acceptance:server` runs `server/*.test.ts` in plain Node.js against the same host: the probe, install,
start, lock, kill, uninstall and clean-up of lib-server through the SSH host channel, with a stand-in server built by
the test and copied in with `docker cp`, so it needs no download. `pnpm test:acceptance:real-server` runs the one
file that installs and starts the real VSCodium server for musl (about 125 MB, fetched through the product fixture's
template into a folder of the temporary directory that the run removes): once downloaded by the host, once with the
host's download hosts made unreachable so that the client downloads and copies, and once from the archive the client
kept. It is skipped unless `REMOTE_OSS_REAL_SERVER=1`, which that script sets. In CI it runs when the workflow is dispatched with the `real-server` input set to true, and on the tag of a release.

## The run in VSCodium

`pnpm test:acceptance:vscodium` (on Linux without a display, under `xvfb-run --auto-servernum`) runs the harness in the
pinned VSCodium Insiders build named by `VSCODIUM_RELEASE` in `tools/acceptance.ts`: an exact tag, never "latest",
checked against the release's sha256 before it is unpacked into `.vscode-test/`. The stable VSCodium is below the
engines floor of ADR-0007. A mismatch fails the run with `the VSCodium download does not match its checksum`; bumping
the tag is a reviewed change that also updates both checksums.

The VSIX files are installed with the command-line wrapper in the build's `bin/` folder; the tests run in the build's
own executable, which test-cli starts. test-cli runs once per label, in order:

- `local`: `runner/` in a plain window, with the tests of `suite-local/` bundled into `dist-local/`;
- `remote`: `runner-remote/`, an extension of the workspace kind, in a window on
  `vscode-remote://ssh-remote+harness/home/harness`, with the tests of `suite-remote/` bundled into `dist-remote/`;
- `reconnect`: the same window in a second launch, with `suite-reconnect/`. It compares the host's server with the
  one the `remote` launch kept in the run's folder, so it shows that a new connection reuses the server;
- `agent`, `agent-off` and `x11`: `runner-remote/` with `suite-forwarding/`, in windows on
  `vscode-remote://ssh-remote+agentfwd/home/harness` (`ForwardAgent` with the run's agent socket; `agent-off` on
  `agentfwd-off`, the same alias under another name so that it finds no connection of `agent`, with
  `remote.SSH.enableAgentForwarding` false) and `vscode-remote://ssh-remote+x11fwd/home/harness` (`ForwardX11`). They
  find the server the `remote` launch's session started, and `HARNESS_FORWARDING_CASE` names the case;
- `failure-<alias>`: one launch per entry of `suite-failure/cases.json`, in a window on
  `vscode-remote://ssh-remote+<alias>/home/harness`, with `suite-failure/`. Its alias fails to connect (the harness
  `ssh_config` has `refused`, `nowhere` and `stranger`), and its window answers from the entry's own script, which the
  harness writes before the launch. The tests check the record.

- `terminal`: the same window with `remote.SSH.useLocalServer` off, which is terminal mode, with `suite-terminal/`.
- `socket`: the same window with `remote.SSH.remoteServerListenOnSocket` on, so the server listens on a socket, with `suite-socket/`.

- `slow`: the same window with `suite-slow/` and a development extension of the workspace kind that takes 15 s to
  activate in the remote extension host (`slow-remote/`, which writes `/tmp/acceptance-slow-started` and
  `/tmp/acceptance-slow-done` on the host). A development extension named by a local path never runs on the host, so the
  harness copies the extension into `/home/harness/slow-remote` before the launches (`hostExtensions`) and the launch
  loads it with `--extensionDevelopmentPath=vscode-remote://ssh-remote+harness/home/harness/slow-remote`.

- `client-<name>`: eighteen launches, one per entry of `suite-client/cases.json`, each in a window on
  `vscode-remote://ssh-remote+harness/home/harness` with `suite-client/`. The run writes fake ssh clients into
  `<run>/clients/` before the first launch (`tools/acceptance-clients.ts`); each logs its name and `check`, `options` or
  `connect` to `calls.log`, answers `-V` with the banner of its case and otherwise runs the real `ssh`. A launch sets its
  own `remote.SSH.path`, puts `clients/path` first on `PATH`, and the rows compare `calls.log` with the case. Every
  launch is a fresh resolve: before a launch the run waits 5 s for the connection helper of the one before to end
  (its grace is 3 s) and clears `calls.log`, because a live helper is reused without any check. The launches run in
  every VSCodium run.

- `windows`: a launch with no runner (`kind: 'plain'`). The editor is started plainly, as a user starts it, with no test run in it, one user-data folder and the run's extensions folder, which holds our VSIX files and the window agent's; a Node mocha run of `windows/*.test.ts` drives and observes it. See "Several windows".

- `config-files`: a plain launch with a `HOME` of its own, `<run>/home` (the test's rows empty it before they run), an empty `SSH_AUTH_SOCK`, and the XDG folders under `<run>/xdg/`, so the editor's own files stay out of the account's folders and the launch's `HOME`; `config-files/*.test.ts` sets `remote.SSH.configFile` through the run's user settings and reads the back through the host pick, the connects and the log. Its `PATH` starts with `<run>/ssh-bin`, whose `ssh` the run writes before the launch: a pass-through that notes each call's argv in `<run>/ssh-bin/invocations.txt`, one argument per line and a blank line after every call, and then execs the real ssh unchanged, so a row still sees the argv of an ssh that lived only milliseconds; the rows read the notes with `invocationNotesOf` of `tools/acceptance-clients.ts`.

- `default-ports`: a plain launch with the renderer helpers, whose settings forward one default port; `default-ports/*.test.ts` opens windows and reads the local end of a port, the window's tunnels (`tunnelsOf`, the agent's `acceptance.agent.tunnels` over `workspace.tunnels`), a setting's default in the window (`settingDefaultIn`) and core's notifications.

- `no-proposals`: the same without the proposed API.

- `terminal-pick`: a plain launch with `remote.SSH.useLocalServer` off and no stored `remote.SSH.remotePlatform`; the test answers the platform pick with Linux and a window on `harness` connects and stores the platform.

- `explorer`, `explorer-alone`, `explorer-trust`, `explorer-home`, `explorer-rows`, `explorer-no-proposals` and `explorer-standdown`: plain launches with Remote Explorer installed in an extensions folder of their own and a debugging port (see "Reading the window"); `explorer-alone` starts with Remote - SSH disabled, `explorer-trust` with workspace trust on, so a new folder window is in Restricted Mode, `explorer-home` with the run's own HOME (`<run>/home`), where its rows write the user's SSH configuration, `explorer-rows` with the view's own rows (activation, the hosts of a file, Refresh and SSH windows) apart from `explorer`'s gate rows, whose Connect in Current Window reloads the launch's window, `explorer-no-proposals` without the proposed API, and `explorer-standdown` with a stand-in carrying the reference Remote Explorer's id, so the explorer meets it at its first activation.

- `trust` and `trust-terminal`: plain launches with workspace trust on and a debugging port, and no extension of their own (see "Trust" under "Launches"); `trust-terminal` turns `remote.SSH.useLocalServer` off and names the host's platform.

- `web-ui` and `web-ui-trust`: plain launches with a debugging port and a recording `xdg-open` first on the editor's PATH; the suite writes it into `<run>/browser-bin` and reads the addresses it was asked to open from `<run>/browser-urls` (`windows/web-ui-support.ts`), for the rows of Open Web UI. `web-ui-trust` has workspace trust on and core's startup trust prompt off, so a window opens in Restricted Mode and silent. A terminal-mode connect in it (`remote.SSH.useLocalServer` off) waits on core's trust question before its login terminal starts, and fails when nothing answers within the connect timeout, so its rows connect only through the local server.
- `containers`, `containers-standdown`, `containers-no-proposals`, `containers-trust`, `containers-explorer`, `containers-ports` and `containers-shutdown`: plain launches with Dev Containers installed in an extensions folder of their own and a debugging port (see "Dev containers" under "Launches"); `containers-standdown` has a stand-in carrying the other Dev Containers extension's id, `containers-no-proposals` starts without the proposed API, and `containers-trust` starts with workspace trust on and core's startup trust prompt off, so a folder opens untrusted and silent, `containers-explorer` also installs the Remote Explorer, for the rows on the two extensions' views side by side, and `containers-ports`, as `containers` is, is for the rows that read core's Ports view, and `containers-shutdown`, as `containers` is, for the rows of the shutdown helper that stops a container after its windows close.

Every label runs even when an earlier one fails, and the run fails when any does. The tests run in the window's
local extension host, also in a window on `ssh-remote`: they see the host through the editor API and `onHost`, and
they start in a window whose connect failed. `HARNESS_EDITOR` (`vscode` or `vscodium`)
and, for VSCodium, `HARNESS_VSCODIUM_EXECUTABLE` join the harness variables. In CI the job `acceptance (VSCodium)` runs
when the workflow is dispatched with the `vscodium` input set to true, and on the tag of a release.

### The record and the log

With `REMOTE_OSS_ACCEPTANCE` set, the extension also writes display-only lines to the record, in the order the calls
happen: a `progress` line with the title of each progress message (no `details`), then one line per update of its
message, with `details` true or false as the message carried the details link. `recordLines(surface?)` of
`suite/harness.ts` reads them. `REMOTE_OSS_ACCEPTANCE_LOG` names a file the log channel's lines are appended to, after the
logger's secret masking: `<run folder>/<label>-log.txt` for each VSCodium launch and `<run folder>/log.txt` for the
VS Code run. `connectionLog()` reads it, without the time stamps. `REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG` names the same
for Dev Containers' log, `<run folder>/<label>-containers-log.txt`, for each launch that installs it; `containersLog()`
reads it and `containersLogSince(mark)` reads the lines after a count taken earlier. Nothing of this exists when the
switch is unset.

### Several windows

The launches above run their tests in a window of the editor. A test cannot open a second window from there: a window
it opens would run the launch's tests again, and the end of any such window's run, also by a reload or a close, ends the
editor. A launch with no runner leaves that mode: `kind: 'plain'` in `acceptance-launches.ts` starts the editor with no
`--extensionTestsPath` and no `--extensionDevelopmentPath`, so every window shares one main process, one profile and one
settings file, as users have them (`globalState` and Global settings writes are the same for all windows). The harness
packages the window agent into a VSIX (`tools/acceptance-plain.ts`), installs it with ours, starts the editor on the
launch's own script, record and log files, runs the tests of the launch's folder under Node, and then stops the editor
and everything it started.

The window agent (`window-agent/`) is the only test presence in the windows. Three rules: it does nothing unless
`REMOTE_OSS_ACCEPTANCE_WINDOWS` is set; it lives only under `tests/` and never goes into a product VSIX; and a test
asks it for everything a user does to a window. The run sets the variable for every launch of a VSCodium run, pointing
it at the launch's own pid folder, `<run folder>/<label>/agent/pids`, so each launch's windows keep their own agent
files and two launches never mix their windows. The agent appends `activated`, `deactivated`, `accepted`, `done`,
`failed` and `state` events to `<run folder>/<label>/agent/<name>.events.jsonl`, and polls `<name>.commands.jsonl`
every 200 ms for `{id, command, args}` lines it has not accepted yet, so a command written while the window starts or
reloads is not lost. The deactivation is reported once, by the first of the extension's deactivate or the process's
own end that reaches it, so a window the harness ends still reports it. Its own commands are
`acceptance.agent.openWindow(uri)`, `acceptance.agent.writeFile(name, text)`, `acceptance.agent.openUntitled(content)` (opens an untitled editor holding `content`, which makes it dirty) and `acceptance.agent.state()`, whose report lists the uris of the documents with unsaved changes in `dirtyDocuments`; an
`openWindow` whose uri names an authority but no folder opens an empty window on it, the way the connect commands do,
and one with a folder opens a folder window.

A window's name is the last segment of its first folder's path, or a claim for a window with none. At every
activation, a window without a folder claims the first free name of its launch, `local` then `empty-1`, `empty-2`, …,
by creating the launch's claim file for it exclusively, and a window with a folder keeps its folder name and claims
nothing. The claim file stays for the launch's life, so a reloaded empty window comes back under the next free name,
and the rows that script an empty window do not reload it. The agent writes the name it has to the launch's pid file
for the window's process, `<pids>/<pid>`, rewriting it at every activation so a reused process id never carries the
name of the window that ran in it before.

The pid file is the one source the window's own product extension reads: when the launch's variable names a pid
folder, the remote-ssh extension's script and record name the window from the file, polled every 50 ms until a 10 s
bound, and a window whose file has not arrived shows as `unclaimed-<pid>` in the record. The agent activates on
startup and, on a remote window, when the window resolves its authority, so the file is there well before the bound;
in the measured run it was written 16 ms before the window's first record line. An empty window on a remote authority
has no folder to name it, and the editor API has no name of the authority a window is on, so the extension writes the
authority its resolver resolves to `<pids>/<pid>.authority`, and the agent's `state` reports it.

`windows/harness.ts` has the Node helpers: `openWindow(alias, folder)`, `inWindow(name, command, ...args)` (resolves on
`done`, fails on `failed`), `reloadWindow(name)` (resolves on the next `activated`; the reload command's own `failed` is
ignored, since its extension host may end first), `closeWindow(name)` (resolves on `deactivated`), `windowState(name)`,
which re-asks a remote window until its authority has arrived, `windowEvents(name)`, `recordLines(surface?, window?)`
and `scriptEntries(entries)`, which writes the launch's script for the windows that activate after the write. For the script and its held entries: `appendScript(entries)` (adds them to the launch's script atomically, so an adapter reading mid-write sees the old list or the new one), `signal(name)` (creates the run's signal file of that name; `never` is refused, the reserved name of an answer that must never come), `heldLines(window?)` (the record's waiting lines), `acceptedPasswords()` (the host's `Accepted password` lines for `harness-pw`, read from both of the container's streams, since sshd logs to its stderr with `-e`) and `hostPassword()` (the run's bare password, from `HARNESS_PASSWORD_FILE`).For the
empty windows: `emptyWindows()` lists the names their agents have activated with, in the order of their numbers,
`nextEmptyName()` the name the next empty window will claim, and `nextEmptyWindow(action)` runs `action` and resolves
with the one empty window it opens once that window's agent has activated, failing when it opens none or more than
one. `windowNameOrder(name)` measures the order the window's name reached its adapters: the milliseconds between the
window's pid file and its first record line, the row that opens the first empty window logs it. Every wait is bounded
at 60 s and fails naming the window and the event. The record's lines name the window that wrote them and carry the
time of their writing, and a script entry may name the window that answers it. The `hostPick` and `filePick` lines
record the pick's placeholder as the question, the answer taken or `dismiss`, and `items`, the labels the pick
showed, so a row reads the hosts and the fixed rows from the record. The run's folder is named after the run's id, so
that `acceptance:clean` ends an editor a killed job left behind.

### Reading the window

The explorer launches install Remote Explorer and its proposed API into `<run>/extensions-<label>`, so no other launch
has it, and start the editor with a debugging port that only the run reads (`--remote-debugging-port=0`; the editor
writes the port it chose into the user-data folder). Each window's title is its folder name in brackets, `[]` for a
window with none. `windows/renderer.ts` finds a window's page by that title and, over the Chrome DevTools Protocol,
reads a view's rows (`viewRows`) and clicks a row's inline action (`rowAction`) or a view's title action
(`titleAction`), as a user does. A test shows the view first with its focus command. The selectors read the workbench
of the run's pinned VSCodium build; the smoke rows of `explorer/renderer.test.ts`, on the editor's own file explorer,
show a change there first. Nothing in a product package exists for it.

### Launches

`tools/acceptance-launches.ts` holds the table of launches, in the order the run makes them, and nothing else lists
them: the labels, the configurations and the bundled suites all read it. Every runner launch's window stays open 2 s
after its last row, because the editor crashes on exit when it closes within moments of a connect. A launch has these
fields:

| Field | Meaning |
|---|---|
| `label` | the test-cli label: lower-case letters, digits and hyphens |
| `runner` | `runner` (a local window) or `runner-remote` (a remote one) |
| `suite` | the folder under `tests/acceptance`, bundled into `dist-<name without "suite-">` |
| `folderUri` | the window's folder; none for a local window |
| `settings` | merged over the run's base settings, for this launch only; the base settings are written again before a launch without any |
| `environment` | added to the extension host's environment for this launch only; a key of the launch overrides the harness variable of the same name |
| `ownScript` | the launch answers from its own `<label>-script.json` and `<label>-record.jsonl` |
| `hostSetup` | commands the run runs on the host container, as root, before each attempt of the launch, in order; a command started with `detach` does not block the attempt |
| `extraExtensions` | further development extensions, folders under `tests/acceptance`, loaded after the runner in the local extension host |
| `hostExtensions` | development extensions that run in the remote extension host: folders under `tests/acceptance`, copied into the host's home folder before the launches and loaded from there |

**Trust.** Every runner launch runs with workspace trust off: test-electron adds `--disable-workspace-trust` to the
editor's arguments whatever the launch's own are. The `trust` launches are plain launches, which start the editor
themselves, so they leave the flag out (`workspaceTrust`). The window agent declares that it supports untrusted
workspaces, so it runs in Restricted Mode too and reports `trusted` in its state (`isTrusted`). Rows read and answer
core's trust dialogs with `dialogOf`, `waitForDialog` and `answerDialog` of `windows/renderer.ts`. Each row opens a
folder of its own, so no trust decision carries over from another row.

**Dev containers.** The containers launches install Dev Containers into `<run>/extensions-<label>`, draw core's
dialogs in the window (`window.dialogStyle: 'custom'`) where `windows/renderer.ts` reads them, and download the server
from the run's download host (`remote.serverDownloadBaseUrl`). Before them the run removes the dev containers and
images another run left more than two hours ago (by the label `remote-oss.acceptance.devcontainer` and the run label),
then builds the run's dev container image from `tests/acceptance/devcontainer-image` (`HARNESS_DEVCONTAINER_IMAGE`).
Every dev container a row creates carries the run's labels (`HARNESS_RUN_ID`), so the run's clean-up removes it and its
image. The run never removes the `vscode` volume: every dev container on the engine shares it, a developer's own
included. `containers-standdown`'s stand-in is a manifest only, with no code and no contribution, written into that
launch's extensions folder before it starts and removed with the run's folder; it's never packaged or committed.
`notifications` of `windows/renderer.ts` reads the toasts on screen and `notificationCentre` the notification centre,
which it opens: core doesn't always raise a notice that comes beside its own failed-resolve error as a toast, so a
row that must find such a notice reads the centre.

The rows that stop, pause or remove the container of a connected window (`containers/reconnect.test.ts`) leave the
window about five seconds after the connect first. Core's remote status listener draws no dialog for a permanent
failure that comes in about the first second after the window connects, whatever the extension answers (measured in
card containers-61: the dialog came in 0 to 3 of 5 stops made at once, and in 12 of 12 made from two seconds on, while
the extension's answer was the same in all of them).

Two facts about the dev container CLI (version 0.89.0, Docker 29.9.1) that the ports rows rely on, measured in card
tooling-56:
- `devcontainer up` with `"appPort": [18741, "18742:8742"]` publishes `18741/tcp` on `127.0.0.1:18741` and `8742/tcp`
  on `:18742`, on all interfaces. The CLI already applies the rule for `appPort`, so no `--override-config` pre-pass is
  needed.
- After `forwardPorts` is edited from `[3000]` to `[4000]` on a running container, `read-configuration --container-id
  <id> --include-merged-configuration` gives `mergedConfiguration.forwardPorts` `[3000]`, the container's
  `devcontainer.metadata` label, while the configuration says `[4000]`. The merged configuration is the list as it was
  when the container was built.

**The Ports view.** `windows/renderer.ts` reads core's Ports view, a table: `portsRows` gives each row's Port column,
forwarded address, running process, origin, icon (the row icon's codicon class) and hover, and `portRowActions` the
titles of a row's inline actions and of its context menu's items. A table that overflows is read from its top, a
viewport at a time, by wheel steps dispatched on a row (the table scrolls by its own scrollable element, not by the
DOM's `scrollTop`). Show the view first with `~remote.forwardedPorts.focus`, which core registers only once the view
exists, so wait for it in `commandsOf`. The forwarded-ports status item reads with `statusItem(name,
'status.forwardedPorts')`. `listenIn(containerId, port)` starts a listener in a container, with busybox's `nc`, and
gives the function that ends it. "Forward a Port" is `remote.tunnel.forwardCommandPalette`, answered in its input box
with `answerInputBox`.

**Choosing launches.** `--launches` takes `all` (every launch that isn't named only), `none`, or a comma list of
entries, applied in turn:
- a label;
- `all`;
- `@<group>`, every launch of a group, named-only ones included;
- `!` before any of these, which takes out what the entries before it put in.

The launches are made in the table's order whatever the order of the entries. Every launch is in one group, computed
from the table (`launchGroupOf`):
- `genuine`: the genuine client;
- `containers`: installs Dev Containers;
- `explorer`: installs Remote Explorer and not Dev Containers;
- `hosts`: the ports, install and platform cases;
- `ssh`: every other.

An entry that names no label or group fails, listing both. The backstop splits across three runners this way:

    node tools/acceptance.ts --editor vscodium --launches @ssh
    node tools/acceptance.ts --editor vscodium --launches @containers
    node tools/acceptance.ts --editor vscodium --launches @explorer,@hosts

`@ssh,!terminal` is the ssh group without one launch.

To add a launch: add a row to `launchesOf` and put its tests in the suite folder it names. A runner suite's folder goes
in `tests/acceptance/tsconfig.json`'s `include`. A plain suite has a `tsconfig.json` of its own, which goes in the root
`tsconfig.json`'s `references` and in `eslint.config.ts`'s `TYPESCRIPT_PROJECTS`. Either kind's test files go in the
entries of `knip.jsonc`.

### Ports cases

The ports cases of `suite-ports/cases.json` prove F-2409 end to end: one launch per case, `ports-<label>`, a window on
the case's authority (`harness` by default, `harness@127.0.0.1` for the `address` case), the case's settings over the
run's base, `HARNESS_PORTS_CASE` naming the case for the window, its own script and record, and its host setup. They
come after every other launch, in the file's order, and a launch's host setup runs before each attempt of it, in
order, as root in the host container. The setup of a case, in this order, is: free the ports a holder holds
(`pkill` on the `nc` pattern, the brackets kept from matching the `sh -c` that runs it); free the server, unless the
case keeps it, and wait for it to be gone; then per held port, start a BusyBox `nc -lk … -e /bin/true` holder on
`127.0.0.1` (it keeps listening after each connection, so the server's port test, which listens to probe, finds it
busy) and wait until `netstat -ltn` shows it. The harness writes the ports script for every case before the first
launch: dismiss the connect's dialog and its pick of actions. A connected case leaves it unused, which is no
failure.

### Platform cases

The platform cases of `suite-platform/cases.json` prove F-2206 end to end: one launch per case, `platform-<label>`, after
the ports cases, with `HARNESS_PLATFORM_CASE` naming the case, a window on the case's authority (`harness` by
default; `harness@harness` for a typed user and host, `mute` for the host whose login shell does not answer the probe),
the case's settings over the run's base (`remote.SSH.useLocalServer` off for terminal mode; the stored
`remote.SSH.remotePlatform` and `remote.SSH.windowsRemotes` of the case), and its own script and record. A case's
`after` says what the settings file holds of `remote.SSH.remotePlatform` once the connect has ended: `absent`,
`unchanged`, the entries written (keys in that order) or `bytes` (the file as the launch wrote it). The case with a
`settingsTail` gets a syntax error after its last member, with no comma before it, so the editor reads the members
before it.

### Install cases

The install cases of `suite-install/cases.json` prove F-2403, F-3902 and F-2405's download modes end to end the same
way: one launch per case, `install-<label>`, after the ports cases, with `HARNESS_INSTALL_CASE` naming the case. Both
suites are host-case suites (`HOST_CASE_SUITES` in `tools/acceptance-launches.ts`): a case may keep the server
(`keepServer`), keep only its files (`keepFiles`), add host commands (`setup`) and give its own script (`script`,
default: dismiss the dialog and its pick). An install case that keeps nothing also removes
`/home/harness/.vscodium-server-insiders` and `/tmp/srv`. A case's settings may name the download host's bases as
`${HARNESS_DOWNLOADS_HTTP}`, `${HARNESS_DOWNLOADS_HTTPS}`, `${HARNESS_DOWNLOADS_LICENSED}` and
`${HARNESS_DOWNLOADS_LOCAL}`; the run puts them in when it writes the launch's settings, and leaves the product's own
`${…}` placeholders as written. Before each launch the run notes how many requests the download host has logged, in
`<run>/<label>-requests-start`, so `downloadRequests()` of `suite-install/install.ts` reads only the case's own. The
host's downloaders send a `Wget` or `curl` user agent, and the editor's download doesn't.

A launch with host setup also waits the helper's grace before it starts: the helper of the previous launch outlives
its window by `HELPER_GRACE_MILLISECONDS` of the extension, and a live one would be reused by the resolve without any
check. The run's `FRESH_RESOLVE_WAIT_MILLISECONDS` is that grace, and a unit row keeps the two equal. The cases need
the wait: F-2409 AC-3 names "no live connection from the client to the host", and `reuse` keeps its range's server on
the host while its connection is still fresh.

When the run writes a launch's settings, it writes the same bytes to `<run folder>/<label>-settings.json`, and a row
compares the user settings file the window read with that copy (F-2409 AC-17).

The rows read back what the connect left on the host: `serverPort()` is the local port of the one `LISTEN` line of
`netstat -ltnp` whose program is `node` (as `harness`, BusyBox `netstat -p` names only the user's own processes, so a
root's holder shows `-`); `listenAddress(port)` is the address of the `LISTEN` line that ends in `:<port>`, undefined
when there is none; `containerAddress()` is the host container's own address; `reaches(address, port)` is a
`net.connect` bounded at five seconds. The log has no line with the port: nothing writes F-2003's "Remote server
listening on port" line yet.

## The run's registry

A launch with `registry: true` (today `containers` and `containers-ports`) makes the run start a registry of its own before its
launches: the pinned `registry:2.8.3` image, by tag and by the digest of its index (`REGISTRY_IMAGE` in
`tools/acceptance-registry.ts`), on a loopback port of the host, waited for until `GET /v2/` answers 200. Its address
(`127.0.0.1:<port>`) is the variable `HARNESS_REGISTRY`; a run with no such launch starts none and sets no variable.
The registry holds only what a row pushes to it, and nothing public is pushed. It carries the run's label and the dev
container label, so the run's clean-up and the stale sweep remove it with its anonymous volume (`docker rm --force
--volumes`), also after a killed run.

## The run's templates

A launch with `templates: true` (today only `containers`) makes the run start its registry, as `registry: true` does,
and publish templates into it before its launches (`tools/acceptance-templates.ts`):
- **Three of the specification's templates**, the smallest the rows need: `alpine`, `docker-existing-dockerfile` and
  `docker-in-docker` (`MIRRORED_TEMPLATES`; the last is the template F-0801 AC-40 applies). Each one's single layer is
  fetched anonymously from `ghcr.io` by its digest, checked and kept in `.vscode-test/templates/`, as the server archive
  is. The layers are never committed and never in a VSIX.
- **Four of our own** (`tests/acceptance/fixtures/templates/custom/src/`), all on the pinned `alpine:3.22`, because the
  `alpine` template's image (`mcr.microsoft.com/devcontainers/base:alpine…`) is about 1 GB:
  - `mini`: one option (`greeting`) and one optional file. Rows that only build a container use it.
  - `options-lab`: one option of each shape (a strict `enum`, `proposals`, a plain string, two booleans, one boolean with
    no description), `optionalPaths` `zeta.txt`, `docs/*`, `alpha.txt` in that non-alphabetical order, files under
    `docs/` and a `README.md` and `NOTES.md`. For the options stage (F-0803) and the optional-files stage (F-0805).
  - `paths-free-lab`: one `enum` option and no `optionalPaths`. For a template with options and no optional files.
  - `bare-lab`: no options and no `optionalPaths`. For a template with neither.
- **Five Features of our own** in two collections. The collection `remote-oss-run/features` is published, from the
  Feature folders of `tests/acceptance/fixtures/templates/custom-features/src/` (a `devcontainer-feature.json` and an
  `install.sh` that writes its environment to `/usr/local/share/remote-oss-run/<id>.env`), so a row can build with
  them: `lab-options`, with five options (two booleans, one with no description, an `enum`, `proposals` and a string),
  and `lab-plain`, with none. The collection `remote-oss-community/features`, a second owner, is only listed
  (`custom-community-features.json`; nothing builds it): `add-community`, `Add Community Tool` and `Adobe Community
  Kit`, whose labels sort differently without regard to case than by code unit (F-0804's sort). For the Features stage
  (F-0804, F-0803, F-0414).

The CLI the package bundles publishes the templates, the mirrored ones as `devcontainers/templates` and ours as
`remote-oss-run/custom`, and our Features as `remote-oss-run/features`. The run's index, written to `<run>/downloads/templates/devcontainer-index.json`, is the
pinned snapshot `tests/acceptance/fixtures/templates/devcontainer-index.json` with every `ghcr.io/devcontainers/templates/`
id moved to the run's registry, plus a collection of our templates and the collections of our Features (`<registry>/<namespace>/<id>`, each with its
repository, which gives the owner a Feature list shows).
- **The snapshot** is a cut of the public index (`tools/trim-template-index.ts`): the
  `ghcr.io/devcontainers/templates` collection's metadata and the Features `common-utils`, `docker-in-docker`, `git`,
  `node` and `python` of `ghcr.io/devcontainers/features`, each collection with its source information and nothing
  else. It holds no other owner's metadata, whose licence we can't vouch for. The mirrored Features keep their
  `ghcr.io/devcontainers/features/…` ids, and no row builds with them. Its folder holds the specification's MIT
  `LICENSE` and `SOURCE.md` (the URL, the date and the full file's digest). It's test data, under `tests/` only.
- **The variables:**
  - `HARNESS_TEMPLATE_REGISTRY` is the registry as the templates' ids name it, `localhost:<port>`;
  - `REMOTE_OSS_TEMPLATE_INDEX` is the index's URL on the download host. It is harness-only: the product reads it only
    when `REMOTE_OSS_ACCEPTANCE` is `1`.
- **A row's clean-up removes the registry** with every other container of the run (`clearEarlierRows`), so the Dev
  Containers views of later rows list no container but their own. A row that needs the templates calls
  `runTemplatesReady()` (`windows/run-templates.ts`) first. It starts the registry again on the same port, which the
  index's ids name, and publishes the templates into it again from the run's cache, with no network.

Measured on CLI 0.89.0, on 2026-10-20:
- **Plain HTTP is used only for `localhost:<port>`.** `templates publish` to `127.0.0.1:<port>` fails with a TLS error
  (`wrong version number`), while the same registry as `localhost:<port>` works ("Sending as plain HTTP request"). So
  the templates name the registry that way and it needs no TLS.
- **`templates apply` and `templates metadata` have no `--log-format`.** `apply` prints one JSON line on stdout,
  `{"files":["./.devcontainer/devcontainer.json", …]}`, and its log as text on stderr. A missing template exits 1 with
  stdout empty. `metadata <id>` prints the template's metadata as JSON on stdout.
- `apply` leaves out `devcontainer-template.json`, `README.md` and `NOTES.md` by itself, and writes the optional files
  unless `--omit-paths` names them.
- **The published index** (`https://containers.dev/static/devcontainer-index.json`) is `{"collections":
  [{sourceInformation, features, templates}]}`, and each template's `id` is its full OCI reference.

## Cutting the host's network

`cutNetwork` and `restoreNetwork` of `tools/acceptance-network.ts` (each takes a command runner and the container id) make the host's network fail the way a lost network does. The host container runs with
`NET_ADMIN`, and the image has `iptables`: a cut inserts two rules inside the container, as root through `docker exec`,
that drop the packets of port 22 that arrive and those that leave, and a restore deletes them. An `ssh` session open
across the cut sees no reset and stalls until its own keep-alive gives up; a new connection is accepted by Docker's
port and then gets no answer (`Connection timed out during banner exchange`); after the restore the same local port
works again. Both are idempotent. A test that cuts restores in a `finally` or an `afterEach`; the container's removal
at the end of the run drops the rules too.

The mechanism was chosen by measurement. Cutting by `docker network disconnect` on a network of the run's own gave a
closed port (`Connection refused`) during the cut and a different published port after `docker network connect`, so it
was dropped. `docker pause` is no cut, since it freezes the server's processes as well.
`server/network-cut.test.ts` holds the rows that prove the capability.

## Cutting the route to the host

The network cut above never makes ssh's connect fail: Docker's published port on `127.0.0.1` accepts the TCP connect
for the container, so a cut host only ever times out in the banner exchange. The two reasons the specs ask for,
`ssh: connect to host … port …: No route to host` and `… Connection timed out`, need a connect that goes to the
host's own address.

The run has a Docker network of its own, `remote-oss-acceptance-<run id>` (`runNetworkOf`), labelled with the run.
`connectRunNetwork` of `tools/acceptance-run.ts` connects the host container to it, as well as to Docker's default
network, and gives its address there; the published port keeps working. The address is `HARNESS_ROUTED_ADDRESS` (and
`routedAddress` of the server fixture's host), and the run's ssh_config names it in the `routed` alias: the `harness`
account at that address, port 22, with no `ConnectTimeout`, so a connect that times out takes ssh's default. The
networks that a killed or cancelled run left are swept by the next run once they are older than two hours and hold no
container; a run's clean-up removes its own network, and a network that is left fails the run.

`cutRoute` and `restoreRoute` of `tools/acceptance-network.ts` (each takes a command runner, the container id and the
address) insert one
rule inside the container, scoped to that address, so Docker's published port is not touched:

| Cut | Rule | What `ssh routed` prints |
|---|---|---|
| `'unreachable'` | `iptables -I INPUT -d <address> -p tcp --dport 22 -j REJECT --reject-with icmp-host-unreachable` | `ssh: connect to host <address> port 22: No route to host` |
| `'silent'` | `iptables -I INPUT -d <address> -p tcp --dport 22 --syn -j DROP` | `ssh: connect to host <address> port 22: Connection timed out`, after the connect timeout |

proteus measured both in a room and on the CI runners ci-2, ci-6 and ci-7 (Docker 29, OpenSSH 10.2), and
`server/network-cut.test.ts` proves them in every run. Switching from one cut to the other leaves exactly one rule, and
both functions are idempotent. A test that cuts restores in a `finally` or an `afterEach`.

Which cut: the network cut above for a session that stalls once it is open (the connect works, the server never
answers, and a new connection times out in the banner exchange); a route cut for a connect that fails, which is what
F-2303 AC-17 (`No route to host`), F-2501 AC-18 and F-2601 AC-4 (`Connection timed out`) name.

## Host variants

The default host has the login shell BusyBox `sh` and BusyBox `wget`. One image carries every variant, and the variant
is chosen when the container starts, by an environment variable of `start-sshd`:

| Variable | Values | What `start-sshd` does |
|---|---|---|
| `HOST_FETCH` | `busybox-wget` (the default), `gnu-wget`, `curl`, `none` | removes the download tools the variant leaves out with `rm`, never `apk del` (which puts BusyBox's `wget` link back), and for `busybox-wget` links `/usr/bin/wget` to BusyBox |
| `HOST_SHELL` | `/bin/sh` (the default), `/bin/bash`, `/bin/zsh`, `/usr/bin/dash`, `/usr/bin/fish`, `/bin/tcsh`, `/bin/csh`, `/bin/mksh` | sets the login shell of the user `harness` with `usermod -s` |

`startHost({fetch, shell})` in `server/host-fixture.ts` starts a host with a variant of either kind. After `none` the host has neither `wget`
nor `curl` as the install script looks for them; `busybox wget` can still be called by that name.

`pnpm test:acceptance:variants` runs `server/fetch-tools.test.ts` once per download tool, each in its own mocha run on
its own host (`HARNESS_HOST_FETCH` picks the tool; unset, the file goes through all four). The rows serve the
stand-in archive from the host itself with BusyBox `nc`, so nothing leaves the machine; the client download of the
`none` variant reaches the same source through an `ssh -L` forward of the harness configuration. The rest of `server/`
runs once on the default host, in `pnpm test:acceptance:server`.

`pnpm test:acceptance:variants` also runs the login-shell files once per shell (`HARNESS_HOST_SHELL` picks the shell; unset,
all eight), each in its own mocha run on its own host: `server/login-shell-variant.test.ts` pins the shell the host
reports, and `server/login-shells.test.ts`, `server/start.test.ts` and `server/shared-session.test.ts` prove that every
session hands its commands to POSIX `sh` whatever the login shell is.

## Rows that fail in some runs

Each launch of a run starts with a line `acceptance: launch <label>`, so a run's log splits by launch.
`tools/flake-ledger.ts` reads the rows of the acceptance jobs from a run's job log, as `gh run view <id> --log` prints
it:

    node tools/flake-ledger.ts record <run id> <log file>   one run, into docs/qa/runs/<run id>.json
    node tools/flake-ledger.ts render                       docs/qa/flakes.md, from the recorded runs

A recorded run keeps its failed rows in full (title, launch, the first line of the failure) and a short key for each row
that passed. The folder keeps the newest 30 runs. The ledger lists each row that failed in a recorded run over its
latest 10 runs: those that failed and passed, and those that failed every time. A row that failed in two or more of
them is marked "(issue)". The recorded runs and the ledger are kept on the branch `qa/flakes`, updated after each
scheduled run, not on main.

## Download host

The VSCodium run starts a download host before the harness host, and stops it at the end of the run, also after a
failure (`tools/acceptance-downloads.ts`). The install rows fetch the server from it, or fail as the specs name. It is
one Node process with an HTTP and an HTTPS port, listening on `127.0.0.1` and on Docker's bridge gateway, and its
behaviour is chosen by the first segment of the path:

| Segment | Answer |
|---|---|
| `ok` | 200 with the server archive, `Content-Length` set |
| `missing` | 404, empty |
| `missing-cors` | 404, empty, with an `Access-Control-Allow-Origin: *` header |
| `busy` | 503, empty |
| `junk` | 200 with 64 KiB of random bytes |
| `hang` | the request is accepted and never answered, until `GET /control/drop-hung` or the run's end |
| `cut` | 200 with the archive's length, then the connection drops after 1 MiB |
| `slow` | the archive, 64 KiB every 100 ms |
| `templates` | `/templates/devcontainer-index.json`: the run's template index once the run has written it (404 before); `/templates/broken-index.json`: an index cut off so it doesn't parse; `/templates/unreachable`: the connection dropped before any answer |

The archive is the VSCodium server for Alpine of the release the client is pinned to, cached under
`.vscode-test/downloads/` and checked against its sha256 (`SERVER_ARCHIVE`). The HTTPS certificate is the run's own,
made in Node for `downloads` and `update.code.visualstudio.com` and kept in the run's folder; nothing trusts it. The
host's BusyBox `wget` verifies certificates through `ssl_client`, so an HTTPS download from it fails unless
`--no-check-certificate` is given (measured on the host's image).

The harness host reaches it by `--add-host downloads:host-gateway` and `--add-host
update.code.visualstudio.com:host-gateway`; the editor reaches it on `127.0.0.1`. The launches get
`HARNESS_DOWNLOADS_HTTP`, `HARNESS_DOWNLOADS_HTTPS` and `HARNESS_DOWNLOADS_LICENSED` (the update service's name), the
bases as the harness host sees them, `HARNESS_DOWNLOADS_LOCAL`, the editor's base, and `HARNESS_DOWNLOADS_LOG`, the
request log, one line per request: time, method, path and user agent, and `HARNESS_DOWNLOADS_TLS_LOG`, the file
`<run>/downloads-tls.log` with one line per TLS handshake that names a server: time and server name. `startHost({downloads: true})` gives a host of
the server suite the same names, and `server/downloads.test.ts` holds the rows that prove the capability.

## Genuine VS Code launch

The `genuine` launch starts VS Code at the floor of ADR-0007 (`EDITOR_VERSION`, downloaded under `.vscode-test/` on
first use) instead of the run's VSCodium, with the extensions installed in a folder of its own, `<run>/extensions-genuine`,
by VS Code's CLI. Two launch fields do it: `client: 'vscode'` names the editor, and `namedOnly: true` keeps the launch
out of a run that names no launches, so only `--launches genuine` makes it (it comes after every VSCodium launch, and only `ssh-no-proposals` comes after it). The launch
sets `REMOTE_OSS_ACCEPTANCE_SCRIPT` to the empty string, so the extension shows its real dialogs, which the rows read and
answer in the window (`waitForDialog`, `dialogKindOf`, `answerDialog`, `settingsEditorOf`); `localServerDownload` is off,
so a failed download on the host never falls back to a download on the runner. `HARNESS_EDITOR_EXECUTABLE` is the
executable the launch started, and `editorProduct()` reads the `product.json` beside it.

Nothing reaches Microsoft or GitHub from the rows, in two ways. The host's side is shown by the download host: it
answers for `update.code.visualstudio.com`, its request log shows what the host asked for, and its TLS log shows which
names. The client's own traffic (telemetry, the update check, the gallery, experiments, settings search and the
built-in chat) is not seen there, so the launch turns each off in its settings: `telemetry.telemetryLevel`,
`update.mode`, `extensions.autoCheckUpdates`, `extensions.autoUpdate`, `workbench.enableExperiments`,
`workbench.settings.enableNaturalLanguageSearch` and `chat.disableAIFeatures`. The row for an MIT release address (F-3902 AC-15) needs `github.com`
to reach the download host: as root on the harness host it adds `<gateway> github.com` to `/etc/hosts` (rewritten in
place, as the file is a bind mount) and a DNAT rule from port 443 of the gateway to the download host's HTTPS port, and
removes both in its `finally`. The container's removal at the end of the run is the backstop. If the `finally` failed, a launch after it in the same run (`ssh-no-proposals`) would run with `github.com` routed to the download host; its rows download nothing, so that changes nothing for them.

    node tools/acceptance.ts --editor vscodium --launches genuine

`ssh-no-proposals` is the same client and settings with the proposed API not enabled (`proposedApi: false`), for F-2001
§3.4's setup notice in the editor the family's users start from. It also comes last and only when named, after
`genuine`. The family's gate tells a profile once, and a "Not Now" keeps it silent until a probe passes. So in a run
that also makes the VSCodium `no-proposals` launch, whose rows dismiss the notice, this launch's rows find none and say
so. `genuine` before it clears the flag, because its probe passes:

    node tools/acceptance.ts --editor vscodium --launches genuine,ssh-no-proposals

## The host's other accounts (D-85)

Besides `harness`, the host image has thirteen users, and the run's `ssh_config` has an alias for each use of them. The
`Match User` blocks that give them their rules are at the end of `/etc/ssh/sshd_config`: Alpine includes
`sshd_config.d/` at the top of the file, where a `Match` would swallow every line after it.

| Alias | User | What it is for |
|---|---|---|
| `password` | `harness-pw` | login by password only (no public key); the password is the run's own, 24 letters and digits |
| `password-ask` | `harness-pw` | `password`, but its host key is asked against its own `known_hosts_password_ask`, which a test deletes to make the key unknown again |
| `noforward` | `harness-nofwd` | the run's key; sshd refuses TCP forwarding (`AllowTcpForwarding no`) |
| `i686` | `harness-i686` | the run's key; its `~/.profile` puts a folder first on `PATH` whose `uname -m` prints `i686` (the connect's shell is a login shell) |
| `readonly` | `harness-ro` | the run's key; its `.vscodium-server-insiders` and `bin` folders exist, are owned by root and cannot be written by the user |
| `mute` | `harness-mute` | the run's key; the login shell `/usr/local/bin/mute-shell` runs a command given with `-c` and otherwise never answers |
| `harness-fish` | `harness-fish` | the run's key; its login shell is `/usr/bin/fish` |
| `harness-bash` | `harness-bash` | the run's key; its login shell is `/bin/bash` |
| `harness-zsh` | `harness-zsh` | the run's key; its login shell is `/bin/zsh` |
| `harness-dash` | `harness-dash` | the run's key; its login shell is `/usr/local/bin/sh`, a link to dash |
| `harness-ksh` | `harness-ksh` | the run's key; its login shell is `/bin/ksh` |
| `harness-csh` | `harness-csh` | the run's key; its login shell is `/bin/csh` |
| `harness-tcsh` | `harness-tcsh` | the run's key; its login shell is `/bin/tcsh` |
| `master` | `harness-pw` | `password`, behind `ControlMaster auto` (socket `cm-%C` in the run's folder, `ControlPersist 600`) |
| `master-ask` | `harness-pw` | `password`, behind `ControlMaster ask` (socket `cm-ask-%C`) |
| `master-yes` | `harness-pw` | `password`, behind `ControlMaster yes` (socket `cm-yes-%C`) |
| `master-autoask` | `harness-pw` | `password`, behind `ControlMaster autoask` (socket `cm-autoask-%C`) |

The run's password is written to `<run folder>/host.env` (`HOST_PASSWORD=…`, mode 600), which `docker run` reads with
`--env-file`, so it never appears in a command line, and to `<run folder>/password` (the bare password, mode 600), whose
path is the harness variable `HARNESS_PASSWORD_FILE`. A test gives it to ssh through an `SSH_ASKPASS` script that prints
it (with `SSH_ASKPASS_REQUIRE=force`), or puts it in a script entry `{surface: 'maskedInput', match, answer: {text}}`,
and the record keeps `<supplied>`. Nothing prints it. `docker inspect` does show `HOST_PASSWORD` in the container's configuration (the env file becomes the container's environment); that is acceptable only because the password is a per-run fake that opens nothing but the run's own throw-away host (R-26). A `ControlPath` is `<run folder>/cm-%C`, about 75 characters on a
Linux runner, under the 108 of a socket path.

The VSCodium run also makes further keys in its folder (`tools/acceptance-keys.ts`), and the host takes them:

| File | What |
|---|---|
| `id_passphrase` | ed25519, comment `acceptance-passphrase`, protected by the run's passphrase. The passphrase is in `<run folder>/passphrase` (mode 600, the harness variable `HARNESS_PASSPHRASE_FILE`), and `<run folder>/askpass-passphrase` prints it for `SSH_ASKPASS`; `ssh-keygen` gets it the same way, so no command line holds it |
| `id_passphrase_stranger` | ed25519, comment `acceptance-stranger`, protected by the same passphrase; the host doesn't accept it |
| `id_second` | ed25519 without a passphrase |
| `id_loose` | a copy of `id_second` with mode 0644, which ssh refuses to use |
| `ca`, `id_certified`, `id_certified-cert.pub` | the run's own authority, and a key it signed for the principal `harness-cert` |

The host accepts `id_passphrase` and `id_second` for its key accounts (`AUTHORIZED_KEYS_FURTHER`), and the user
`harness-cert` accepts only a certificate of the run's authority (`TrustedUserCAKeys`, from `CA_PUBLIC_KEY`). Their
aliases leave the agent to the environment and set no `BatchMode`, so ssh may ask for a passphrase:

| Alias | User | Keys |
|---|---|---|
| `passkey` | `harness` | `id_passphrase` |
| `passkey-then-second` | `harness` | `id_passphrase`, then `id_second` |
| `loosekey` | `harness` | `id_loose` |
| `certonly` | `harness-cert` | `id_certified` and its certificate |
| `certonly-nocert` | `harness-cert` | `id_second`, without a certificate |

The run starts its own `ssh-agent` on `<run folder>/agent.sock` (or in a short folder under `/tmp` when that path
would pass a Unix socket's limit) before the editor and ends it with the run. Every
launch gets `SSH_AUTH_SOCK` and `HARNESS_AGENT_SOCKET` naming it. It starts empty, and it can't ask the user anything
(no askpass, no display), so a key added with confirmation can't be used.

`server/host-accounts.test.ts` shows each account does what it is for.
