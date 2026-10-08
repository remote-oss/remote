# lib-ssh

The decisions behind every connection through the platform's own OpenSSH client: which checks a target passes, which
arguments each `ssh` and `scp` run gets, what the SSH configuration files hold, and what ssh's error output and
questions mean. Nothing here starts a process or touches the editor; the callers run the programs and show the
results. It is bundled into the extensions that use it and never published on its own.

## Contract

- `validateTarget(target)` refuses a host or user that starts with `-` or holds a character ssh would misread, and
  names the character.
- `buildInvocation(request)` gives the program, the arguments and the added environment of one run: a connection,
  a tunnel, a one-shot command or a file copy. Arguments are never quoted for a shell; the only options added are
  the configuration file, the connect timeout when the host sets none, the terminal and verbosity flags, the
  forwards, and `RemoteCommand=none` when the host's command must not run. `buildOptionsQuery(request)` gives the
  `ssh -G` run, and `parseEffectiveOptions(text)` reads what it prints.
- `filesInEffect(configFile, locations, reader)` lists the configuration files in the order ssh reads them;
  `listHosts(configFile, locations, reader)` reads them fresh on every call and returns the host entries, or the
  file and reason of a parse error.
- `parseAddHostCommand(command)` turns a typed `ssh` command into a Host block; `writeHostBlock(fileText, block)`
  places that block in a file's text.
- `classify(errorLines, exitStatus, purpose, mode)` maps one failed run to a failure kind, the reason shown to the
  user and the hints kept for the session; `logLinesOf(errorLines)` keeps the lines worth logging, and
  `endWithFullStop(text)` finishes a reason for the dialog.
- `classifyPrompt(text, displayHost)` turns a question ssh asks into a fingerprint pick, a continuation pick or a
  masked input, with its title or placeholder.
- `candidates(setting, PATH, platform)` lists the `ssh` programs to try, `judge(exitStatus, output)` accepts or
  rejects one by its `-V` banner, and `scpProgram(accepted, platform)` names the `scp` that goes with it. Nothing is
  remembered between lookups.

Failures are values; no operation throws.

## The process side

`src/process/` starts the client and watches the connection:

- `spawnSession` starts an invocation as one program with its arguments, never through a shell, with the editor's own
  environment, then the invocation's added variables, then the askpass variables. `SSH_ASKPASS_REQUIRE` is never
  set. It yields a session with output, error and input streams and the exit status, or a failure as a value:
  `clientVanished` when the program is gone or not executable, `spawnFailed` for any other start error.
- `ConnectWait` is the wait for the connection to be set up: the connect timeout plus 2 seconds, paused while a prompt
  is open, started over after each answer, stopped at the first setup report. With a connect timeout of 0 the wait is
  exactly the unbounded limit the caller passes in, with no margin.
- `nodeProcessSpawner` is the process port on Node.js; tests use a recording port.
- `SshHostChannel` is the host channel of `lib-host` over `ssh` and `scp`, and passes lib-host's contract suite.
  `runScript` runs `sh` on the host: a script without input travels on the input of `sh -s`, and a script with input
  as the one quoted argument of `sh -c`, so that the input has the standard input to itself. The PowerShell
  interpreter is refused until it has been run on a Windows host. `copyToHost` runs `scp`. Failures are values of
  lib-host's closed set, with the client's message as detail: status 255 is `channelClosed`, a missing `scp` is
  `copyToolMissing`, a failed copy is `copyFailed`, and a run that is cancelled or out of time is killed.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-ssh` (`src/index.ts`) |
| Allowed imports | `node:path`; in `src/process/`, `node:child_process`, `node:fs`, `lib-host` and `lib-helper` (types and its test clock); no extension, no `vscode` |
| Coverage exclusions | `src/process/ports.ts`: it declares types only, and nothing in it runs |
