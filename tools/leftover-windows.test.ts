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

/** The part of the windows maintenance these rows call, from its bundle (the tools' project can't import its sources). */
interface Maintenance {
  closeLeftoverWindows(): Promise<void>;
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

describe('the teardown that closes the windows a row left (card #2936)', () => {
  let bundleFolder = '';
  let maintenance: Maintenance;
  let folder = '';
  let previous: string | undefined;
  let answering: NodeJS.Timeout | undefined;

  before(async () => {
    const {build} = await import('esbuild');
    bundleFolder = mkdtempSync(path.join(tmpdir(), 'leftover-windows-bundle-'));
    const bundle = path.join(bundleFolder, 'maintenance.cjs');
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
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['vscode'],
      logLevel: 'silent',
    });
    maintenance = createRequire(import.meta.url)(bundle) as Maintenance;
  });

  after(() => {
    rmSync(bundleFolder, {recursive: true, force: true});
  });

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'leftover-windows-'));
    mkdirSync(path.join(folder, 'pids'));
    previous = process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS;
    process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS = path.join(folder, 'pids');
  });

  afterEach(() => {
    clearInterval(answering);
    if (previous === undefined) {
      delete process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS;
    } else {
      process.env.REMOTE_OSS_ACCEPTANCE_WINDOWS = previous;
    }
    rmSync(folder, {recursive: true, force: true});
  });

  /** A window whose agent reported `events`, in order. */
  function windowReporting(name: string, events: string[]): void {
    writeFileSync(
      path.join(folder, `${name}.events.jsonl`),
      events.map(event => `${JSON.stringify({event})}\n`).join(''),
    );
  }

  /** Makes every window that is sent a close deactivate at once, as an agent that closes its window does. */
  function windowsThatClose(names: string[]): void {
    const answered = new Set<string>();
    answering = setInterval(() => {
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

  it('#2936: it closes each window that is open and never `local`, and sends nothing to a window that has closed', async () => {
    windowReporting('w1', ['activated']);
    windowReporting('w2', ['activated']);
    windowReporting('w3', ['activated', 'deactivated']);
    windowReporting('local', ['activated']);
    windowsThatClose(['w1', 'w2', 'w3', 'local']);
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
    windowReporting('w1', ['activated', 'deactivated']);
    windowReporting('local', ['activated']);
    await maintenance.closeLeftoverWindows();
    deepStrictEqual(
      ['w1', 'local'].map(name => commandsOf(folder, name)),
      [[], []],
    );
  });
});
