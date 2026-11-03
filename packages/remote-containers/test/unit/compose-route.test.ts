import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  type ComposeRoute,
  composeRouteOf,
} from '../../src/engine/compose-route.ts';

/** An engine that answers every run with `outcome`, and records the arguments. */
function answering(outcome: EngineRunOutcome, seen: string[][]): EngineHost {
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      seen.push([...argv]);
      return Promise.resolve(outcome);
    },
    spawn: () => Promise.reject(new Error('never spawned')),
  };
}

/** The outcome of a run that ended with `status` after printing `stdout`. */
function ended(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}

/** Resolves the route over a plugin outcome (none for no Docker program), the program of the setting and its outcome. */
async function resolve(options: {
  plugin?: EngineRunOutcome;
  composePath?: unknown;
  program?: EngineRunOutcome;
  base?: string | null;
}): Promise<{route: ComposeRoute; files: string[]; lines: string[]}> {
  const sink = new MemorySink();
  const files: string[] = [];
  const route = await composeRouteOf(
    {
      docker:
        options.plugin === undefined
          ? undefined
          : answering(options.plugin, []),
      engineFor: file => {
        files.push(file);
        return answering(options.program ?? ended(0, '2.0.0'), []);
      },
      composePath: () => options.composePath,
      base: options.base === null ? undefined : (options.base ?? '/w'),
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    new AbortController().signal,
  );
  return {route, files, lines: sink.lines.map(line => line.message)};
}

describe('the Compose that a configuration runs with (F-0201 BR-4)', () => {
  it('F-0201 AC-5: the plugin answering compose version is used, and the setting’s program is never run', async () => {
    const {route, files} = await resolve({
      plugin: ended(0, 'Docker Compose version v2.20.0'),
      composePath: '/missing/dc',
    });
    deepStrictEqual([route, files], [{kind: 'plugin'}, []]);
  });

  it('F-0201 AC-11: with no plugin the program of the setting is used, and a version of 1.21 or above keeps dashes and underscores', async () => {
    const {route, files} = await resolve({
      plugin: ended(1),
      composePath: '/opt/dc',
      program: ended(0, '1.29.2\n'),
    });
    deepStrictEqual(
      [route, files],
      [
        {kind: 'standalone', file: '/opt/dc', dashAndUnderscore: true},
        ['/opt/dc'],
      ],
    );
  });

  /** Whether a standalone Compose that reports each of `versions` keeps dashes and underscores in a name, in order. */
  async function keepsDashes(versions: readonly string[]): Promise<unknown[]> {
    const kept: unknown[] = [];
    for (const stdout of versions) {
      const {route} = await resolve({
        plugin: ended(1),
        composePath: '/opt/dc',
        program: ended(0, stdout),
      });
      kept.push(
        route.kind === 'standalone' ? route.dashAndUnderscore : route.kind,
      );
    }
    return kept;
  }

  it('F-0201 AC-29: a version below 1.21 is told, and a version that cannot be read is not', async () => {
    deepStrictEqual(
      await keepsDashes(['1.0.0', '1.20.9', '0.9.1', 'not-a-version', '']),
      [false, false, false, true, true],
    );
  });

  it('F-0201 AC-29: a version of 1.21.0 and one of 2.0.0 keep dashes and underscores', async () => {
    deepStrictEqual(await keepsDashes(['1.21.0', '2.0.0']), [true, true]);
  });

  it('F-0201 AC-44: no plugin and the default program missing gives the default’s missing', async () => {
    const {route} = await resolve({
      plugin: ended(1),
      composePath: undefined,
      program: {kind: 'failed', detail: 'spawn docker-compose ENOENT'},
    });
    deepStrictEqual(route, {
      kind: 'missing',
      written: 'docker-compose',
      byDefault: true,
    });
  });

  it('F-0201 AC-6: a missing program that is not the default is named as written', async () => {
    const {route} = await resolve({
      plugin: {kind: 'failed', detail: 'spawn docker ENOENT'},
      composePath: '/nowhere/dc',
      program: {kind: 'failed', detail: 'spawn /nowhere/dc ENOENT'},
    });
    deepStrictEqual(route, {
      kind: 'missing',
      written: '/nowhere/dc',
      byDefault: false,
    });
  });

  it('F-0201 AC-51: a value the shell would expand is spawned as written, which finds no file, and a relative one with no folder to resolve it against names no program', async () => {
    const results = [];
    for (const [composePath, base] of [
      ['~/bin/dc', '/w'],
      ['$HOME/bin/dc', '/w'],
      ['tools/dc', null],
    ] as const) {
      results.push(
        (
          await resolve({
            plugin: ended(1),
            composePath,
            base,
            program: {kind: 'failed', detail: 'spawn ENOENT'},
          })
        ).route,
      );
    }
    deepStrictEqual(
      results.map(route => route.kind === 'missing' && route.written),
      ['~/bin/dc', '$HOME/bin/dc', 'tools/dc'],
    );
  });

  it('F-0201 AC-51: a relative path is resolved against the folder', async () => {
    const {files} = await resolve({plugin: ended(1), composePath: 'tools/dc'});
    deepStrictEqual(files, ['/w/tools/dc']);
  });

  it('F-0201 AC-45: a program that cannot run, or ends with a status other than 0, is broken, not missing', async () => {
    const results = [];
    for (const program of [
      {kind: 'failed', detail: 'spawn /opt/dc EACCES'} as const,
      ended(1),
    ]) {
      results.push(
        (await resolve({plugin: ended(1), composePath: '/opt/dc', program}))
          .route,
      );
    }
    deepStrictEqual(results, [
      {kind: 'broken', written: '/opt/dc'},
      {kind: 'broken', written: '/opt/dc'},
    ]);
  });

  it('F-0201 AC-25: with no Docker program at all the setting’s program is still tried', async () => {
    const {route} = await resolve({
      composePath: '/opt/dc',
      program: ended(0, '1.29.0'),
    });
    deepStrictEqual(route, {
      kind: 'standalone',
      file: '/opt/dc',
      dashAndUnderscore: true,
    });
  });
});
