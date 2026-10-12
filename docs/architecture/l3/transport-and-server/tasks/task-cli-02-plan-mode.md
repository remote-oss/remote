# Task card cli-02: the CLI path's plan, pure (#412, brief-cli-path.md §2–§4)

Why: #412, card 2 of the CLI path (brief `brief-cli-path.md` §10). The plan decides the install mode once per connect:
**first the mode, then reuse within that mode** (§2, corrected on #422). Today `decideCliPath` checks reuse first
(`serverPresent`), and `plan` never calls it: it always plans a direct install and notes `useExecServerIgnored`. This
card gives the plan its `cli` kind, over today's fakes, with no I/O. Reviewing coder: `remote-coding-worker-1`.

**Merges only after step 0** (metis's revision of F-3902 rule 5 on `remote-oss/remote-ssh#79` and F-2103 BR-13 on
`#21`, brief §9). It can be built and reviewed before that.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-product/src/profile.ts` | `cliDownloadUrlTemplate` (section 2.1) |
| `packages/lib-server/src/cli-path/decision.ts` | `decideCliMode` in place of `decideCliPath` (section 2.2) |
| `packages/lib-server/src/cli-path/platforms.ts` | new: the CLI's platform constant (section 2.3) |
| `packages/lib-server/src/install/plan.ts` | the mode first; the `cli` kind; the reasoned note (section 2.4) |
| `packages/lib-server/src/index.ts` | the exports that change |
| `packages/lib-product/test/unit/profile.test.ts`, `packages/lib-server/test/unit/cli-path-decision.test.ts`, `plan.test.ts` | rows (section 3) |

Nothing in remote-ssh: its `server-steps.ts` keeps passing what it passes today, and `plan`'s new inputs are optional
(section 2.4), so the existing call compiles and plans a direct install. cli-04 wires the rest.

## 2. Contract

### 2.1 lib-product

`ProductProfile` gains `readonly cliDownloadUrlTemplate: string`, read like `serverDownloadUrlTemplate` (`STRING_FIELDS`;
absent gives `''`, a non-string is `unreadable`). `''` means "the editor names no CLI source" (§3: no table, no dialog,
no setting).

### 2.2 `decideCliMode` (replaces `decideCliPath`)

```ts
/** Why the direct install is used: the reasons rows 1–4 of the brief's §2 give. */
export type DirectReason =
  | 'settingOff'            // row 1: useExecServer falsy
  | 'manualBootstrap'       // row 1: localServerDownload is manual-bootstrap
  | 'noCliSource'           // row 2
  | 'noBuildForPlatform'    // row 3
  | 'termsToAccept';        // row 4

export interface CliModeInput {
  useExecServerSetting: boolean;
  manualBootstrap: boolean;
  /** The product's `cliDownloadUrlTemplate`; `''` when it names none. */
  cliTemplate: string;
  hostPlatform: {operatingSystem: string; architecture: string};
  /** Whether V6 classifies both the CLI source and the server source `free`. */
  sourcesFree: boolean;
}

export type CliMode = {kind: 'direct'; reason: DirectReason} | {kind: 'cli'};

/** The install mode of one connect, in the brief's §2 order; reuse is decided after it, within the mode. */
export function decideCliMode(input: CliModeInput): CliMode;
```

The rows in order: `!useExecServerSetting` → `settingOff`; `manualBootstrap` → `manualBootstrap`; `cliTemplate === ''`
→ `noCliSource`; a host platform not in `CLI_PLATFORMS` (section 2.3) → `noBuildForPlatform`; `!sourcesFree` →
`termsToAccept`; otherwise `cli`. There is no reuse input: the mode never depends on what is installed (§2, BR-7, BR-8).

`decideCliPath`, `CliPathInput` and `CliPathDecision` go (they are exported but have no caller outside their tests).
`cliArchiveTemplateVariables` stays.

### 2.3 `platforms.ts`

```ts
/** The `<os>-<arch>` tokens the editor's CLI is built for: every server platform except riscv64 and loong64. */
export const CLI_PLATFORMS: readonly string[];
```

Its value: `linux-x64`, `linux-arm64`, `linux-armhf`, `linux-ppc64le`, `linux-s390x`, `alpine-x64`, `alpine-arm64`,
`darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`. That is the `[cli]` build targets at `07f806f999…` (brief
§3; the user's build ships the five linux/alpine ones checked on #412). A host's token is
`<operatingSystem>-<architecture>` as `HostFacts` gives them.

### 2.4 `plan`

`PlanInput` gains two optional fields:

```ts
/** The mode inputs; absent means the direct install (every caller before cli-04). */
cliMode?: Omit<CliModeInput, 'hostPlatform'>;
/** Whether `<dataFolder>/<cliName>` already holds the CLI; only read in the CLI mode. */
cliPresentOnHost?: boolean;
/** The CLI's file name on the host, `<applicationName>-<commit>` (brief §3); required with `cliMode`. */
cliName?: string;
```

`Plan` gains a kind:

```ts
| {
    kind: 'cli';
    /** The CLI's place on the host: `<dataFolder>/<cliName>`. */
    cliPath: string;
    /** Its data folder: `<dataFolder>/cli`. */
    cliDataFolder: string;
    /** Whether the CLI archive must be transferred (false when it is already there). */
    download: boolean;
    where: 'host' | 'client';
    clientFallback: boolean;
    dataFolder: string;
    lockPlace: string;
    notes: readonly PlanNote[];
  }
```

`PlanNote` becomes `{kind: 'cliNotUsed'; reason: DirectReason}` for rows 2–4 only (`noCliSource`, `noBuildForPlatform`,
`termsToAccept`). Rows 1's reasons log nothing (§2's table). The old `'useExecServerIgnored'` string goes.

The order in `plan`, after the install path check (unchanged):
1. When `cliMode` is present, `mode = decideCliMode({...cliMode, hostPlatform: facts})`; otherwise `mode = {kind:
   'direct', reason: 'settingOff'}` (today's behaviour, no note).
2. **CLI mode:** return the `cli` plan. `download` is `!cliPresentOnHost`. `where` and `clientFallback` come from
   `placementOf(input.placement)` as for a server download. No reuse check, and `existingLayouts` is not read (§2: the CLI
   reuses its own server; the plan never touches `bin/`). `lockPlace` is today's. `notes` is `[]`.
3. **Direct mode:** today's plan exactly (reuse, then the source, then the download), with `notes` set to
   `[{kind: 'cliNotUsed', reason}]` when the reason is one of rows 2–4, else `[]`.

The CLI address isn't in the plan: cli-03 expands `cliDownloadUrlTemplate` with `cliArchiveTemplateVariables`.

## 3. Test table

One assertion per `it`; the cite starts the name.

`profile.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| brief §3 | a product.json with `cliDownloadUrlTemplate: "https://x/${version}/cli-${os}-${arch}.tar.gz"` | the profile's field is that text |
| brief §3 | none | `''` |
| brief §3 | `cliDownloadUrlTemplate: 3` | `unreadable`, `cliDownloadUrlTemplate is not a string` |

`cli-path-decision.test.ts` (the `decideCliPath` rows go; `decideCliMode`'s replace them):

| Cite | Given (a base input of setting on, no manual bootstrap, a template, `linux-x64`, sources free) | Expected |
|---|---|---|
| F-2103 BR-1 | setting off | `{kind: 'direct', reason: 'settingOff'}` |
| F-2103 BR-3 | manual bootstrap | `{kind: 'direct', reason: 'manualBootstrap'}` |
| brief §2 row 2 | `cliTemplate: ''` | `noCliSource` |
| brief §2 row 3 | `linux-riscv64` | `noBuildForPlatform` |
| brief §2 row 3 | `alpine-arm64` | `cli` |
| R-68, brief §5 | sources not free | `termsToAccept` |
| brief §2 | the base | `{kind: 'cli'}` |
| brief §2 order | setting off and no template | `settingOff` (row 1 before row 2) |
| brief §3 | `CLI_PLATFORMS` | the eleven tokens of section 2.3, in that order |

`plan.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| brief §2 | no `cliMode` (today's callers) | today's plans, unchanged (the existing rows pass) |
| brief §2 | `cliMode` giving `cli`, CLI absent | `{kind: 'cli', cliPath: '<home>/.data/<cliName>', cliDataFolder: '<home>/.data/cli', download: true, where: 'host', clientFallback: true, …, notes: []}` for an `auto` placement |
| F-2103 BR-8 | `cliMode` giving `cli`, and a `bin` layout of the commit in `existingLayouts` | still the `cli` plan (reuse is the CLI's, not the plan's; BR-7) |
| brief §4 | `cli`, CLI present | `download: false` |
| brief §4 | `cli`, placement `always` | `where: 'client'`, `clientFallback: false` |
| brief §2 row 2 | `cliMode` with `cliTemplate: ''` | a direct plan with `notes: [{kind: 'cliNotUsed', reason: 'noCliSource'}]` |
| brief §2 row 1 | `cliMode` with the setting off | a direct plan with `notes: []` |
| brief §2 | `cliMode` giving `cli` and an invalid install path | the install path's failure (it is checked first, as today) |

## 4. Rule for the worker

As card log-01; coverage at lib-product's and lib-server's 100/100/100 ratchets. The `useExecServerIgnored` note's
consumers in remote-ssh (`grep -rn useExecServerIgnored packages`) are updated to the new note shape in the same PR if
any read it; otherwise only lib-server changes.

## 5. Gates and review

PR title `lib-product, lib-server: the CLI path's plan (card cli-02, #412)`.

## 6. Open rows

None. The brief (§2–§4) and V7a (#422) decide it. Merging waits for step 0.
