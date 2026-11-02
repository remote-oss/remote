import {deepStrictEqual} from 'node:assert';
import {
  parameterValuesOf,
  rolesOf,
  startWordsOf,
} from '../../src/scripts/steps.ts';
import {parametersFor} from './fake-host.ts';

describe('the bootstrap steps as data', () => {
  describe('rolesOf', () => {
    it('adds the tree role to an install into a server tree', () => {
      const parameters = {...parametersFor(), installTree: '/srv/tree'};
      deepStrictEqual(
        rolesOf({installMode: 'singleScript', step: 'install'}, parameters).at(
          -1,
        ),
        'tree',
      );
    });

    it('adds the tree role to a start from a server tree', () => {
      const parameters = {...parametersFor(), installTree: '/srv/tree'};
      deepStrictEqual(
        rolesOf({installMode: 'singleScript', step: 'start'}, parameters),
        ['common', 'environment', 'lock', 'process', 'leave', 'tree'],
      );
    });

    it('leaves the tree role out of every other step, tree or not', () => {
      const parameters = {...parametersFor(), installTree: '/srv/tree'};
      deepStrictEqual(
        rolesOf({installMode: 'singleScript', step: 'probe'}, parameters),
        ['common', 'busybox'],
      );
    });

    it('leaves the tree role out of a start without a tree', () => {
      deepStrictEqual(
        rolesOf({installMode: 'singleScript', step: 'start'}, parametersFor()),
        ['common', 'environment', 'lock', 'process', 'leave'],
      );
    });
  });

  describe('parameterValuesOf', () => {
    it('gives the keep count of a keep-newest cleanup', () => {
      const values = new Map(parameterValuesOf(parametersFor()));
      deepStrictEqual(
        [values.get('CLEANUP_KIND'), values.get('KEEP_COUNT')],
        ['keepNewest', '5'],
      );
    });

    it('gives a keep count of 0 to every other cleanup', () => {
      const values = new Map(
        parameterValuesOf({
          ...parametersFor(),
          cleanup: {kind: 'onlyCurrentRemoveLeftovers'},
        }),
      );
      deepStrictEqual(
        [values.get('CLEANUP_KIND'), values.get('KEEP_COUNT')],
        ['onlyCurrentRemoveLeftovers', '0'],
      );
    });

    it('gives empty CLI values to a step without a CLI', () => {
      const values = new Map(parameterValuesOf(parametersFor()));
      deepStrictEqual(
        [
          values.get('CLI_NAME'),
          values.get('CLI_DATA'),
          values.get('CLI_STOP_PID'),
        ],
        ['', '', ''],
      );
    });

    it('writes the switches as yes and no', () => {
      const values = new Map(
        parameterValuesOf({...parametersFor(), removeArchive: true}),
      );
      deepStrictEqual(
        [values.get('ARCHIVE_REMOVE'), values.get('SOCKET_MODE')],
        ['yes', 'no'],
      );
    });
  });

  describe('startWordsOf', () => {
    it('starts on the host and port, with only the fixed options', () => {
      deepStrictEqual(startWordsOf(parametersFor().start), [
        {text: '--start-server'},
        {text: '--host'},
        {text: '127.0.0.1'},
        {text: '--port'},
        {text: '0'},
        {text: '--connection-token-file'},
        {variable: 'TOKEN_FILE'},
        {text: '--telemetry-level'},
        {text: 'off'},
        {text: '--enable-remote-auto-shutdown'},
      ]);
    });

    it('starts on the socket file, with every option asked for', () => {
      const start = {
        ...parametersFor().start,
        socketMode: true,
        licenceAccepted: true,
        graceSeconds: 60,
        extensions: ['a.b'],
        fileWatcherPollingMilliseconds: 500,
        useHostProxy: true,
        forceDisableUserEnv: true,
      };
      deepStrictEqual(startWordsOf(start), [
        {text: '--start-server'},
        {text: '--socket-path'},
        {variable: 'SOCKET_FILE'},
        {text: '--connection-token-file'},
        {variable: 'TOKEN_FILE'},
        {text: '--telemetry-level'},
        {text: 'off'},
        {text: '--enable-remote-auto-shutdown'},
        {text: '--accept-server-license-terms'},
        {text: '--reconnection-grace-time'},
        {text: '60'},
        {text: '--install-extension'},
        {text: 'a.b'},
        {text: '--file-watcher-polling'},
        {text: '500'},
        {text: '--use-host-proxy'},
        {text: '--force-disable-user-env'},
      ]);
    });
  });
});
