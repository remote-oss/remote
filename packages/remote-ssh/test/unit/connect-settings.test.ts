import {deepStrictEqual} from 'node:assert';
import type {SettingHost} from 'lib-identifiers';
import {localDownloadModeOf} from '../../src/pipeline/connect-settings.ts';

/** A setting host with the user values of `values`, by full setting id, and no default for any other. */
function hostWith(values: Readonly<Record<string, unknown>>): SettingHost {
  return {
    inspectSetting: settingId =>
      settingId in values
        ? {defaultValue: undefined, globalValue: values[settingId]}
        : {defaultValue: undefined},
  };
}

const MODE = 'remote.SSH.localServerDownload';
const ALLOW = 'remote.SSH.allowLocalServerDownload';

describe('the download mode of a connect (F-2405 BR-1)', () => {
  it('F-2405.AC-6: auto, always and off are taken as written when the old switch is unset', () => {
    deepStrictEqual(
      ['auto', 'always', 'off'].map(mode =>
        localDownloadModeOf(hostWith({[MODE]: mode})),
      ),
      ['auto', 'always', 'off'],
    );
  });

  it('F-2405.AC-5: the old switch false gives off, whatever the mode says', () => {
    deepStrictEqual(
      ['auto', 'always', 'off'].map(mode =>
        localDownloadModeOf(hostWith({[MODE]: mode, [ALLOW]: false})),
      ),
      ['off', 'off', 'off'],
    );
  });

  it('F-2405.AC-6: the old switch true leaves the mode to decide', () => {
    deepStrictEqual(
      localDownloadModeOf(hostWith({[MODE]: 'always', [ALLOW]: true})),
      'always',
    );
  });

  it('F-2405.AC-7: an unknown value, a value of another type and no value give auto', () => {
    deepStrictEqual(
      [
        localDownloadModeOf(hostWith({[MODE]: 'bogus'})),
        localDownloadModeOf(hostWith({[MODE]: 5})),
        localDownloadModeOf(hostWith({})),
      ],
      ['auto', 'auto', 'auto'],
    );
  });
});
