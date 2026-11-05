import {deepStrictEqual} from 'node:assert';
import {
  desktopPortsOf,
  desktopPortsOver,
} from '../../src/engine/desktop-host.ts';
import type {DesktopData} from '../../src/engine/docker-desktop.ts';

/** Data whose programs are this Node, so that a listing finds a name and a start works on any host. */
const NODE_DATA: DesktopData = {
  application: process.execPath,
  start: {program: process.execPath, parameters: ['-e', '']},
  listing: {
    program: process.execPath,
    parameters: ['-p', "'Docker Desktop is up'"],
    processName: 'Docker Desktop',
  },
  recheckIntervalMilliseconds: 1,
  rechecks: {
    running: {kind: 'count', limit: 1},
    started: {kind: 'count', limit: 1},
  },
};

describe('Docker Desktop over child processes (card containers-200, §1)', () => {
  it('F-0202 BR-9: Linux has no ports, and macOS and Windows have ones with their table data', () => {
    deepStrictEqual(
      [
        desktopPortsOf('linux'),
        desktopPortsOf('darwin')?.data?.application,
        desktopPortsOf('win32')?.data?.listing.program,
      ],
      [
        undefined,
        '/Applications/Docker.app',
        'C:\\Windows\\System32\\tasklist.exe',
      ],
    );
  });

  it('F-0202 BR-9: an application that is not at its location is not installed, and a listing program that is missing lists nothing', async () => {
    const ports = desktopPortsOf('darwin');
    deepStrictEqual(
      [await ports?.installed(), await ports?.running()],
      [false, false],
    );
  });

  it('F-0202 BR-13: a start whose program does not exist ends without failing', async () => {
    const ports = desktopPortsOf('win32');
    await ports?.start();
  });

  it('F-0202 BR-13: a wait ends after its time, and at once when the cancellation ends', async () => {
    const ports = desktopPortsOf('darwin');
    const began = Date.now();
    await ports?.wait(5, new AbortController().signal);
    const controller = new AbortController();
    const waiting = ports?.wait(60_000, controller.signal);
    controller.abort();
    await waiting;
    deepStrictEqual(
      [Date.now() - began < 5000, (ports?.now() ?? 0) >= began],
      [true, true],
    );
  });

  it('F-0202 BR-9, BR-13: over programs that exist, the application is installed, its process is listed, and the start returns', async () => {
    const ports = desktopPortsOver(NODE_DATA);
    await ports.start();
    deepStrictEqual(
      [await ports.installed(), await ports.running()],
      [true, true],
    );
  });

  it('F-0202 BR-9: a listing counts as running when it names the process, as pgrep -lx prints it, and not when it prints a bare pid', async () => {
    function listing(printed: string): Promise<boolean> {
      return desktopPortsOver({
        ...NODE_DATA,
        listing: {
          ...NODE_DATA.listing,
          parameters: ['-p', JSON.stringify(printed)],
        },
      }).running();
    }
    deepStrictEqual(
      [await listing('4242 Docker Desktop\n'), await listing('4242\n')],
      [true, false],
    );
  });
});
