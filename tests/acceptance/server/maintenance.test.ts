import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {
  cleanup,
  kill,
  startOrReuse,
  type ScriptParameters,
  uninstall,
} from 'lib-server';
import {startHost, type RunningHost} from './host-fixture.ts';
import {
  dataFolderOf,
  HOST_HOME,
  installStatus,
  lockLoop,
  parametersFor,
  placeStandInArchive,
} from './support.ts';

const CANCELLATION = new AbortController().signal;

describe('the maintenance of the host server', function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
    placeStandInArchive(host);
  });

  after(() => {
    host.stop();
  });

  /** Installs and starts the server, and returns its parameters and process id. */
  async function running(): Promise<{
    parameters: ScriptParameters;
    processId: number;
  }> {
    const parameters = parametersFor();
    await installStatus(host, parameters);
    const outcome = await startOrReuse(
      host.channel,
      parameters,
      {
        bindHost: '127.0.0.1',
        portRange: '',
        licenceAccepted: false,
        graceSeconds: 0,
        defaultExtensions: [],
        fileWatcherPollingMilliseconds: 0,
        readySeconds: 10,
      },
      [],
      {
        lockLoop: lockLoop(),
        logger: createLogger(undefined, {minimumLevel: () => 'info'}),
      },
      CANCELLATION,
    );
    if (outcome.kind !== 'started') {
      throw new Error(`no server: ${JSON.stringify(outcome.failure)}`);
    }
    return {parameters, processId: outcome.server.processId};
  }

  function alive(processId: number): boolean {
    return (
      host
        .onHost(
          'sh',
          '-c',
          `kill -0 ${String(processId)} 2>/dev/null && echo alive || echo gone`,
        )
        .trim() === 'alive'
    );
  }

  function exists(file: string): boolean {
    return (
      host
        .onHost('sh', '-c', `test -e '${file}' && echo yes || echo no`)
        .trim() === 'yes'
    );
  }

  describe('F-2411 kill', () => {
    it('F-2411: stops the server of the data folder', async () => {
      const {parameters, processId} = await running();
      await kill(host.channel, parameters, CANCELLATION);
      deepStrictEqual(alive(processId), false);
    });

    it('F-2411: removes the installed servers, keeping the data folder', async () => {
      const {parameters} = await running();
      await kill(host.channel, parameters, CANCELLATION);
      deepStrictEqual(
        [
          exists(`${dataFolderOf(parameters)}/bin`),
          exists(dataFolderOf(parameters)),
        ],
        [false, true],
      );
    });

    it('F-2411: succeeds silently when nothing runs', async () => {
      deepStrictEqual(await kill(host.channel, parametersFor(), CANCELLATION), {
        kind: 'done',
      });
    });
  });

  describe('F-2412 uninstall', () => {
    it('F-2412: stops the server and deletes the data folder', async () => {
      const {parameters, processId} = await running();
      await uninstall(host.channel, parameters, CANCELLATION);
      deepStrictEqual(
        [alive(processId), exists(dataFolderOf(parameters))],
        [false, false],
      );
    });

    it('F-2412: leaves the rest of the home folder alone', async () => {
      host.onHost('sh', '-c', `echo mine > '${HOST_HOME}/keep-me'`);
      const {parameters} = await running();
      await uninstall(host.channel, parameters, CANCELLATION);
      deepStrictEqual(exists(`${HOST_HOME}/keep-me`), true);
    });

    it('F-2412: succeeds when there is nothing to remove', async () => {
      deepStrictEqual(
        await uninstall(host.channel, parametersFor(), CANCELLATION),
        {kind: 'done'},
      );
    });
  });

  describe('F-2413 clean-up', () => {
    /** Creates install folders named by commits, the first the oldest, with modification times a minute apart. */
    function installFolders(
      parameters: ScriptParameters,
      names: string[],
    ): void {
      const binFolder = `${dataFolderOf(parameters)}/bin`;
      host.onHost('mkdir', '-p', binFolder);
      names.forEach((name, index) => {
        host.onHost('mkdir', `${binFolder}/${name}`);
        host.onHost(
          'touch',
          '-d',
          `@${String(1700000000 + index * 60)}`,
          `${binFolder}/${name}`,
        );
      });
    }

    function installed(parameters: ScriptParameters): string[] {
      return host
        .onHost('ls', `${dataFolderOf(parameters)}/bin`)
        .split('\n')
        .filter(name => name !== '')
        .sort();
    }

    it('F-2413: keeps the newest five installs and removes the older ones', async () => {
      const parameters = parametersFor({commit: 'current'});
      const names = [0, 1, 2, 3, 4, 5, 6, 7].map(
        index => `0123456789abcdef0123456789abcdef0123456${String(index)}`,
      );
      installFolders(parameters, names);
      await cleanup(host.channel, parameters, CANCELLATION);
      deepStrictEqual(installed(parameters), names.slice(3));
    });
  });
});
