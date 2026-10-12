# Task card forwarding-06: two follow-ups of card forwarding-02 (rows 3 and 6, ruled on #269)

Base: main **after PR #269 (card forwarding-02) has merged**; if `packages/lib-forwarding/src/defaults/policy.ts` or
`environment.ts` is absent, stop and report. Ruled by the architect on #269 (2026-10-12; forwarding-02 §6 "Rulings",
rows 3 and 6). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-forwarding/src/defaults/policy.ts` | `shouldApplyDefaults` loses its `attempt` parameter |
| `packages/lib-forwarding/src/defaults/environment.ts` | the listen side's wildcard and empty binds |
| `packages/lib-forwarding/test/unit/defaults-policy.test.ts` | rewritten for the new signature (section 3) |
| `packages/lib-forwarding/test/unit/defaults-environment.test.ts` | rows added; one row moved (section 3) |

Nothing else may change. `shouldApplyDefaults` has no caller outside its own test on main (checked 2026-10-12), so no
other file needs the new signature. `src/index.ts` is unchanged (the export names stay).

## 2. Contract

```ts
export function shouldApplyDefaults(isReconnection: boolean): boolean;   // true exactly when not a reconnection
```

The JSDoc of `shouldApplyDefaults` stays as it is.

`environmentTunnels`, listen side only:

- A listen part whose text starts with `:` (an empty bind, for example `:13000`) is an address with host `''`; it is no
  longer `badShape`. The port after the colon is checked as today, so `:` alone or `:abc` is `badPort`.
- The local address's host is `localhost` when the listen part's host is `''` (no bind, or an empty bind),
  `localhost`, `*` or `0.0.0.0`: each of these means every interface or the loopback, and the editor reaches it on
  `localhost` (ruling 6). Any other bind is kept as written (`127.0.0.1`, `10.0.0.5`, a name).
- The target side is unchanged: a target must name a host, so `13000 :80` and `13000 80` stay `badShape`.

In `readPart` this is: the `colon === 0` check applies only when `hostRequired` is true (the target side), and the set
of local binds is one named constant of four entries. No other rule of forwarding-02 changes.

## 3. Test table

One assertion per `it`; the Cite starts the name.

`defaults-policy.test.ts` is rewritten. With `attempt` gone, the per-attempt loops of forwarding-02 would repeat the
same call; keep one `it` per distinct case, named by the rule it stands for:

| Cite | Given | Expected |
|---|---|---|
| F-2507.BR-4 | `shouldApplyDefaults(false)` (a first connection, a retry of it, or a connection after a reload) | `true` |
| F-2507.BR-5 | `shouldApplyDefaults(true)` (any attempt of a reconnection, F-2507.6.5, AC-33) | `false` |

`defaults-environment.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| F-2507.BR-10 (ruling 6) | `*:13000 h:80` | one tunnel, local `{host 'localhost', port 13000}`, remote `{host 'h', port 80}` |
| F-2507.BR-10 (ruling 6) | `:13000 h:80` | one tunnel, local `{host 'localhost', port 13000}`, remote `{host 'h', port 80}` |
| F-2507.BR-10 (ruling 6) | `0.0.0.0:13000 h:80` | one tunnel, local `{host 'localhost', port 13000}` |
| F-2507.BR-10 | `127.0.0.1:13000 h:80` | local `{host '127.0.0.1', port 13000}` (kept as written) |
| F-2507.BR-10 | `10.0.0.5:13000 h:80` | local `{host '10.0.0.5', port 13000}` (kept as written) |
| F-2507.BR-10 (ruling 6) | `: h:80` and `*: h:80` | `badPort` (one `it` each) |
| F-2507.BR-10 | `13000 :80` | `badShape` (unchanged: a target names a host) |

Move `':13000 h:80'` out of forwarding-02's `badShapes` list: it is now the second row above. Every other row of
forwarding-02 stays and passes unchanged.

## 4. Rule for the worker

As card log-01. Tests first; fix only what fails. Coverage of lib-forwarding stays at its 100/100/100 ratchet. Names
of four characters or more; no comment beyond the guide's; no duplicated code.

## 5. Gates and review

PR title `lib-forwarding: default-forward follow-ups (card forwarding-06, #269 rows 3 and 6)`; answers R1–R6.

## 6. Open rows

None. Checked on a prototype over #269's head (2026-10-12): the rows above pass, and the only rows of forwarding-02
that change are the `:13000` shape row and the policy rows that pass `attempt`.
