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

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-ssh` (`src/index.ts`) |
| Allowed imports | `node:path`; no library, no extension, no `vscode` |
| Coverage exclusions | none |
