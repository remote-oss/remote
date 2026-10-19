# Task card server-22: a redirect rule from the resolution step, and `serverDownloadRedirectHosts` in product.json

Issue: #1036 (user priority: a Dev Containers connect fails with `redirected to <cdn>; retrying once` and nothing the
user can set gets past it). Size: M. Builder: `task:claude`. Design: athena's ruling on #1031, written into contracts
§5 V4 and ADR-0006 decision 7 (#1032, merged). Read both before starting. Server-23 (the netrc credentials) edits the
same download code and starts after this card merges.

## 1. The rule

Who chose the source decides which hosts a redirect may reach:

| Resolution step | Hosts the download may follow and end on |
|---|---|
| `override` | any host, over https |
| `productTemplate` | the template's own host, the hosts `product.json` lists in `serverDownloadRedirectHosts`, and `allowedRedirectHosts(templateHost)` from the table |
| `builtInTable` | the source host and `allowedRedirectHosts(sourceHost)`, as today |

No step may lower the scheme: a hop or a final address weaker than the source address's scheme (https to http) is
refused in every row. A source that is itself `http` stays allowed, as today (`Math.max(schemeStrength(source), 1)`).
No new setting, prompt or placement. Every extension through `lib-server` gets the rule.

## 2. The change

### 2.1 `lib-product`

`profile.ts`: `ProductProfile` gains `readonly serverDownloadRedirectHosts: readonly string[]`, empty when the
field is absent. `readProfile` reads it; a value that is not an array of strings is `unreadable` with the reason
`serverDownloadRedirectHosts is not a list of strings` (the form of the `serverLicense` check beside it). Entries are
kept as written.

`redirect-rule.ts` (new, exported from `index.ts`):

```ts
/** Which hosts a download may follow a redirect to: any host, or only the ones listed (lower case). */
export type RedirectRule =
  | {readonly kind: 'any'}
  | {readonly kind: 'hosts'; readonly hosts: readonly string[]};

/** Whether `rule` lets a download reach `host` (compared in lower case, exact; no wildcard, no port). */
export function redirectAllows(rule: RedirectRule, host: string): boolean;
```

`resolve.ts`: the `resolved` member of `ArchiveResolution` gains `readonly redirect: RedirectRule`, computed in
`resolvedAt` from the step, the profile and the address's host per the table above: `override` gives
`{kind: 'any'}`; the other two give `{kind: 'hosts', hosts}` with the lower-cased, de-duplicated list (the source
host first). An entry of `serverDownloadRedirectHosts` that is not a host name never matches; it is not an error.
`urlHost` and the licence classification are unchanged: they still read the template's host.

`product-table.ts` is unchanged; `allowedRedirectHosts` stays the table's reader and is called only from
`resolve.ts` after this card. Remove its import from `lib-server`.

### 2.2 `lib-server`

- `install/plan.ts`: `PlanInput.source.resolved` gains `redirect: RedirectRule`; the `download` plan carries it
  (`address` stays; the plan also has `redirect`).
- `transfer/ports.ts`: `DownloadRequest.allowedHosts` is replaced by `redirect: RedirectRule` (its comment: the hosts
  the download may be redirected through and end on; the library checks the final address again).
- `transfer/http-download.ts` (`finalResponse`): the host test is `redirectAllows(request.redirect, hostname)`. A
  hop whose scheme is weaker than the first address's is refused with the detail `redirected to <host> over http`
  (the comment "A redirect from https to http is not refused here" goes). Every other behaviour is unchanged.
- `transfer/transfer.ts`: `allowedHostsOf` is deleted. `isAllowedFinalHost(plan, finalAddress)` keeps the scheme
  test and replaces the host test with `redirectAllows(plan.redirect, finalHost)`; `fetchVerified` passes
  `redirect: input.plan.redirect`. The `allowedRedirectHosts` import goes.

### 2.3 Callers

`remote-containers/src/connect/server-steps.ts` (the `source:` of the plan input) and
`remote-ssh/src/pipeline/server-steps.ts` (`sourceOf`) pass `redirect: resolution.redirect`. Nothing else outside
`lib-product` reads the step or the table. Test fixtures that build a resolution, a profile or a plan gain the new
fields (the compiler lists them).

## 3. Rows

`lib-product/test/unit/profile.test.ts`: the field absent gives `[]`; a list is read as written; a non-list, and a
list with a non-string, are `unreadable` with the reason above.

`lib-product/test/unit/resolve.test.ts` (and `redirect-rule.test.ts`):

| Given | Expected `redirect` |
|---|---|
| an override | `{kind: 'any'}`, for the base-URL form and the template form |
| a product template on `dl.example.com`, `serverDownloadRedirectHosts: ['cdn.example.com', 'CDN.Example.com']` | hosts `['dl.example.com', 'cdn.example.com']` |
| a product template on `github.com`, no field | `github.com` and the two table hosts |
| a built-in table source | `github.com` and the two table hosts; the profile's field is ignored |
| `redirectAllows` | `any` allows every host; `hosts` matches exactly and ignoring case, and not a sub-domain or a parent |

`lib-server/test/unit/http-download.test.ts`: the existing allowed-host rows move to `redirect: {kind: 'hosts', …}`;
new rows: `any` follows a redirect to a foreign https host; a hop from https to http is refused with
`redirected to <host> over http`, also under `any`; an http source that redirects to another http host in the
list is followed.

`lib-server/test/unit/transfer.test.ts` (the transfer end to end with a fake download port): an `override` plan whose
download ends on a foreign https host succeeds; the same ending on http fails as `serverDownload` / `redirectHost`;
a `productTemplate` plan passes only on its listed hosts and fails on another; a `builtInTable` plan behaves as before
(the existing rows).

`remote-containers` and `remote-ssh` server-steps tests: the plan input handed to the planner carries the
resolution's `redirect` (one row each).

**Mutations** (list them in the PR): make `override` give `hosts` and the foreign-host row fails; drop the scheme
test of a hop and the http-hop row fails; give `productTemplate` the `any` rule and the unlisted-host row fails.

## 4. Gates and review

All gates with the changed files at 100 %; the containers and ssh launches that exist for the transfer need no new
row. PR title: `lib-server, lib-product: redirects follow the source's resolution step (card server-22, #1036)`.
Request athena only. Cite athena's ruling on #1031 in the PR's answer to R1.
