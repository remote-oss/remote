# ADR-0013: Platform differences are data behind the existing seams, built and unit-tested on Linux before a host exists

- Status: accepted
- Date: 2026-11-02
- Deciders: the user (D-105: "lets not defer anything", with no Windows machine for now: build the Windows and macOS
  items, and test them on a real host once one exists); `remote-architect` for the design
- Scope: all packages
- Requirements: D-105, D-94, the 2026-10-12 runner ruling (Windows and macOS runners came with a later milestone),
  remote-oss/remote#200 (the PowerShell twin of the host scripts), ADR-0003 (tests for every branch), ADR-0010 (output
  read only through our markers), ADR-0004 (the native OpenSSH client)

## Context

Under D-105 nothing stays deferred, but the lab has no Windows machine and no macOS host, and the Mac runners stay off
pull request jobs (D-93). The Windows and macOS behaviour of the client and the host must still be built now, and
proven as far as a Linux machine can prove it.

Most of the seams exist:
- the client platform is a parameter, `ClientPlatform` in lib-ssh, read once from `process.platform` in each
  extension's composition root (`remote-ssh/src/extension.ts`);
- paths go through `path.win32` or `path.posix` by that parameter (lib-helper's instance folder, lib-ssh's client
  search);
- the host side runs scripts through lib-host's `HostChannel` with an `Interpreter` of `posixShell` or `powershell`,
  chosen from `platformHint()`.

Two Windows pieces are placeholders:
- lib-helper's endpoint refuses named pipes on `win32`;
- lib-server's bootstrap answers a PowerShell host with a fixed `ServerFailedToStart` until a twin exists (#200).

The Explorer has a second `ClientPlatform` of its own (`'windows' | 'other'`).

## Decision

1. **The platform is data, never read where it's used.** Every module whose behaviour differs by platform takes the
   client platform (`ClientPlatform`) or the host platform (`PlatformHint`) as a parameter.
   - Only a composition root reads `process.platform`, `os.platform()` or `os.homedir()`, and it passes them in.
   - The Explorer's own `ClientPlatform` goes. It imports lib-ssh's type, so there's one name for one thing.
2. **Each platform difference is a pure function of that parameter, with a unit row per platform.** The side effect
   stays in the one adapter that performs it. These are:
   - **paths:** `path.win32` or `path.posix`, drive letters, `~\` expansion, case-insensitive comparison on Windows;
   - **program search:** Program Files, Git for Windows, the bundled OpenSSH;
   - **process start:** the argument vector, the environment, an askpass wrapper (`.cmd` on Windows), `windowsHide`,
     and no shell;
   - **endpoint names:** a Unix socket path, or a `\\.\pipe\…` name;
   - **the agent's address:** `SSH_AUTH_SOCK`, or the named pipe `\\.\pipe\openssh-ssh-agent`;
   - **the login terminal's invocation and quoting.**

   ADR-0003's "tests for every branch" covers each branch, on Linux CI, with the platform as the row's input.
3. **Named pipes are built.** Node's `net` listens and connects on a pipe name exactly as on a socket path. So lib-helper's
   Windows endpoint becomes the same `net` code over the pipe name decision 2 gives, with no refusal left. Unit rows cover
   the name. The real pipe is proven on a Windows host (decision 6).
4. **The host scripts have one step table and two renderers (#200).** Each bootstrap step, with its result-block lines,
   is defined once.
   - `posixScript` renders it for `sh`, as today; the new `powershellScript` renders it for PowerShell.
   - Both end in the same result block (ADR-0010), so `parseResult`, the lifecycle and the channel don't branch beyond
     `interpreter`.
   - The twin targets **Windows PowerShell 5.1**, the shell OpenSSH for Windows starts, so it uses no syntax newer than
     5.1.
   - Its sources are the spec's Windows-host criteria, PowerShell's public documentation and OpenSSH for Windows'
     documentation, never the reference's scripts.
5. **The twin is proven on Linux with PowerShell 7 (`pwsh`, MIT), in three layers:**
   - **Syntax:** PSScriptAnalyzer (MIT) with `PSUseCompatibleSyntax` set to 5.1, a CI check like eslint's.
   - **Behaviour:** each step's script runs under `pwsh` with a stub module, loaded first, standing in for the
     Windows-only cmdlets and programs (`Get-CimInstance Win32_Process`, `tar.exe`, `Start-Process` and the service
     queries). It runs in a temporary folder as the home, and its result block is compared exactly as the POSIX rows
     compare theirs.
   - **Golden rows:** the rendered text of each step, so a renderer change is seen in review.
6. **What needs a real platform waits for its host, and says so.** A criterion only a real Windows or macOS client or
   host can show is `deferred` with a reason that begins `host: windows` or `host: macOS`. The catalogue allows a reason
   only on `core` and `deferred` lines. Under D-105 this is the one deferral that isn't a later increment: the code is
   built and its unit half is proven. The rows are written now and marked to their launch, so a host added later runs
   them with no new card.
   - **macOS clients:** the rows run on the Mac runners in the scheduled job (D-93 keeps those runners off pull
     requests, not off schedules).
   - **macOS and Windows hosts:** the rows run once the user provides a host.
7. **macOS hosts use the POSIX script, with BSD userland as data.** Where `stat`, `ps`, `sed -i`, `mktemp` or `getconf`
   differ, the script's functions detect the behaviour (a probe of the flag or form), not the name from `uname`. The
   detection is covered by a "BSD userland" fixture: stub commands with the documented BSD forms, first on the PATH in
   the Linux host container.

## Options considered

| Option | For | Against |
|---|---|---|
| Platform as data, pure functions, Linux-tested; real-host rows written and waiting (chosen) | Builds everything now; every branch has a row today; a host later runs prepared rows; matches the existing seams | A stub can be wrong about Windows; the first real run may still find gaps |
| Wait for hosts before building (the deferral D-105 removes) | Nothing built on assumptions | Contradicts D-105; Windows work piles up behind hardware |
| GitHub-hosted Windows runners now | Real Windows clients for free on a public repository | GitHub's machines (the user's call, not taken); no WSL2 (no nested virtualization); no Windows SSH host |
| One script language (PowerShell on every host via `pwsh`) | One renderer | Hosts don't have `pwsh`; a POSIX host needs `sh` only (F-2402) |

## Consequences

- **The Windows and macOS work is unblocked** by the user's decision:
  - the PowerShell twin (#200);
  - named pipes;
  - the Windows program search, path and quoting functions;
  - the agent's pipe.
- **Every platform branch must come with its row,** which the coverage gate enforces.
- **The first real Windows host is a measurement, not a rewrite.** Its findings are cards against named functions and
  stubs.
- **A `deferred` line in the coverage file has one of two kinds of reason:**
  - `host: …`, a host wait;
  - the name of a later increment.
  - D-105 leaves no permanent deferral.
- **CI gains `pwsh` and PSScriptAnalyzer** on the Linux runners. proteus installs and pins them.

## Check

- **A lint rule:** `process.platform`, `os.platform()` and `os.homedir()` are allowed only in the composition roots,
  listed by name.
- **CI:** the PSScriptAnalyzer 5.1 compatibility check over every rendered PowerShell step, and the `pwsh` behaviour
  rows in `pnpm test:unit`.
- **The coverage gate:** a `deferred` line for a host wait begins `host: windows` or `host: macOS`. Any other
  `deferred` line names an increment.
- **Design checks:** a platform branch with no row per platform is sent back.
