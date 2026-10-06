# ADR-0004: The SSH transport is the native OpenSSH client, never a JavaScript SSH library

- Status: accepted (the user, 2026-10-05, stated directly to the lead; to be logged in the register)
- Date: 2026-10-05
- Deciders: the user; design by `remote-architect`
- Scope: every package that opens an SSH connection: Remote-SSH, WSL over SSH, Dev Containers on a remote host,
  and the shared SSH library the container view defines
- Requirements: ADR-0002 rule 8 (no native Node modules); the Remote-SSH specifications when they are read

## Context

Four extensions reach hosts over SSH. Two ways exist to do that from an extension host: spawn the system's `ssh`
program, or embed an SSH implementation written in JavaScript (the `ssh2` family). The user rules out the library.

## Decision

1. All SSH connections, port forwards, remote commands and file transfers go through the OpenSSH client installed
   on the user's machine (`ssh`, and where needed `scp`/`sftp`), spawned as a child process. No package depends on
   `ssh2` or any other JavaScript or native SSH implementation.
2. The client's own configuration is the user's configuration: `~/.ssh/config` and the file the `remote.SSH.configFile`
   setting names (D-14) are read by `ssh` itself; the extension parses the config only for what the UI needs (host
   lists, the file to edit) and never to reimplement option semantics. Agents, keys, certificates, jump hosts,
   `Include`, `Match` and `ProxyCommand` work because `ssh` handles them.
3. Authentication prompts (passwords, passphrases, host-key confirmation, second factors) are relayed between `ssh`
   and the editor's UI; how, and with which `SSH_ASKPASS` or terminal arrangement per platform, is the shared SSH
   library's design (component view) and follows the Remote-SSH specifications.
4. Windows uses the OpenSSH client that ships with Windows or the one the user configures (`remote.SSH.path`, if the
   specs carry it); the design states the minimum OpenSSH version each feature needs and what happens below it.

## Options considered

| Option | For | Against |
|---|---|---|
| Native OpenSSH client (chosen, the user's constraint) | Every authentication method, agent, hardware key and config directive the user already has works unchanged; no native module, one VSIX for all platforms; security fixes arrive with the OS | A child process per connection; prompt relay and process lifetime need careful design; behaviour differs slightly across OpenSSH versions |
| `ssh2` (pure JavaScript) | In-process control of the session, uniform behaviour | Reimplements the config semantics, agents and key formats, lags OpenSSH on algorithms and features; ruled out by the user |
| Both, selectable | Flexibility | Two code paths to keep conformant; ruled out with the above |

## Consequences

- The shared SSH library is a process manager and a protocol-free relay, not a protocol implementation: spawn,
  control sockets (`ControlMaster`) for connection reuse where the platform allows it, forwarding with `-L`/`-R`, remote
  commands, exit codes, stderr parsing for the states the specs name.
- Conformance cases that exercise authentication run against real `sshd` targets, as the test kit's `sshtarget`
  fixtures already do.
- A later idea to embed a library for a platform without OpenSSH is a new ADR to the user, not a fallback.

## Check

`check-licences` and `knip` show no `ssh2`, `node-ssh`, `ssh2-sftp-client` or similar dependency in any package
(a denylist in the licence script); review of the SSH library's component view against this ADR.
