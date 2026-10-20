import {deepStrictEqual} from 'node:assert';
import {SSH_POLICY} from 'lib-server';
import {
  bindHostOf,
  hostServerSettings,
  type HostServerSettings,
  type RawServerSettings,
} from '../../src/pipeline/host-settings.ts';
import {
  type ParameterInput,
  archiveFormatOf,
  runtimeOptionsFor,
  scriptParametersFor,
  serverNamesOf,
} from '../../src/pipeline/parameters.ts';

const UNSET: RawServerSettings = {
  serverInstallPath: undefined,
  bindHost: undefined,
  serverPickPortsFromRange: undefined,
  httpProxy: '',
  httpsProxy: '',
  reconnectionGraceTime: null,
  defaultExtensions: undefined,
  useFlock: true,
  lockfilesInTmp: false,
  useCurlAndWgetConfigurationFiles: false,
};

const BOUNDS = {downloadSeconds: 60, readySeconds: 20};

function settingsOf(
  changes: Partial<RawServerSettings> = {},
): HostServerSettings {
  return hostServerSettings({...UNSET, ...changes}, 'devbox');
}

function input(
  settings: HostServerSettings,
  changes: Partial<ParameterInput> = {},
): ParameterInput {
  return {
    names: {
      commit: 'abc123',
      dataFolderName: '.server-data',
      launcher: 'bin/launcher',
    },
    policy: SSH_POLICY,
    settings,
    remoteUser: 'alex',
    hostOperatingSystem: 'linux',
    archiveUrl: 'https://example.invalid/server.tar.gz',
    epochMilliseconds: 1700000000000,
    bounds: BOUNDS,
    socketMode: false,
    ...changes,
  };
}

describe('the settings for a host', () => {
  it('are the manifest defaults when nothing is set', () => {
    deepStrictEqual(settingsOf(), {
      installFolder: {kind: 'default'},
      bindHost: {bindHost: '127.0.0.1'},
      portRange: '',
      rangeProblem: undefined,
      httpProxy: '',
      httpsProxy: '',
      graceSeconds: 0,
      defaultExtensions: [],
      useFlock: true,
      lockfilesInTmp: false,
      useConfigurationFiles: false,
    });
  });

  it('take the entries for the alias, exactly, and the proxy text that applies', () => {
    deepStrictEqual(
      settingsOf({
        serverInstallPath: {devbox: '/data/servers'},
        bindHost: {devbox: '0.0.0.0', other: '::1'},
        serverPickPortsFromRange: {devbox: '4000-5000'},
        httpProxy: {'*': 'http://star:1'},
        httpsProxy: 'http://all:2',
        reconnectionGraceTime: 300,
        defaultExtensions: ['one.alpha', 7, 'two.beta'],
        useFlock: false,
        lockfilesInTmp: true,
        useCurlAndWgetConfigurationFiles: true,
      }),
      {
        installFolder: {kind: 'folder', folder: '/data/servers'},
        bindHost: {bindHost: '0.0.0.0'},
        portRange: '4000-5000',
        rangeProblem: undefined,
        httpProxy: 'http://star:1',
        httpsProxy: 'http://all:2',
        graceSeconds: 300,
        defaultExtensions: ['one.alpha', 'two.beta'],
        useFlock: false,
        lockfilesInTmp: true,
        useConfigurationFiles: true,
      },
    );
  });

  it('read an extension list that is no list as empty', () => {
    deepStrictEqual(
      settingsOf({defaultExtensions: 'one.alpha'}).defaultExtensions,
      [],
    );
  });
});

describe('the script parameters', () => {
  it('put the product names and the archive where the scripts read them', () => {
    const {
      installRoot,
      dataFolderName,
      launcher,
      commit,
      archiveUrl,
      archivePath,
      removeArchive,
      archiveFormat,
      epochMilliseconds,
    } = scriptParametersFor(input(settingsOf()));
    deepStrictEqual(
      {
        installRoot,
        dataFolderName,
        launcher,
        commit,
        archiveUrl,
        archivePath,
        removeArchive,
        archiveFormat,
        epochMilliseconds,
      },
      {
        installRoot: '',
        dataFolderName: '.server-data',
        launcher: 'bin/launcher',
        commit: 'abc123',
        archiveUrl: 'https://example.invalid/server.tar.gz',
        archivePath: '',
        removeArchive: false,
        archiveFormat: 'tar.gz',
        epochMilliseconds: 1700000000000,
      },
    );
  });

  it('put the proxies, the downloader bound and the lock where the scripts read them', () => {
    const {proxy, downloader, lock} = scriptParametersFor(input(settingsOf()));
    deepStrictEqual(
      {proxy, downloader, lock},
      {
        proxy: {http: '', https: ''},
        downloader: {useConfigurationFiles: false, timeoutSeconds: 60},
        lock: {
          method: 'flock',
          inTemporaryFolder: false,
          filePrefix: 'remote-lock.alex',
        },
      },
    );
  });

  it('put the policy and the start options where the scripts read them', () => {
    const {environmentSetup, installUmask, cleanup, start} =
      scriptParametersFor(input(settingsOf()));
    deepStrictEqual(
      {environmentSetup, installUmask, cleanup, start},
      {
        environmentSetup: '',
        installUmask: SSH_POLICY.installUmask,
        cleanup: SSH_POLICY.cleanup,
        start: {
          bindHost: '127.0.0.1',
          port: '0',
          licenceAccepted: false,
          graceSeconds: 0,
          extensions: [],
          fileWatcherPollingMilliseconds: 0,
          useHostProxy: false,
          forceDisableUserEnv: false,
          requirementsHelper: false,
          readySeconds: 20,
          socketMode: false,
        },
      },
    );
  });

  it('F-2410 BR-4: carry the socket mode of the connect to the start', () => {
    deepStrictEqual(
      [false, true].map(
        socketMode =>
          scriptParametersFor(input(settingsOf(), {socketMode})).start
            .socketMode,
      ),
      [false, true],
    );
  });

  it('use the install folder as the install root and the range as the port', () => {
    const parameters = scriptParametersFor(
      input(
        settingsOf({
          serverInstallPath: {devbox: '/data'},
          serverPickPortsFromRange: {devbox: '4000-4010'},
        }),
      ),
    );
    deepStrictEqual(
      [parameters.installRoot, parameters.start.port],
      ['/data', '4000-4010'],
    );
  });

  it('take the lock with flock only on Linux and when the setting allows it', () => {
    const methods = [
      scriptParametersFor(input(settingsOf())).lock.method,
      scriptParametersFor(input(settingsOf(), {hostOperatingSystem: 'darwin'}))
        .lock.method,
      scriptParametersFor(input(settingsOf(), {hostOperatingSystem: undefined}))
        .lock.method,
      scriptParametersFor(input(settingsOf({useFlock: false}))).lock.method,
    ];
    deepStrictEqual(methods, ['flock', 'link', 'link', 'link']);
  });

  it('put the lock file in the temporary folder when the setting says so', () => {
    deepStrictEqual(
      scriptParametersFor(input(settingsOf({lockfilesInTmp: true}))).lock
        .inTemporaryFolder,
      true,
    );
  });

  it('carry the proxies, written the way the host reads an address, and the downloader option', () => {
    const parameters = scriptParametersFor(
      input(
        settingsOf({
          httpProxy: 'http://one:1',
          httpsProxy: 'http://two:2',
          useCurlAndWgetConfigurationFiles: true,
        }),
      ),
    );
    deepStrictEqual(
      [parameters.proxy, parameters.downloader.useConfigurationFiles],
      [{http: 'http://one:1/', https: 'http://two:2/'}, true],
    );
  });
});

describe('the start options', () => {
  it('are the settings, the licence left to the gate, and the ready bound', () => {
    deepStrictEqual(
      runtimeOptionsFor(
        settingsOf({
          bindHost: {devbox: '0.0.0.0'},
          serverPickPortsFromRange: {devbox: '4000-5000'},
          reconnectionGraceTime: 120,
          defaultExtensions: ['one.alpha'],
        }),
        BOUNDS,
      ),
      {
        bindHost: '0.0.0.0',
        portRange: '4000-5000',
        licenceAccepted: false,
        graceSeconds: 120,
        defaultExtensions: ['one.alpha'],
        fileWatcherPollingMilliseconds: 0,
        readySeconds: 20,
        socketMode: false,
      },
    );
  });
});

describe('the start options of a socket-mode connect', () => {
  it('F-2410 BR-4: are the default with the socket mode off, and socket mode when asked', () => {
    deepStrictEqual(
      [
        runtimeOptionsFor(settingsOf(), BOUNDS, false, true).socketMode,
        runtimeOptionsFor(settingsOf(), BOUNDS).socketMode,
      ],
      [true, false],
    );
  });
});

describe('the archive format', () => {
  it('is a zip when the address names a zip file, whatever follows it', () => {
    deepStrictEqual(
      [
        archiveFormatOf('https://example.invalid/server.zip'),
        archiveFormatOf('https://example.invalid/server.ZIP?token=a.tar.gz'),
      ],
      ['zip', 'zip'],
    );
  });

  it('is a gzipped tar for any other address', () => {
    deepStrictEqual(
      [
        archiveFormatOf('https://example.invalid/server.tar.gz'),
        archiveFormatOf('https://example.invalid/download?name=server.zip'),
      ],
      ['tar.gz', 'tar.gz'],
    );
  });

  it('goes into the script parameters', () => {
    deepStrictEqual(
      scriptParametersFor(
        input(settingsOf(), {archiveUrl: 'https://example.invalid/s.zip'}),
      ).archiveFormat,
      'zip',
    );
  });
});

describe('the server names of a profile', () => {
  const PROFILE = {
    commit: 'abc123',
    applicationName: 'fixture',
    serverApplicationName: 'fixture-server',
    serverDataFolderName: '.declared',
  } as unknown as Parameters<typeof serverNamesOf>[0];

  it('are the commit, the declared data folder and the launcher of the server application', () => {
    deepStrictEqual(serverNamesOf(PROFILE), {
      commit: 'abc123',
      dataFolderName: '.declared',
      launcher: 'bin/fixture-server',
    });
  });

  it('take the data folder from the application name when none is declared', () => {
    deepStrictEqual(
      serverNamesOf({...PROFILE, serverDataFolderName: ''}).dataFolderName,
      '.fixture-server',
    );
  });
});

describe('the bind host of a host (F-2409 7.E1, 7.E11)', () => {
  const REJECTED = [
    'not a host!',
    '127.0.0.1 ',
    '::1',
    '1.2.3.4:5',
    'my_host',
    'ho$t',
    'host/x',
    'héllo',
    '[::1',
    '[1.2.3.4]',
    '-a',
    '',
  ];
  for (const entry of REJECTED) {
    it(`F-2409 7.E1: ${JSON.stringify(entry)} is replaced by the loopback address and reported as written`, () => {
      deepStrictEqual(bindHostOf({devbox: entry}, 'devbox'), {
        bindHost: '127.0.0.1',
        rejected: entry,
      });
    });
  }

  it('F-2409 7.E1: an object bind host is reported as its JSON text', () => {
    deepStrictEqual(
      bindHostOf({devbox: JSON.parse('{"a":1}') as object}, 'devbox'),
      {
        bindHost: '127.0.0.1',
        rejected: '{"a":1}',
      },
    );
  });

  for (const entry of [
    '0.0.0.0',
    '10.99.99.99',
    '1.2.3',
    'myhost',
    '[::1]',
    'localhost',
  ]) {
    it(`F-2409 7.E1: ${entry} is used as written`, () => {
      deepStrictEqual(bindHostOf({devbox: entry}, 'devbox'), {bindHost: entry});
    });
  }

  for (const entry of [5, true, null, ['a'], undefined]) {
    it(`F-2409 7.E11: ${JSON.stringify(entry)} is ignored`, () => {
      deepStrictEqual(bindHostOf({devbox: entry}, 'devbox'), {
        bindHost: '127.0.0.1',
      });
    });
  }

  it('F-2409 7.E1: a bind host that is no map of hosts is ignored', () => {
    deepStrictEqual(bindHostOf('10.0.0.1', 'devbox'), {bindHost: '127.0.0.1'});
  });
});
