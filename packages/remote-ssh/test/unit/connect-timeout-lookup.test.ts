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
