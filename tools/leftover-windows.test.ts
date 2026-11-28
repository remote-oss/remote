import {deepStrictEqual} from 'node:assert';
import {createRequire} from 'node:module';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {DisplayStep} from '../tests/acceptance/windows/display.ts';

/** The part of the windows maintenance these rows call, from a bundle the rows make: its record is the module's own, and a row wants it fresh. */
interface Maintenance {
  closeLeftoverWindows(step?: DisplayStep): Promise<void>;
}

/** The commands window `name` was sent, in the folder of the agents' files; a line that only withdraws one is no command. */
function commandsOf(folder: string, name: string): string[] {
  const file = path.join(folder, `${name}.commands.jsonl`);
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line !== '')
        .flatMap(line => {
          const {command} = JSON.parse(line) as {command?: string};
          return command === undefined ? [] : [command];
        })
    : [];
}

/** A window whose agent reported `events`, in order, in `folder`. */
function windowReporting(folder: string, name: string, events: string[]): void {
  writeFileSync(
    path.join(folder, `${name}.events.jsonl`),
    events.map(event => `${JSON.stringify({event})}\n`).join(''),
  );
}

/** Makes every window of `names` that is sent a close deactivate at once, as an agent that closes its window does; it gives the timer the caller ends. */
function windowsThatClose(folder: string, names: string[]): NodeJS.Timeout {
  const answered = new Set<string>();
  return setInterval(() => {
    for (const name of names) {
      if (
        !answered.has(name) &&
        commandsOf(folder, name).includes('workbench.action.closeWindow')
      ) {
        answered.add(name);
        appendFileSync(
          path.join(folder, `${name}.events.jsonl`),
          `${JSON.stringify({event: 'deactivated'})}\n`,
        );
      }
    }
  }, 20);
}

/** Builds the maintenance module as the bundle `outfile`, so a row can require it as a fresh module. */
async function buildMaintenanceBundle(outfile: string): Promise<void> {
  const {build} = await import('esbuild');
  await build({
    entryPoints: [
      path.join(
        import.meta.dirname,
        '..',
        'tests',
        'acceptance',
        'windows',
        'maintenance.ts',
      ),
    ],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    logLevel: 'silent',
  });
}

/** The pid files folder a row's launch points at, with the value the launch's variable held before the row. */
function prepareWindowsFolder(prefix: string): {
  folder: string;
  previous: string | undefined;
} {
  const folder = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(folder, 'pids'));
  const previous = process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS;
  process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS = path.join(folder, 'pids');
  return {folder, previous};
}

/** Ends a row's windows folder: restores the launch's variable and removes the folder. */
function endWindowsFolder(prepared: {
  folder: string;
  previous: string | undefined;
}): void {
  if (prepared.previous === undefined) {
    delete process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS;
  } else {
    process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS = prepared.previous;
  }
  rmSync(prepared.folder, {recursive: true, force: true});
}

describe('the teardown that closes the windows a row left (card #2936)', () => {
  let bundleFolder = '';
  let maintenance: Maintenance;
  let folder = '';
  let previous: string | undefined;
  let answering: NodeJS.Timeout | undefined;

  before(async () => {
    bundleFolder = mkdtempSync(path.join(tmpdir(), 'leftover-windows-bundle-'));
    const bundle = path.join(bundleFolder, 'maintenance.cjs');
    await buildMaintenanceBundle(bundle);
    maintenance = createRequire(import.meta.url)(bundle) as Maintenance;
  });

  after(() => {
    rmSync(bundleFolder, {recursive: true, force: true});
  });

  beforeEach(() => {
    ({folder, previous} = prepareWindowsFolder('leftover-windows-'));
  });

  afterEach(() => {
    clearInterval(answering);
    endWindowsFolder({folder, previous});
  });

  it('#2936: it closes each window that is open and never `local`, and sends nothing to a window that has closed', async () => {
    windowReporting(folder, 'w1', ['activated']);
    windowReporting(folder, 'w2', ['activated']);
    windowReporting(folder, 'w3', ['activated', 'deactivated']);
    windowReporting(folder, 'local', ['activated']);
    answering = windowsThatClose(folder, ['w1', 'w2', 'w3', 'local']);
    await maintenance.closeLeftoverWindows();
    deepStrictEqual(
      ['w1', 'w2', 'w3', 'local'].map(name => commandsOf(folder, name)),
      [
        ['workbench.action.closeWindow'],
        ['workbench.action.closeWindow'],
        [],
        [],
      ],
    );
  });

  it('#2936: with every window but `local` closed it sends nothing', async () => {
    windowReporting(folder, 'w1', ['activated', 'deactivated']);
    windowReporting(folder, 'local', ['activated']);
    await maintenance.closeLeftoverWindows();
    deepStrictEqual(
      ['w1', 'local'].map(name => commandsOf(folder, name)),
      [[], []],
    );
  });
});

/** One window of the display a display step stands in for: its name, its managedness, the pid the display gives it, whether it asks the manager for a close, and whether a close takes. */
interface DisplayWindow {
  name: string;
  managed: boolean;
  windowPid: string | undefined;
  acceptsClose: boolean;
  closes: boolean;
}

describe('the leftover close on the display (card #3210)', () => {
  let bundleFolder = '';
  let maintenance: Maintenance;
  let folder = '';
  let previous: string | undefined;
  let answering: NodeJS.Timeout | undefined;

  beforeEach(async () => {
    // The close's record is the module's own: the rows take a bundle of their own, so each starts with a display it has not settled.
    bundleFolder = mkdtempSync(path.join(tmpdir(), 'display-leftover-bundle-'));
    const bundlePath = path.join(bundleFolder, 'maintenance.cjs');
    await buildMaintenanceBundle(bundlePath);
    maintenance = createRequire(import.meta.url)(bundlePath) as Maintenance;
    ({folder, previous} = prepareWindowsFolder('display-leftover-'));
  });

  afterEach(() => {
    clearInterval(answering);
    endWindowsFolder({folder, previous});
  });

  /** A managed top-level of a row's display table: its name, the pid the display gives it, and whether it asks the manager for a close. */
  function displayWindowOf(
    name: string,
    windowPid: string | undefined,
    acceptsClose: boolean,
  ): DisplayWindow {
    return {
      name,
      managed: true,
      windowPid,
      acceptsClose,
      closes: true,
    };
  }

  /** A display step over `table`, whose editor is `editor`; a close takes only when the window says it will, and the step says which windows it closed. */
  function stepOf(
    table: Map<string, DisplayWindow>,
    editor: string | undefined,
  ) {
    const closed: string[] = [];
    const step: DisplayStep = {
      windows: () =>
        Promise.resolve(
          [...table.entries()].map(([windowId, each]) => ({
            id: windowId,
            name: each.name,
            managed: each.managed,
          })),
        ),
      pidOf: windowId => Promise.resolve(table.get(windowId)?.windowPid),
      editorPid: () => Promise.resolve(editor),
      mayClose: windowId =>
        Promise.resolve(table.get(windowId)?.acceptsClose ?? false),
      close: windowId => {
        closed.push(windowId);
        if (table.get(windowId)?.closes) {
          table.delete(windowId);
        }
        return Promise.resolve();
      },
    };
    return {closed, step};
  }

  /** The nameless X child a top-level draws: the manager does not manage it, so the display pass never targets it. */
  function childOf(windowPid: string): DisplayWindow {
    return {name: '', managed: false, windowPid, acceptsClose: true, closes: true};
  }

  /**
   * What the display's close passes closed: the first pass settled the launch's own windows `own`, a row left `left`
   * behind while it ran, and the next `passes` (one) pass did the rest.
   */
  async function passesOf(
    own: Array<[string, DisplayWindow]>,
    left: Array<[string, DisplayWindow]>,
    editor: string,
    passes = 1,
  ): Promise<string[]> {
    const table = new Map<string, DisplayWindow>(own);
    const {closed, step} = stepOf(table, editor);
    await maintenance.closeLeftoverWindows(step);
    for (const [windowId, window] of left) {
      table.set(windowId, window);
    }
    for (let pass = 0; pass < passes; pass++) {
      await maintenance.closeLeftoverWindows(step);
    }
    return closed;
  }

  it('settles the launch\u2019s own window on the first pass, so a launch that does not title its windows never closes its local window', async () => {
    deepStrictEqual(
      await passesOf(
        [
          // The launch's local window in a launch that sets no window title: no bracketed folder, and no harness name in its title.
          ['1', displayWindowOf('Welcome - VSCodium - Insiders', '42', true)],
          ['2', childOf('42')],
        ],
        [['3', displayWindowOf('VSCodium - Insiders', '42', true)]],
        '42',
      ),
      ['3'],
    );
  });

  it('closes the editor top-level a row left, and not the launch\u2019s folder-less window or its children', async () => {
    deepStrictEqual(
      await passesOf(
        [
          ['1', displayWindowOf('[]', '42', true)],
          ['2', childOf('42')],
        ],
        [['4', displayWindowOf('VSCodium - Insiders', '42', true)]],
        '42',
      ),
      ['4'],
    );
  });

  it('closes nothing on the display of a window whose agent reports, which the named loop closes by its agent', async () => {
    windowReporting(folder, 'harness', ['activated']);
    answering = windowsThatClose(folder, ['harness']);
    deepStrictEqual(
      await passesOf(
        [['1', displayWindowOf('harness', '42', true)]],
        [['2', displayWindowOf('VSCodium - Insiders', '42', true)]],
        '42',
      ),
      ['2'],
    );
  });

  it('tells once of a top-level that will not close, holds it in its record, and does not ask it again', async function () {
    this.timeout(45_000);
    deepStrictEqual(
      await passesOf(
        [['1', displayWindowOf('[]', '42', true)]],
        [
          [
            '2',
            {
              name: 'VSCodium - Insiders',
              managed: true,
              windowPid: '42',
              acceptsClose: true,
              closes: false,
            },
          ],
        ],
        '42',
        2,
      ),
      ['2'],
    );
  });

  it('closes no top-level of another client, by its pid or by the lack of one', async () => {
    deepStrictEqual(
      await passesOf(
        [['1', displayWindowOf('[]', '42', true)]],
        [
          ['2', displayWindowOf('VSCodium - Insiders', '99', true)],
          ['3', displayWindowOf('VSCodium - Insiders', undefined, true)],
        ],
        '42',
      ),
      [],
    );
  });

  it('skips a top-level that does not accept a close, and tells of it once', async () => {
    deepStrictEqual(
      await passesOf(
        [['1', displayWindowOf('[]', '42', true)]],
        [['2', displayWindowOf('VSCodium - Insiders', '42', false)]],
        '42',
        2,
      ),
      [],
    );
  });
});
