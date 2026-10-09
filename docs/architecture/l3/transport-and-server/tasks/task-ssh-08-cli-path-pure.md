# Task card ssh-08: the editor-CLI path's pure parts (D-76, #124; built now, wired later)

Contract: ADR-0005 decision 2a, ADR-0006 ("Facts from the VSCodium CLI patch"), contracts §5 V3 (planner) and V1.
Depends on lib-product and lib-server on main. Reviewing coder: `remote-coding-worker-1`. Lower priority than the
connect-flow cards.

## 1. File boundary

`packages/lib-server/src/cli-path/decision.ts`, `src/cli-path/cli-output.ts`, `src/index.ts` (exports only), tests
`test/unit/cli-path-decision.test.ts`, `test/unit/cli-output.test.ts`. Pure; the download itself reuses lib-product's
resolver with the CLI template (no new network code).

## 2. Contract

```ts
export interface CliPathInput {
  productCliTemplate: string | undefined;        // product.json cliDownloadUrlTemplate
  hostPlatform: { operatingSystem: string; architecture: string };   // os token linux|alpine|darwin|win32; arch x64|arm64|armhf
  cliBuildsAvailable: readonly string[];          // `${os}-${arch}` tokens the product publishes CLI archives for (from the product table)
  useExecServerSetting: boolean;                  // remote.SSH.useExecServer
  cliPresentOnHost: boolean;                      // the probe found `<tunnelApplicationName>` in the data folder
  serverPresentOnHost: boolean;                   // a reusable server layout exists (V3 reuse)
}
export type CliPathDecision =
  | { kind: 'bootstrap'; reason: 'noTemplate' | 'noBuildForPlatform' | 'settingOff' | 'serverPresent' }
  | { kind: 'cli'; download: boolean };           // download = CLI not yet on the host
export function decideCliPath(input: CliPathInput): CliPathDecision;
// order: serverPresent → bootstrap(serverPresent) [reuse wins]; !useExecServerSetting → bootstrap(settingOff); no template → bootstrap(noTemplate); platform token not in builds → bootstrap(noBuildForPlatform); else cli with download = !cliPresentOnHost
export function cliArchiveTemplateVariables(profile: { commit: string; quality: string; version: string }, host: { operatingSystem: string; architecture: string }): Record<string, string>;
// {os, arch, commit, quality, version, release: version}  (VSCodium: release = version; ADR-0006 facts)
export type CliServeError = { kind: 'download'; url: string; status: number } | { kind: 'template'; message: string } | { kind: 'commitMismatch'; message: string } | { kind: 'other'; message: string };
export function parseCliServeError(message: string): CliServeError;
// loose matching (ADR-0006): `url: "<url>"` and `status_code: <n>` present → download; starts with or contains `cannot expand ` → template; contains `the download is not commit` → commitMismatch; else other with the whole message
```

## 3. Test table

| Given | Expected |
|---|---|
| serverPresent true, everything else favourable | bootstrap `serverPresent` |
| setting off, template present, build available | bootstrap `settingOff` |
| setting on, no template | bootstrap `noTemplate` |
| template present, platform `alpine-armhf` not in builds `['linux-x64','alpine-x64','alpine-arm64','linux-armhf']` | bootstrap `noBuildForPlatform` |
| template, build available, cli absent | cli, download true |
| template, build available, cli present | cli, download false |
| `cliArchiveTemplateVariables({commit:'abc', quality:'stable', version:'1.135.06055'}, {linux, x64})` | `{os:'linux', arch:'x64', commit:'abc', quality:'stable', version:'1.135.06055', release:'1.135.06055'}` |
| `parseCliServeError('StatusError(StatusError { url: "https://x/y.tar.gz", status_code: 404, body: "Not Found" })')` | download, url `https://x/y.tar.gz`, status 404 |
| `'WrappedError(WrappedError { message: "cannot expand ${release} for commit abc in the download url template", original: "..." })'` | template, message containing `cannot expand ${release}` |
| `'... the download is not commit abc ...'` | commitMismatch |
| `'something else entirely'` | other with the whole message |
| a message with `url:` but no `status_code:` | other (both needed) |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: editor-CLI path decisions and output parsing (card ssh-08)`.

## 6. Open rows

None expected. The wiring (running the CLI through S10, the command-shell protocol, F-2103's flow) is the Claude part
of #124, gated on the VSCodium release.
