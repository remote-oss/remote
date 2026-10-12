# Coding brief: Remote - SSH window surfaces (#141)

> Issued by `athena` 2026-10-12 for daedalus, who turns it into cards. Component: `ssh.window-surfaces`
> (`components.md`), owning remote-oss/remote-ssh F-2502 (#60), F-2504 (#62) and F-2509 (#67). Contracts: §1
> (identifiers), §3.1 (codecs), §3.2 (resolver host) and the label formatter row of `brief-lib-authority.md`; area A's
> `serverPort` (`l3/transport-and-server/contracts.md`, F-2509 option (a), ruled 2026-10-06). Binding: ADR-0003, 0007,
> 0008; R-29 (ids, not English, in pure models), R-32 (`env.uriScheme`), R-46 (out-of-context commands), D-14/D-74.

## What is already done, and what is not this brief

- Built: `remote-ssh/src/window/host-label.ts` (card remote-ssh-03): F-2502 BR-3 for the decoded (hex) forms.
- Built: `lib-authority/src/labels/formatter.ts` `registerAuthorityLabel(host, decoded, suffix)`: the runtime formatter's
  authority (`ssh-remote+<raw host string>`) and fields as F-2502 BR-2 states them, behind a `LabelFormatterHost` port.
  Nothing calls it yet.
- Built: the static formatter, the two `statusBar/remoteIndicator` entries (F-2301/F-2302's commands), the
  `opensshremotes.openWebUI` palette entry and `onUri` in the manifest.
- Not this brief: the failure dialog (`ssh.failure-ui`, #275, merged) and the resolver front and connector (#140).
  #141's three old branches are material only; nothing is revived.

## The finding that comes first: the host label of a plain authority is wrong

`hostLabel` returns a `plain` target's text unchanged, but lib-authority's codec decodes every non-hex payload as
`{kind: 'plain', text}`. F-2502 BR-3 (observed, R2-l) shows `ssh-remote+my-alias:22` as `SSH: my-alias`; the code
gives `my-alias:22`. The same holds for `u@192.0.2.10:2222` (spec: `192.0.2.10:2222`) and `u@my-alias` (spec:
`my-alias`). This breaks F-2502 AC-14 and AC-15. Fix (card A below): a `plain` text is parsed with
`connect/typed-input.ts`'s `parseTypedHost` (the same `user@host:port` grammar the picker uses), then BR-3's rule is
applied to the parsed host. One rule for both forms; nothing new is invented.

## Pure parts (local-coder cards; no `vscode` import)

| Card | Module | Contract | Spec |
|---|---|---|---|
| A (amends remote-ssh-03) | `window/host-label.ts` | `hostLabel(target)`: for `plain`, `parseTypedHost(text)` first; then for every form: the host without user, `:<port>` only after an IP literal (one pair of brackets stripped). Test rows: every row of BR-3's table, plus `my-alias:22` → `my-alias`, `u@192.0.2.10` → `192.0.2.10`, `u@192.0.2.10:2222` → `192.0.2.10:2222`, `u@my-alias:2200` → `my-alias` | F-2502 BR-3, AC-14, AC-15, AC-35 |
| B | `window/label-suffix.ts` | `workspaceSuffixOf(target): StringRef` → `{id: <SSH prefix id>, values: [hostLabel(target)]}`. The `SSH: {0}` text is a new string-table entry ruled below; the pure model carries the id (R-29). `shouldRegisterLabel(outcome)`: true only for a resolve whose connection is up, false for a failed one | F-2502 BR-2, BR-3, AC-17, AC-34 |
| C | `window/web-ui.ts` | `webUiUrl(port: number \| 'none'): string \| undefined` (lib-server's `serverPort` result as is) → `http://localhost:<port>/`, or nothing for `'none'` (socket mode, local window, no server: AC-19; a new port after a reconnection: AC-20) | F-2509 BR-5, AC-19, AC-20 |

## Adapter parts (Claude cards; one `vscode` file each)

| Card | Where | What |
|---|---|---|
| D | `remote-ssh/src/surfaces/label-formatter.ts` | On the resolver host's "connected" outcome, call lib-authority's `registerAuthorityLabel` with card B's suffix resolved through the string table; keep the disposable for the window's life; never on a failure. `registerResourceLabelFormatter` is the proposed `resolvers` API: when the gate found it missing, nothing is registered and only the static "[SSH]" shows (F-2502 §16) |
| E | `remote-ssh/src/surfaces/web-ui-command.ts` | `opensshremotes.openWebUI`: reads area A's `serverPort` of the current connection, `env.openExternal(webUiUrl(port))` when there is a URL; resolves with no value and never rejects; ignores its arguments; out of context it follows the package's R-46 policy (F-2509 BR-6, BR-8, AC-13) |
| F | activation | registers E's command from the generated table, and D's subscription to the resolver host, after the gate (card remote-ssh-06's order) |

F-2504 needs no new code beyond what exists: `onUri` stays declared, no URI handler is registered (Q1 option (a),
ruled below), and the resolver already accepts every authority form core hands it (F-2504 BR-6, the codec of #171).
Its acceptance rows (AC-1 to AC-4, AC-24, AC-31, AC-32) go to the slice's acceptance tests, not to a unit card.

## Rulings in this brief

1. **F-2502 Q1: option (A), BR-3 as written** for the forms the lab could not open (`u@my-alias[:port]`, host names
   with a port): no user, a port only after an IP literal. It is the observed rule, and card A applies it uniformly.
   IPv6 keeps the interim of remote-ssh-03 (brackets stripped) until the spec answers.
2. **The `SSH: ` prefix is a string-table entry of our own** (F-2502 gives it no STR id): key `SSH: {0}`, English
   text `SSH: {0}`, in all 15 l10n bundles, reached through `vscode.l10n.t` like the gate's texts. "SSH" is the
   protocol's name, not process wording.
3. **F-2504 Q1: option (a)**, `onUri` declared and no handler registered. A handler that ignores URIs adds code with no
   behaviour, and our own URI shapes (option (c)) would be a feature beyond the spec (R-60).
4. **F-2509 Q1: option (a), reproduce**, as the components already say; the port is area A's `serverPort`, which
   answers `none` while no server runs, so during a reconnection the command opens nothing and follows R-46 (allowed
   by AC-13; the reference's reuse of the last port is reference data, not a requirement).
5. **The `openWebUI` manifest entry** keeps `&& !opensshremotes.standingDown` after AC-1's clause: the stand-down
   gating (R-77) applies to every contributed entry, and AC-1's literal is the reference's clause before the family
   rule. The nls key stays the generator's; AC-1 checks the clause and placement, not the key's spelling.

## Contract fixes made with this brief

- `contracts.md` §3.1, the `label` row: `Codec.label` is the picker's `user@host:port` (#171); the window's host label
  is remote-ssh's `hostLabel` (card A). The row is corrected in the same commit.

## Acceptance (slice tests, not unit cards)

F-2502 AC-1, AC-2, AC-14, AC-15, AC-17, AC-34 in the harness (title and indicator text after a resolve, "[SSH]" after a
failed one); F-2509 AC-1, AC-13, AC-19, AC-20 (the URL from a known port, nothing in socket mode); F-2504 AC-1 to
AC-4 and AC-31, AC-32 (silence on URIs, no "required extension" notice).

## Order

A first (it fixes shipped code and unblocks B), then B and C (local coders, independent), then D, E and F (Claude).
