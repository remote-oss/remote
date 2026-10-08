# lib-authority

The resolver plumbing for remote authorities: one codec per authority family, so the transport never parses an
authority string. Each codec decodes the payload after the core split the authority at the first `+`, encodes the
family's own form, and gives the label the resource label formatter uses.

## Contract

- `decodeAuthority(authority)` splits at the first `+` and hands the payload to the family's codec; an unknown or
  missing family is a `malformed` with reason `unknownFamily`.
- `ssh-remote` decodes three forms: a bare host name, the lower-case hex of a compact JSON `{hostName, user?,
  port?}`, or an alias; the `label` is `user@hostName:port` with the parts present.
- `wsl`, the five container families and `tunnel` carry an optional outer hop (`@<authority>`) decoded the same way;
  an outer that does not decode is a `malformed` with reason `badOuter`.
- `decode(encode(target))` returns `target` and `encode(decode(authority))` returns `authority` for every form a
  spec fixes.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-authority` (`src/index.ts`) |
| Allowed imports | `lib-identifiers`, `lib-standdown`, `lib-log` |
| Coverage exclusions | `src/codecs/types.ts`: types only, no executable code |
