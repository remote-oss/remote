# lib-authority

The resolver plumbing for remote authorities: one codec per authority family, so the transport never parses an
authority string. Each codec decodes the payload after the core split the authority at the first `+`, encodes the
family's own form, and gives the label the resource label formatter uses.

## Contract

- `decodeAuthority(authority)` splits at the first `+` and hands the payload to the family's codec; an unknown or
  missing family is a `malformed` with reason `unknownFamily`.
- `ssh-remote` decodes two forms: a plain host string taken as written, or the lower-case hex of a compact JSON
  `{hostName, user?, port?}`; a plain text may turn out to be a configured alias, but that is decided later by the
  config model, not by the codec; the `label` is `user@hostName:port` with the parts present.
- `wsl` and the five container families carry an optional outer hop (`@<authority>`) decoded the same way; an outer
  that does not decode is a `malformed` with reason `badOuter`. `tunnel` carries an optional distro after `/`
  instead; an empty tunnel name is a `malformed` with reason `empty`.
- `Connected` and `Failed` are what a connect hands back. The host reads their structured fields (`retryable`, `silent`,
  `userAlreadyNotified`, `reason`, `hints`, `diagnostics`) and never a kind, which is a string each extension narrows
  to its own list. The tunnel pieces of `Connected` are type parameters, so the package needs no editor types.
- `probeProposals(editor, request)` asks the editor, for each proposed API the extension declares, whether it is granted:
  it reads a member the editor guards with the proposal and sees whether it throws, so no state is written and nothing
  is remembered between two probes. `contribViewsRemote` is read from the focus commands of the extension's remote
  views; `contribRemoteHelp` and `extensionsAny` cannot be probed. `probeApiOf(vscode)` gives the editor's API the
  narrow shape the probes read.
- `runSetup(ports, activationTime)` is the gate's whole flow behind ports: it probes, decides (the pure `decide`), takes
  the window's one notification for the family only when it has something to tell, and carries the user through the
  setup notice, the edit of the runtime arguments, the restart offer and the failed-attempt notice. It returns at once
  with the decision and an `interaction` that never rejects (a failing port is logged once and ends it) and that the activation does not wait for. An extension the runtime arguments already
  list offers only the restart. The dismissal and pending-attempt flags are written only when they change, and a probe
  that succeeds deletes them.
- `windowClaimOf(host, subscriptions)` is the claim on the window's notification: the extension that registers the
  claim command holds the window, the others ask it who that is, and a holder that went away is replaced once.
- `registerAuthorityLabel(host, decoded, suffix)` registers the resource label formatter of a window's authority: the
  remote scheme, the authority exactly as the window carries it, paths written with `/` and `~` for the home folder,
  and `suffix` after workspace names. The family composes the suffix from its own host label and string table.
- `decode(encode(target))` returns `target` and `encode(decode(authority))` returns `authority` for every form the
  codec defines.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-authority` (`src/index.ts`) |
| Allowed imports | `lib-identifiers`, `lib-standdown`, `lib-log`; the `vscode` module for types only |
| Editor declarations | `vscode-dts/` holds the editor's declaration files for the proposals the family uses (`resolvers`, `tunnels`, `contribViewsRemote`, `contribRemoteHelp`, `extensionsAny`, `terminalDataWriteEvent`), exactly as published for the supported editor floor (1.139.1), so the package compiles against the editor it supports. They are not linted or formatted. |
| Coverage exclusions | `src/codecs/types.ts` and `src/connector/results.ts`: types only, no executable code |
