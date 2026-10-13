# Task card tooling-12: the acceptance harness runs in a pinned VSCodium, in a local and a remote window

Why: #140 part F, the end-to-end connect. #253 Q14 ruled it runs in VSCodium (R-68, D-82: the gate never accepts
Microsoft's licence for the user). The part F brief and athena's six rulings are on #253. VSCodium's stable release is
1.135, below our floor (`engines.vscode ^1.139.0`, ADR-0007). **VSCodium Insiders `1.140.06829-insider`** loads the
extension: checked 2026-10-12 with our VSIX under xvfb, remote-ssh activated and registered `opensshremotes.showDetails`
and `opensshremotes.openWebUI`. It also ships the Alpine server the harness host needs. This card makes the editor a
parameter of the harness and adds the two VSCodium launches the connect suite needs. Reviewing coder:
`remote-coding-worker-1` (repository-wide tooling: daedalus design-checks).

## 1. File boundary

| File | Change |
|---|---|
| `tools/acceptance.ts` | the editor choice, the pinned VSCodium download, the two VSCodium configurations (section 2) |
| `tools/acceptance.test.ts` | rows (section 3.1) |
| `tests/acceptance/vscode-test.mjs` | exports the configurations for the run's editor (section 2.3) |
| `tests/acceptance/runner-remote/package.json` | new: the remote-side runner extension (section 2.4) |
| `tests/acceptance/suite-local/`, `tests/acceptance/suite-remote/` | new folders; the bundling covers them (section 2.5) |
| `tests/acceptance/suite-remote/remote-window.test.ts` | new: the first row, ruling 3 (section 3.2) |
| `package.json` | the script `test:acceptance:vscodium` (section 2.6) |
| `.github/workflows/ci.yml` | the opt-in job (section 2.6) |
| `tests/acceptance/README.md` | a section on the VSCodium run |

The existing VS Code run (`pnpm test:acceptance`, `suite/`) is unchanged.

## 2. Contract

### 2.1 The editor choice

```ts
export type EditorChoice = 'vscode' | 'vscodium';

/** The VSCodium build the VSCodium run uses: an exact tag, never "latest". */
export const VSCODIUM_RELEASE = {
  tag: '1.140.06829-insider',
  repository: 'VSCodium/vscodium-insiders',
  /** The release asset's sha256, by `<os>-<arch>` of the client (`linux-x64`, `linux-arm64`). */
  sha256: {
    'linux-x64': '7d8779cb07f5dd66810a94a45855d0ffbe5c286ffddbb88f8ecdca6b63a6813f',
    'linux-arm64': 'e0ad855b10ec0928f8f832bbf9d12536918b6ecb8cec4600431654ff27a72c37',
  },
} as const;
```

The two values are the release's own `.sha256` assets (the arm64 one checked against a download, 2026-10-12). Bumping the tag is a reviewed change, with the floor check of section 3.1.

`runAcceptance(root, dependencies, editor: EditorChoice = 'vscode')`. With `vscodium`:
- `HarnessDependencies` gains `vscodiumExecutable: () => Promise<string>`. The real one downloads
  `VSCodium-<os>-<arch>-<tag>.tar.gz` from the release URL into `.vscode-test/vscodium-<tag>-<os>-<arch>/` (per platform since #657), unless it is already
  there. It checks the sha256 (a mismatch throws `the VSCodium download does not match its checksum`), unpacks it, and
  returns `<folder>/bin/codium-insiders`. The CLI that installs the VSIX files is the same executable.
- The VSIX files are installed with that CLI into the run's extensions folder, as for VS Code.
- The harness variables are unchanged, with one addition: `HARNESS_EDITOR` (`vscode` or `vscodium`).

### 2.2 The configurations

`acceptanceConfiguration(root, environment)` stays (the VS Code run). New:

```ts
/** The two VSCodium configurations: `local` runs suite-local in a plain window; `remote` runs suite-remote in a window on `ssh-remote+harness`. */
export function vscodiumConfigurations(root: string, environment: Readonly<Record<string, string | undefined>>, executable: string): TestConfiguration[];
```

Both have `useInstallation: {fromPath: executable}`, the run's user-data and extensions folders,
`--enable-proposed-api=remote-oss.remote-ssh`, `--disable-workspace-trust`, the harness variables in `env`, and
`mocha: {ui: 'bdd', timeout: 120_000}`.
- `label: 'local'`: `extensionDevelopmentPath` is `tests/acceptance/runner` (as today), `files` is
  `dist-local/**/*.test.cjs`.
- `label: 'remote'`: `extensionDevelopmentPath` is `tests/acceptance/runner-remote`, `files` is
  `dist-remote/**/*.test.cjs`, and `launchArgs` begins with `--folder-uri`, `vscode-remote://ssh-remote+harness/home/harness`.

The run calls test-cli once per label (`--label local`, then `--label remote`). It fails when either fails, and
`runWithRetry` applies to each.

### 2.3 `vscode-test.mjs`

It exports `acceptanceConfiguration(...)` when `HARNESS_EDITOR` is `vscode` or unset, and
`vscodiumConfigurations(...)` when it is `vscodium`, with the executable from `HARNESS_VSCODIUM_EXECUTABLE`, which the
run sets.

### 2.4 `runner-remote`

The same shape as `tests/acceptance/runner/package.json` (contributes nothing), plus `"extensionKind": ["workspace"]`,
so test-cli's runner loads in the remote extension host of the window on `ssh-remote+harness`.

### 2.5 Bundling

`bundleSuite` bundles `suite/` into `dist/` (unchanged), `suite-local/` into `dist-local/`, and `suite-remote/` into
`dist-remote/`, each in the same way.

### 2.6 Script and CI

- `"test:acceptance:vscodium": "pnpm package && node tools/acceptance.ts --editor vscodium"`. The tool reads
  `--editor`; anything other than `vscode` or `vscodium` exits 2 with a usage line.
- In `ci.yml`, a job `acceptance-vscodium`, built like `acceptance-real-server` (ruling 6, R-101's pattern): a
  `workflow_dispatch` input `vscodium` (boolean, default false), run when that input is set and on a release tag,
  `timeout-minutes: 30`, then `pnpm acceptance:clean` with `if: always()`. Whether it gates merges is the register's
  call, not this card's.

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 `tools/acceptance.test.ts` (over fake dependencies, as the file's existing rows are)

| Cite | Given | Expected |
|---|---|---|
| #253 Q14 | `runAcceptance(root, fakes)` with no editor | `vscodiumExecutable` is not called; the VS Code CLI installs the VSIX files |
| #253 Q14 | `runAcceptance(root, fakes, 'vscodium')` | the VSIX files are installed with the executable `vscodiumExecutable` gave |
| #253 Q14 | the same | `runTests` ran twice, labels `local` then `remote` |
| #253 Q14 | the same, `local` fails | the run exits non-zero, and `remote` still ran (both reports in the log) |
| #253 Q14 | `vscodiumConfigurations(...)` | the `remote` configuration's `launchArgs[0..1]` are `--folder-uri` and `vscode-remote://ssh-remote+harness/home/harness` |
| #253 Q14 | the same | both configurations have `useInstallation.fromPath` equal to the executable |
| #253 Q14 | the same | `--enable-proposed-api=remote-oss.remote-ssh` is in both |
| ADR-0007 | `VSCODIUM_RELEASE.tag` | its version part (before the first `-`) is at or above the root's `engines.vscode` floor |
| #253 Q14 | the checksum of a fake download that does not match | throws `the VSCodium download does not match its checksum` |
| #253 Q14 | `--editor vs` | exit 2 with the usage line |

### 3.2 `suite-remote/remote-window.test.ts` (ruling 3, the first row)

| Cite | Expected |
|---|---|
| #253 Q14 ruling 3 | `vscode.env.remoteName` is `'ssh-remote'` (the runner loaded in the remote extension host) |

**If this row cannot pass** because test-cli's runner does not load remotely, stop and report on #253 with the
editor's log. The fallback is ruling 1's placement (a local window that opens the remote one), and that is a
re-design, not this card's to improvise.

This row also needs the connect to succeed against the harness host, which needs the scripted adapters only when a
question is asked. The harness's `ssh_config` uses key login and `StrictHostKeyChecking accept-new`, so the first
connect asks nothing. The row can pass before card tooling-13 lands.

## 4. Rule for the worker

As card log-01. `pnpm test:acceptance:vscodium` must pass locally (Docker and `xvfb-run --auto-servernum`). Put the
run's output in the PR.

## 5. Gates and review

PR title `tools: the acceptance harness runs in a pinned VSCodium, in a local and a remote window (card tooling-12)`.

## 6. Open rows

None, apart from ruling 3's fallback if the first row cannot pass.
