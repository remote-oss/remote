import {settingLines} from '../../src/diagnostics/log-content.ts';
import {deepStrictEqual} from 'node:assert';
import type {SettingHost} from 'lib-identifiers';
import {
  agentForwardingOf,
  defaultForwardsOf,
  listedSettings,
  localDownloadModeOf,
  termsSettingsOf,
  x11ForwardingOf,
} from '../../src/pipeline/connect-settings.ts';

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

describe('the settings listing of the log (F-2003 BR-6 item 2, card connect-71)', () => {
  it('lists every setting of the table by id, except the two the client search lists, and none twice', () => {
    const listed = listedSettings(hostWith({})).map(([setting]) => setting);
    deepStrictEqual(
      [
        listed.includes('remote.SSH.useFlock'),
        listed.includes('remote.SSH.lockfilesInTmp'),
        listed.includes('remote.SSH.useLocalServer'),
        listed.includes('remote.SSH.path'),
        listed.includes('remote.SSH.permitPtyAllocation'),
        new Set(listed).size === listed.length,
        listed.every(setting => setting.startsWith('remote.SSH.')),
      ],
      [true, true, true, false, false, true, true],
    );
  });

  it('F-2003 BR-16, AC-29: in terminal mode the listing holds the useLocalServer line with false', () => {
    deepStrictEqual(
      settingLines(
        listedSettings(hostWith({'remote.SSH.useLocalServer': false})),
      ).filter(line => line.startsWith('remote.SSH.useLocalServer')),
      ['remote.SSH.useLocalServer = false'],
    );
  });

  it('gives each setting its effective value: the user value, or the default', () => {
    const host: SettingHost = {
      inspectSetting: settingId =>
        settingId === 'remote.SSH.useFlock'
          ? {defaultValue: true, globalValue: false}
          : settingId === 'remote.SSH.lockfilesInTmp'
            ? {defaultValue: false}
            : {defaultValue: undefined},
    };
    const values = new Map(listedSettings(host));
    deepStrictEqual(
      [
        values.get('remote.SSH.useFlock'),
        values.get('remote.SSH.lockfilesInTmp'),
        values.get('remote.SSH.bindHost'),
      ],
      [false, false, undefined],
    );
  });
});

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

const AGENT_SETTING = 'remote.SSH.enableAgentForwarding';
const DISPLAY_SETTING = 'remote.SSH.enableX11Forwarding';

describe('the forwarding switches of a connect (F-2311 R1, F-2312 R1)', () => {
  it('F-2311.AC-2, F-2312.AC-7: unset, true or any value but false is on', () => {
    const values = [
      {},
      {[AGENT_SETTING]: true, [DISPLAY_SETTING]: true},
      {[AGENT_SETTING]: 'no', [DISPLAY_SETTING]: 0},
    ];
    deepStrictEqual(
      values.map(written => [
        agentForwardingOf(hostWith(written)),
        x11ForwardingOf(hostWith(written)),
      ]),
      [
        [true, true],
        [true, true],
        [true, true],
      ],
    );
  });

  it('F-2311.AC-10, F-2312.AC-11: false is off', () => {
    const written = {[AGENT_SETTING]: false, [DISPLAY_SETTING]: false};
    deepStrictEqual(
      [
        agentForwardingOf(hostWith(written)),
        x11ForwardingOf(hostWith(written)),
      ],
      [false, false],
    );
  });
});

describe('the default forwarded ports of a connect (card connect-40)', () => {
  const SETTING = 'remote.SSH.defaultForwardedPorts';

  it('F-2507 BR-6: the setting is read as the editor gives it, with the requests and the skipped entries', () => {
    deepStrictEqual(
      defaultForwardsOf(
        hostWith({[SETTING]: [{name: 'web', remotePort: 8000}, 5]}),
      ),
      {
        requests: [
          {
            remoteHost: 'localhost',
            remotePort: 8000,
            localPort: 8000,
            label: 'web',
          },
        ],
        skipped: [{index: 1, reason: 'notAnObject'}],
      },
    );
  });

  it('F-2507 7.E4: an unset setting asks for nothing', () => {
    deepStrictEqual(defaultForwardsOf(hostWith({})), {
      requests: [],
      skipped: [],
    });
  });
});

describe('the RemoteCommand switch of a connect (F-2107 BR-10)', () => {
  const SETTING = 'remote.SSH.enableRemoteCommand';
  const USE_LOCAL = 'remote.SSH.useLocalServer';

  it('F-2107 BR-10: true, "true", "false" and 1 leave the switch on, and false, 0, "" and an absent value leave it off', () => {
    deepStrictEqual(
      [
        termsSettingsOf(hostWith({[SETTING]: true})).enableRemoteCommand,
        termsSettingsOf(hostWith({[SETTING]: 'true'})).enableRemoteCommand,
        termsSettingsOf(hostWith({[SETTING]: 'false'})).enableRemoteCommand,
        termsSettingsOf(hostWith({[SETTING]: 1})).enableRemoteCommand,
        termsSettingsOf(hostWith({[SETTING]: false})).enableRemoteCommand,
        termsSettingsOf(hostWith({[SETTING]: 0})).enableRemoteCommand,
        termsSettingsOf(hostWith({[SETTING]: ''})).enableRemoteCommand,
        termsSettingsOf(hostWith({})).enableRemoteCommand,
      ],
      [true, true, true, true, false, false, false, false],
    );
  });

  it('F-2107 BR-10: any other non-empty string and any other non-zero number follow the rule, as "no" and 2 show', () => {
    deepStrictEqual(
      [
        termsSettingsOf(hostWith({[SETTING]: 'no'})).enableRemoteCommand,
        termsSettingsOf(hostWith({[SETTING]: 2})).enableRemoteCommand,
      ],
      [true, true],
    );
  });

  it('F-2107 BR-10: the other switches stay strict: useLocalServer gives false for "true"', () => {
    deepStrictEqual(
      termsSettingsOf(hostWith({[USE_LOCAL]: 'true'})).useLocalServerSetting,
      false,
    );
  });
});
