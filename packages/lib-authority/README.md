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
- `decode(encode(target))` returns `target` and `encode(decode(authority))` returns `authority` for every form the
  codec defines.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-authority` (`src/index.ts`) |
| Allowed imports | `lib-identifiers`, `lib-standdown`, `lib-log` |
| Coverage exclusions | `src/codecs/types.ts` and `src/connector/results.ts`: types only, no executable code |
