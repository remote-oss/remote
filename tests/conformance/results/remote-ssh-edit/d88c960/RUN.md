# remote-ssh-edit conformance results, build d88c960 (release 0.1 gate)

## What ran

| | |
|---|---|
| Build under test | `remote-oss/remote` main `d88c960`, `pnpm package` → `remote-ssh-edit-0.0.0.vsix`, sha256 `d6ceacddaecf17c73b82211591784b1ec37d9aff68596277863b829ebaf19884` |
| Suite | `remote-oss/remote-ssh-edit` `tests/conformance` at `e8a14f3afc477badfc1963c4abbe9ce480fea64f`, with its own runner copy |
| Editor | VS Code 1.139.1 (`04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`), arm64 |
| Platform | [linux-arm64], two runner slots in parallel |
| Profiles | the 12 companion-free profiles (`summary.json` → `gate_profiles`) |
| Gate cases | 772; the 39 cases of the four companion profiles were not run (`summary.json` → `companion_not_run`) |
| Model use | none: the runner replays the recorded cases and compares observations |

Command per feature and profile, from the suite's `tests/conformance/runner`:

```
ENCODE_EXTENSION=<path>/remote-ssh-edit-0.0.0.vsix ENCODE_SLOTS=97-98 CONFORMANCE_WORK=<work> \
  bin/conformance run --feature F-xxxx --profile <profile> --slots 97-98
```

The runner also needs a display: `DISPLAY` and, under Xwayland, `XAUTHORITY`.

## Durations

The durations are active time. The host was suspended for about a day during the main run, and the suspension is excluded.

- Main run: every gate case once, 5 h 07 min (13:42:51–18:49:35 on the host clock, which stood still while suspended).
- Reruns: 43 min (21:02–21:46, 2026-10-07).

## Fixtures

These were built with the suite's own `bin/conformance build`:

| Fixture | Version | sha256 |
|---|---|---|
| editor/fresh-public | 1 | `e6f7360c09fc082b6dbbe2870107338230a4f4149c7bcc18addc6ac0fb2dcdb8` |
| workspace/ssh-absent | 1 | `89eadf0f4ff8d11d3f041845eec8a94580686befdd0691886f74551e0fbce588` |
| workspace/ssh-associations | 1 | `3dd6ef3c6c644f9ca16b3e8b6461602e9c9f8bd493b8ac6478cd4c4a711ed800` |
| workspace/ssh-completion | 1 | `06b5e47aa2dc0c7d0afa81e8dbff2cb626fddff14545ade6c3b055b82d0802ef` |
| workspace/ssh-grammar | 1 | `23ceb44e5b4179fa84e3464e294064cb3586e5a0b1be4612dfc3c30f96a7395d` |
| workspace/ssh-langconfig | 1 | `4e968b878fe51cc0f9beca2279f2f6ac7423dabba8202d4f22d4d5b42277871d` |

### memfs-sample.vsix (not in the public suite)

17 cases add a virtual file system extension by package name. The runner looks it up in `ENCODE_VSIX_DIR`, which defaults to `<work>/vsix`. The suite doesn't ship it, so the first run failed those 17 cases at install. It is VS Code's MIT file system provider sample, built like this:

```
git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/vscode-extension-samples.git
cd vscode-extension-samples && git checkout 65c1c44 && git sparse-checkout set fsprovider-sample
cd fsprovider-sample
sed -i 's/"publisher": "vscode-samples"/"publisher": "conformance-fixture"/' package.json   # vsce refuses that publisher
npm install
npx @vscode/vsce package --allow-missing-repository --skip-license -o <work>/vsix/memfs-sample.vsix
```

Result: sha256 `dde83b127389bc82963f91b51e5997adf57d5c356d85a90fbfeae729e5e50900` (vscode-memfs 0.0.3, 99.5 KB). No case asserts the publisher id; the cases observe "MemFS - Sample", "MemFS: Setup Workspace" and `memfs:/`.

## Counts

| | pass | fail |
|---|---|---|
| Original run (772) | 690 | 82 |
| After the fixture rerun (the 17 install failures rerun once with memfs-sample.vsix in place) | **704** | **68** |

The gate count is the second row.

### 2x-wait rerun (not counted)

The 25 other step failures were rerun once with every wait doubled: quick-pick timeouts, plus four lab-driver errors. 22 passed and 3 failed.

This rerun used a copy of the suite's runner with a one-line change in `encode/driver.py` (`timeout = 2 * float(timeout)`). It is therefore not part of the gate count until the PM classifies those cases. `failures.json` marks each of the 25 with `rerun_2x_wait`.

The 40 failures without a step error carry their mismatches in the per-case results. Their one-liners in `failures.json` come from those mismatches; none needed a rerun.

## failures.json

There is one entry per gate failure (68): case, feature, profile, a one-line expected-vs-observed, and a class guess (`code`, `spec` or `environment`). The guesses are QA's; each decision is the PM's.

| Class guess | All 68 | Excluding the 22 that pass at 2x wait |
|---|---|---|
| code | 30 | 30 |
| environment | 35 | 13 |
| spec | 3 | 3 |

## Follow-ups (not in this run)

- **memfs-sample.vsix:** ship the fixture (or its recipe) with the public suite so the gate is rerunnable from the suite alone.
- **F-4003-AC14-1:** the runner was not given the build's identity file (`ENCODE_IDENTITY`), so one copied extension id was not normalized. Rerun with it set.
- **Panel-duration cases (F-4101-AC24-1, F-4204-AC3-\*):** these assert 0.3 s where 0.2 s was observed. If it recurs, it's a spec question on those cases.
- **Folder-picker cases:** these list one entry more than recorded (a lab home `.config`, editor storage and log folders). The profile's home and storage need to match the recording, so this is an environment fix.
