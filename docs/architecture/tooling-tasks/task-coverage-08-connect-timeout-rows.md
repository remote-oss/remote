# Task card coverage-08: the connect wait rows of F-2202 6.4, over real `ssh -G` (remote-ssh#29)

Issue: #515. Why: metis answered `remote-oss/remote-ssh#29` with option (b) (2026-10-12): every option of a host
comes from `ssh -G`, and F-2202 AC-25 to AC-30 now require the value OpenSSH reports, plus 2. athena's contracts on main
(ef0664a, S4) make that design final. Our code already does it: `parseEffectiveOptions` (lib-ssh) reads `ssh -G`,
`effectiveConnectTimeoutSeconds` and `connectWaitsFor` (remote-ssh `pipeline/bounds.ts`) give the probe's wait. No row
proves it on the ACs' own configurations. Builder: selene.

## 1. The file

One new file, `packages/remote-ssh/test/unit/connect-timeout-lookup.test.ts`, exactly as below. Each row writes the
AC's configuration into a temporary folder, runs the real `ssh -G -F <file> <host>`, and passes the output through our
functions. It was run on main (OpenSSH 10.2p1): all six pass, and lint, typecheck and dupes are clean. The `ssh`
program must be on `PATH`, as it is on the CI runners and wherever the acceptance tests run.

```ts
import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseEffectiveOptions} from 'lib-ssh';
import {
  connectWaitsFor,
  effectiveConnectTimeoutSeconds,
} from '../../src/pipeline/bounds.ts';

/** `remote.SSH.connectTimeout` at its default, as every row of F-2202 6.4 has it. */
const SETTING_DEFAULT = 15;

describe('F-2202 6.4: the connect wait comes from the options OpenSSH reports (BR-21)', function () {
  this.timeout(20000);
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'connect-timeout-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  /** Writes the files of one case into the folder: `config` is the user file. */
  function files(contents: Record<string, string>): string {
    for (const [name, text] of Object.entries(contents)) {
      writeFileSync(
        path.join(folder, name),
        text.replaceAll('<folder>', folder),
      );
    }
    return path.join(folder, 'config');
  }

  /** The probe's wait in seconds for `host`, from `ssh -G` over `config` and the setting's default. */
  function waitSeconds(config: string, host: string): number {
    const lookedUp = spawnSync('ssh', ['-G', '-F', config, host], {
      encoding: 'utf8',
    });
    const parsed = parseEffectiveOptions(lookedUp.stdout);
    const hostValue =
      'options' in parsed ? parsed.options.connectTimeout : undefined;
    return (
      connectWaitsFor(
        effectiveConnectTimeoutSeconds(hostValue, SETTING_DEFAULT),
      ).probeMilliseconds / 1000
    );
  }

  it('F-2202 AC-25: both names of one block take its timeout plus 2', () => {
    const config = files({
      config:
        'Host mb-first mb-second\n  HostName first.invalid\n  ConnectTimeout 21\n',
    });
    deepStrictEqual(
      [waitSeconds(config, 'mb-second'), waitSeconds(config, 'mb-first')],
      [23, 23],
    );
  });

  it('F-2202 AC-26: a typed name a wildcard block matches takes its timeout plus 2', () => {
    const config = files({
      config: 'Host mb-wild*\n  HostName wild.invalid\n  ConnectTimeout 26\n',
    });
    deepStrictEqual(waitSeconds(config, 'mb-wildx'), 28);
  });

  it('F-2202 AC-27: a block without HostName gives its timeout plus 2, as with one', () => {
    deepStrictEqual(
      [
        waitSeconds(files({config: 'Host foo\n  ConnectTimeout 21\n'}), 'foo'),
        waitSeconds(
          files({
            config: 'Host foo\n  HostName foo.invalid\n  ConnectTimeout 21\n',
          }),
          'foo',
        ),
      ],
      [23, 23],
    );
  });

  it('F-2202 AC-28: a host of a top-level include gives the included timeout plus 2, with or without a later Host *', () => {
    const included =
      'Host mb-incl\n  HostName incl.invalid\n  ConnectTimeout 22\n';
    deepStrictEqual(
      [
        waitSeconds(
          files({
            included,
            config: 'Include <folder>/included\nHost *\n  ConnectTimeout 29\n',
          }),
          'mb-incl',
        ),
        waitSeconds(
          files({included, config: 'Include <folder>/included\n'}),
          'mb-incl',
        ),
      ],
      [24, 24],
    );
  });

  it('F-2202 AC-29: a block whose only line includes the options gives the included timeout plus 2', () => {
    const config = files({
      cond: 'HostName cond.invalid\nConnectTimeout 23\n',
      config: 'Host mb-cond\n  Include <folder>/cond\n',
    });
    deepStrictEqual(waitSeconds(config, 'mb-cond'), 25);
  });

  it("F-2202 AC-30: typed MB-PLAIN gets the defaults, MB-MATCH the Match block's timeout plus 2", () => {
    const config = files({
      config:
        'Host mb-plain\n  HostName plain.invalid\n  ConnectTimeout 24\nMatch host mb-match\n  HostName match.invalid\n  ConnectTimeout 25\n',
    });
    deepStrictEqual(
      [waitSeconds(config, 'MB-PLAIN'), waitSeconds(config, 'MB-MATCH')],
      [17, 27],
    );
  });
});
```

Nothing else changes: no source file, no other row, and not `docs/architecture/catalogue/coverage-slice1.tsv`.
hestia tags these ACs in #481 once the rows are on main.

## 2. Done when

- the six rows pass;
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm dupes`, `pnpm coverage` and `pnpm
  check-coverage` pass.

If a row fails as written, don't change the expected value. Stop and report the actual value, and `ssh -V`, on the
issue: an older OpenSSH may evaluate a case differently.

## 3. Review

PR title `tests: the connect wait rows of F-2202 6.4 over real ssh -G (card coverage-08, remote-ssh#29)`. themis or
triton reviews.
