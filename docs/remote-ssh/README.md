# Remote - SSH

Remote - SSH lets you open a folder on any machine you can reach over SSH and work on it as if it were on your own
disk. The editor's interface stays on your machine; the files, terminals, language servers and extensions that need to
run next to the code run on the host. Start with [Getting started](getting-started.md) if you have not connected yet.

## What you get

- A host list built from your SSH configuration, plus the ability to type any `user@host`.
- One shared connection per host, so a password or a host key is asked once however many windows you open.
- A progress notification while the window connects, and a clear dialog with a reason when it cannot.
- Prompts for host keys, passwords, passphrases and one-time codes, shown in the editor.
- The server that powers the remote window is downloaded and installed on the host for you, from a source you control.

## Requirements

**On your machine**

- An OpenSSH client. The extension uses the `ssh` it finds on your `PATH`, or the one named by `remote.SSH.path`. It
  checks that the program is OpenSSH before it connects; any recent version works.
- The editor you run supplies the rest. Extensions that provide the same remote connection cannot run alongside this
  one; if one is installed, Remote - SSH tells you and does not start.

**On the host**

- Linux with glibc 2.28 or newer on a 64-bit Intel/AMD, 64-bit ARM or 32-bit ARM processor, or Alpine Linux on a
  64-bit Intel/AMD or 64-bit ARM processor.
- `sh` and `tar`, and `wget` or `curl` to download the server. If the host cannot reach the internet, the extension
  downloads the server on your machine and copies it over (see `remote.SSH.localServerDownload`).
- Enough disk space in your home folder for the server and the extensions you install there, unless you move it with
  `remote.SSH.serverInstallPath`.

You do not install anything on the host yourself, and you do not need administrator rights.

## Commands

| Command | What it does |
|---|---|
| **Remote-SSH: Connect to Host...** | Pick a configured host or type `user@host[:port]`; opens a new window on that host with no folder. |
| **Remote-SSH: Connect Current Window to Host...** | The same picker, but the window you are in reloads connected to the host. What it showed before is closed. |
| **Remote-SSH: New Window on Active Host** | In a connected window, opens another window on the same host without asking again. |
| **Remote-SSH: Kill Local Connection Server For Host...** | Ends the shared connection to a host. Windows of that host reconnect, and ask for a password again where one is needed. |
| **Remote-SSH: Show Log** | Opens the *Remote - SSH* output channel. |
| **Remote-SSH: Help**, **Remote-SSH: Get Started with SSH**, **Remote-SSH: Provide Feedback**, **Remote-SSH: Settings**, **Remote-SSH: Report Issue...** | Open this guide, the getting-started page, the feedback page, the extension's settings and the issue reporter. |

The first three are also in the menu of the remote indicator at the left of the status bar.

## Settings

All of these are in the Settings editor under *Remote - SSH*. Those marked *application* are read only from your user
settings: a workspace cannot change them.

| Setting | Default | What it does |
|---|---|---|
| `remote.SSH.path` *(application)* | empty | Full path of the `ssh` program. Empty means the one on your `PATH`. |
| `remote.SSH.configFile` *(application)* | empty | One SSH configuration file to use instead of `~/.ssh/config` and the system file. When set, only its hosts are listed and `ssh` is told to read it. |
| `remote.SSH.useLocalServer` | on | Share one `ssh` connection per host between windows. Turn off to give each window its own connection. |
| `remote.SSH.remotePlatform` | none | Maps host names (`*` matches any run of characters) to `linux`, `macOS` or `windows`. With the shared connection off, the extension asks once for the platform of a host that has no entry and records the answer here. |
| `remote.SSH.connectTimeout` | 15 | Seconds to wait for an unreachable host before giving up. |
| `remote.SSH.logLevel` *(application)* | `debug` | `debug` or `trace`. `trace` also keeps all of `ssh`'s verbose output. |
| `remote.SSH.serverDownloadUrlTemplate` *(application)* | empty | Where to download the server from when your editor does not say. See [Where the server comes from](#where-the-server-comes-from). |
| `remote.SSH.localServerDownload` | `auto` | `auto`: the host downloads the server and, if that fails, your machine downloads it and copies it over. `always`: your machine downloads. `off`: only the host downloads. |
| `remote.SSH.serverInstallPath` | empty | Per host (a map from host name to an absolute folder): where the server is installed on that host instead of your home folder. Only letters, digits, `/`, `-`, `_`, `.` and spaces are allowed. |
| `remote.SSH.serverPickPortsFromRange` | empty | Per host: a range such as `8000-9000`; the server listens on the lowest free port in it instead of a random one. |
| `remote.SSH.bindHost` | `127.0.0.1` | Per host: the address the server listens on. |
| `remote.SSH.httpProxy`, `remote.SSH.httpsProxy` | empty | A proxy for the host's downloads. Either a text for all hosts, or a map from host name (or `*`) to a proxy address. |
| `remote.SSH.useCurlAndWgetConfigurationFiles` | off | Let `curl` and `wget` on the host read the user's own configuration files. |
| `remote.SSH.useFlock` | on | Take the install lock on the host with `flock` whenever the host has it; otherwise a hard link is used. |
| `remote.SSH.lockfilesInTmp` | off | Keep the install lock in `/tmp` instead of the server's folder; useful for home folders on a network file system. |
| `remote.SSH.enableRemoteCommand` *(application)* | off | Experimental: run a `RemoteCommand` from your SSH configuration. It applies only while the shared connection is on and the host has no `remote.SSH.remotePlatform` entry. |
| `remote.SSH.defaultExtensions` | empty | Extension identifiers to install on every host you connect to. |
| `remote.SSH.reconnectionGraceTime` | none | Seconds the server waits for a lost window to come back before it exits. |
| `remote.SSH.maxReconnectionAttempts` | none | How many times a window tries to reconnect after losing the connection; `0` turns reconnecting off. |

Everything else about how `ssh` behaves (`IdentityFile`, `ProxyJump`, `StrictHostKeyChecking`, `ControlMaster` and
the rest of your SSH configuration) is read by OpenSSH itself. If it works in your terminal, it works here.

## Prompts

When OpenSSH needs something from you, the editor shows the question and passes your answer to `ssh`. The extension
keeps none of it.

- **Unknown host.** A pick shows the host name and the key's fingerprint, with **Continue** and **Cancel**. Continue
  trusts the key and OpenSSH records it in your known-hosts file. If the host's key has changed since you last
  connected, there is no question: the connection stops and says so, because a changed key can mean someone is
  intercepting the connection.
- **Address mismatch.** If the host's name is known but its address now has a different key, OpenSSH warns and asks
  whether to continue; the editor shows the same choice.
- **Password or one-time code.** A box at the top of the window with the host's question. A wrong answer is asked
  again as many times as OpenSSH allows. Escape cancels.
- **Passphrase of a key.** A box asks for the passphrase when OpenSSH must unlock a key. Keys held by your SSH agent,
  keys without a passphrase and certificates connect without any question.

Because the connection is shared, these questions come once per host. A second window that starts connecting while the
first is still at a prompt shows *Waiting for other windows to connect*, and an answer in either window serves both.

## Where the server comes from

The window on the host is powered by a server that matches your editor build exactly. Where it is downloaded from
depends on the editor, in this order:

1. **`remote.SSH.serverDownloadUrlTemplate`**, when you set it in your user settings.
2. **The editor's own template**, when the editor names one for its server builds. VSCodium does.
3. **A built-in source** for VSCodium and VSCodium Insiders.
4. Otherwise nothing is downloaded, and the connection stops with a dialog that tells you to set the template.

A template is a URL with placeholders: `${os}` and `${arch}` (from the host), `${version}`, `${commit}`, `${quality}`
and `${release}` (from your editor). A value without placeholders is used as one address for every host. The server is
downloaded as one archive per host (`.tar.gz`, `.tgz` or `.zip`) and unpacked into `~/.<application>-server/bin/<commit>`.
An unknown placeholder, or a result that is not an `http:` or `https:` address, ends the connection with a message
that names the setting.

If the server carries a licence, you are asked to accept it before it is installed; **Cancel** ends the connection
and nothing is downloaded or started.

Later connections reuse the installed server and download nothing.

## When a connection fails

A failed connection shows one dialog, **Could not establish connection to "&lt;host&gt;"**, usually followed by a short
reason, with three buttons:

- **Retry** reloads the window and connects again.
- **More Actions...** (also Escape) opens a short list: reload the window, open recent folders, open this
  documentation, open your SSH configuration file, and open the extension's settings.
- **Close Remote** turns the window into an ordinary local one.

During an automatic reconnection after a dropped connection, no dialog appears. The editor keeps trying for failures
that can pass by themselves (an unreachable host, a timeout, a closed connection, a failed download or start), up to
`remote.SSH.maxReconnectionAttempts`. A failure that needs you (a refused login, a changed host key, an unsupported
host, an invalid setting) stops the reconnection at once, and the editor shows its own message that the remote is not
available.

Two failures use their own dialog instead: when the editor names no source for the server, or the download template
is invalid, the dialog offers **Open Setting**, which opens the Settings editor on the setting involved, and **Cancel**.

| What the dialog says, in short | What it usually means | What to do |
|---|---|---|
| An SSH installation could not be found | No OpenSSH client was found. | Install OpenSSH, or set `remote.SSH.path`. |
| Permission denied | The host refused your key or password. | Run `ssh <host>` in a terminal and fix the login there; check `IdentityFile` and your agent. The log lists key problems `ssh` reports. |
| The connection timed out | The host is unreachable or slow. | Check the address, your network or VPN, and raise `remote.SSH.connectTimeout`. |
| The host key has changed | The host's key differs from the one on record. | Confirm with the host's administrator, then remove the old line from your known-hosts file. |
| The host does not meet the prerequisites | The host's C library is too old. | Use a host with glibc 2.28 or newer, or Alpine on 64-bit Intel/AMD or ARM. |
| The host's architecture is not supported | No server build exists for the processor. | Use a supported host. |
| No download source for the server | Your editor names no server source. | Choose **Open Setting** and set `remote.SSH.serverDownloadUrlTemplate`. |
| The server template is invalid | An unknown placeholder or not an `http:`/`https:` address. | Choose **Open Setting** and correct the setting the message names. |
| Downloading the server failed | The host and, depending on `remote.SSH.localServerDownload`, your machine could not fetch it. | Check the template and the host's network; set a proxy; or choose `always`. |
| The server could not be installed or started | Disk full, a corrupt download, or an address or port the server cannot use. | Free space, check `remote.SSH.bindHost` and `remote.SSH.serverPickPortsFromRange`. |
| An invalid setting | A value this extension cannot use, such as an install folder with disallowed characters. | Correct the setting the message names. |
| The host's install lock stayed busy | Another window or connection kept installing or starting the server on the host. | Wait for it to finish and retry; if it stays busy, check the host for a stuck install. |
| Connection closed | The connection to the host ended while the window was setting up. | Check the network and the host, then retry. |
| Connecting was cancelled | You dismissed a question the connection was waiting for. | Connect again and answer it. |
| Anything else, or no reason at all | A failure with no message of its own. | Open **Remote-SSH: Show Log**; the attempt's record names what failed. |

## The log

**Remote-SSH: Show Log** opens the *Remote - SSH* output channel. It records your effective settings, the version of
the editor and the extension, how the `ssh` client was found, what `ssh` said, the questions asked (never the answers),
the server install and start output, and how the attempt ended. Set `remote.SSH.logLevel` to `trace` for more. When you
report a problem, attach the log; it holds no passwords.
