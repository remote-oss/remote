import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {environmentHints} from 'lib-ssh';
import {
  descriptionsOf,
  RECORDED_SETTINGS,
  sessionEnvironmentOf,
} from '../../src/diagnostics/session-environment.ts';

const PACKAGE_FOLDER = path.join(import.meta.dirname, '..', '..');

/** The package's manifest and its strings file. */
function manifest(): {
  properties: Record<
    string,
    {description?: string; markdownDescription?: string}
  >;
  strings: Record<string, string>;
} {
  const parsed = JSON.parse(
    readFileSync(path.join(PACKAGE_FOLDER, 'package.json'), 'utf8'),
  ) as {
    contributes: {
      configuration: {
        properties: Record<
          string,
          {description?: string; markdownDescription?: string}
        >;
      };
    };
  };
  return {
    properties: parsed.contributes.configuration.properties,
    strings: JSON.parse(
      readFileSync(path.join(PACKAGE_FOLDER, 'package.nls.json'), 'utf8'),
    ) as Record<string, string>,
  };
}

describe('the settings of a session record (card connect-135, F-2605 BR-9)', () => {
  it('F-2605.AC-17: the 22 settings are in the order of BR-9 without experimental.chat', () => {
    deepStrictEqual(
      RECORDED_SETTINGS.map(setting => setting.name),
      [
        'useLocalServer',
        'useExecServer',
        'bindHost',
        'path',
        'configFile',
        'useFlock',
        'lockfilesInTmp',
        'localServerDownload',
        'remoteServerListenOnSocket',
        'defaultExtensions',
        'defaultExtensionsIfInstalledLocally',
        'loglevel',
        'enableDynamicForwarding',
        'enableRemoteCommand',
        'serverPickPortsFromRange',
        'serverInstallPath',
        'permitPtyAllocation',
        'preferredLocalPortRange',
        'useCurlAndWgetConfigurationFiles',
        'experimental.enhancedSessionLogs',
        'httpProxy',
        'httpsProxy',
      ],
    );
  });

  it('F-2605.AC-17: only defaultExtensionsIfInstalledLocally and loglevel are listed without details', () => {
    deepStrictEqual(
      RECORDED_SETTINGS.filter(setting => !setting.described).map(
        setting => setting.name,
      ),
      ['defaultExtensionsIfInstalledLocally', 'loglevel'],
    );
  });

  it('F-2605.AC-17: every other setting is declared by the manifest and has a description in it', () => {
    const {properties, strings} = manifest();
    const descriptions = descriptionsOf(properties, strings);
    deepStrictEqual(
      RECORDED_SETTINGS.filter(
        setting =>
          setting.described && descriptions[setting.name] === undefined,
      ),
      [],
    );
  });

  it('F-2605.AC-17: the two without details are read by the spec’s spellings, and logLevel does not show in loglevel', () => {
    const values: Record<string, unknown> = {
      logLevel: 'trace',
      loglevel: undefined,
      defaultExtensionsIfInstalledLocally: ['a.b'],
    };
    const messages = environmentHints(
      sessionEnvironmentOf({
        read: name => values[name],
        descriptions: {},
        editorVersion: '1',
        extensionVersion: '2',
        platform: 'linux',
        architecture: 'x64',
      }),
    ).map(hint => hint.message);
    deepStrictEqual(
      [
        messages.find(text => text.includes("'loglevel'")),
        messages.find(text => text.includes('IfInstalledLocally')),
      ],
      [
        "Extension setting 'loglevel' is set to value 'undefined'",
        "Extension setting 'defaultExtensionsIfInstalledLocally' is set to value '[\"a.b\"]'",
      ],
    );
  });

  it('F-2605.AC-17: a user value of the exact key loglevel appears', () => {
    const messages = environmentHints(
      sessionEnvironmentOf({
        read: name => (name === 'loglevel' ? 'trace' : undefined),
        descriptions: {},
        editorVersion: '1',
        extensionVersion: '2',
        platform: 'linux',
        architecture: 'x64',
      }),
    ).map(hint => hint.message);
    deepStrictEqual(
      messages.find(text => text.includes("'loglevel'")),
      "Extension setting 'loglevel' is set to value 'trace'",
    );
  });

  it('F-2605.AC-17: a description reaches the hint of its setting, and the two without details get none', () => {
    const hints = environmentHints(
      sessionEnvironmentOf({
        read: () => undefined,
        descriptions: {
          useLocalServer: 'Local server.',
          loglevel: 'Never shown.',
        },
        editorVersion: '1',
        extensionVersion: '2',
        platform: 'linux',
        architecture: 'x64',
      }),
    );
    deepStrictEqual(
      [hints[0]?.details, hints[11]?.details, hints.length],
      ['Local server.', undefined, 25],
    );
  });

  it('resolves a %key% description through the strings file, and keeps a literal one', () => {
    deepStrictEqual(
      descriptionsOf(
        {
          'remote.SSH.path': {description: '%setting.Path.description%'},
          'remote.SSH.configFile': {description: 'A file.'},
          'remote.SSH.missing': {description: '%setting.None.description%'},
          'remote.SSH.bare': {},
          'remote.SSH.markdown': {markdownDescription: 'Marked up.'},
          'other.setting': {description: 'Elsewhere.'},
        },
        {'setting.Path.description': 'The ssh program.'},
      ),
      {path: 'The ssh program.', configFile: 'A file.', markdown: 'Marked up.'},
    );
  });
});
