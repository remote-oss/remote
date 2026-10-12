# Task card remote-ssh-08: the gate's published text and probe member (remote-ssh#88)

Why: remote-oss/remote-ssh#88 is answered, and F-2001 §3.4, F-2003 §3.4 and F-3903 rule 4 are republished. Two
things on main differ from them (checked 2026-10-12; listed on remote-oss/remote#140):

1. F-2001 §3.4: the failed-attempt notice names this extension's id **as a literal**, "not a placeholder":
   `… argv.json lists 'remote-oss.remote-ssh', then restart {1}.` Main has `lists '{2}'`.
2. F-3903 rule 4 (and contracts §3.4, 6c632c1): the `resolvers` probe reads **exactly `env.appCommit`**, and no other
   member. Main reads `env.remoteAuthority`.

F-2003 §3.4's log line (`Missing proposed APIs: {0}`, names in `enabledApiProposals` order) already matches main, so
nothing changes there. The other five notice texts already match F-2001 §3.4. Reviewing coder:
`remote-coding-worker-1`.

## 1. File boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/extension.ts` | `SETUP_TEXT_TEMPLATES.failedAttempt`: `'{2}'` becomes `'remote-oss.remote-ssh'` |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 `bundle.l10n.<locale>.json` | the old failed-attempt key and value are replaced by the new text, as key and as value, in every file |
| `packages/lib-authority/src/gate/probe.ts` | `ProbeApi.remoteAuthority` becomes `appCommit` (its JSDoc: "Guarded by `resolvers`: reading it throws without the grant."); `probeOne`'s `resolvers` case reads `editor.appCommit` |
| `packages/lib-authority/src/gate/vscode-api.ts` | the getter becomes `get appCommit() { return editor.env.appCommit; }` |
| `packages/lib-authority/test/unit/gate-probe.test.ts`, `gate-vscode-api.test.ts`, `gate-vscode-setup.test.ts` | the fakes and the expected reads name `appCommit` |
| `packages/remote-ssh/test/unit/strings.test.ts` | its listed failed-attempt key becomes the new text |

Nothing else. `setup-ports.ts` stays as it is: it still passes the extension id as the third value, and a template
with no `{2}` leaves it unused, so lib-authority needs no change for the text.

## 2. Contract

- The failed-attempt template is exactly
  `The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists 'remote-oss.remote-ssh', then restart {1}.`
  It is read through `vscode.l10n.t` with the template only, as the other five are.
- `ProbeApi` has `readonly appCommit: string | undefined;` in place of `remoteAuthority` (the type of
  `env.appCommit` in `packages/lib-authority/vscode-dts/vscode.proposed.resolvers.d.ts`, checked 2026-10-12).
- The probe reads only `appCommit` for `resolvers`. Its `granted` or `missing` result and every other proposal's
  probe are unchanged.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| F-3903 rule 4 | the `resolvers` probe over a fake editor whose `appCommit` reads fine | `granted`, and the fake's reads are `['appCommit']` |
| F-3903 rule 4 | the same with `appCommit` throwing | `missing` |
| F-3903 rule 4 | `probeApiOf(editor)` over a fake whose `env.appCommit` is `'abc'` | `appCommit` is `'abc'` |
| F-2001 §3.4 | the failed-attempt notice shown by `setupPortsOf` with the remote-ssh texts | contains `lists 'remote-oss.remote-ssh', then restart`, and no `{2}` |
| string tables | the bundles | `pnpm check-layout` green: the new key in all 15, the old one in none |

The existing rows that expected `remoteAuthority` reads now expect `appCommit` and pass.

## 4. Rule for the worker

As card log-01; coverage at both packages' 100/100/100 ratchets.

## 5. Gates and review

PR title `lib-authority, remote-ssh: the gate's published text and probe member (card remote-ssh-08, remote-ssh#88)`.

## 6. Open rows

None.
