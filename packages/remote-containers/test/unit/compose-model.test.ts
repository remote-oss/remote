import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import {
  composeModelOf,
  type ComposeModelRead,
} from '../../src/compose/model.ts';

/** A secret that Compose interpolated into the model from a `.env`. */
const SECRET = 'hunter2-from-dot-env';

/** What a fake Compose answers with, and the files the client holds. */
interface Script {
  outcome: EngineRunOutcome;
  files?: Record<string, string>;
}

/** Reads the model of `files` against the script; gives the read, Compose's arguments and the lines. */
async function read(
  script: Script,
  files: readonly string[] = ['/w/.devcontainer/compose.yml'],
): Promise<{read: ComposeModelRead; argv: string[][]; lines: string[]}> {
  const sink = new MemorySink();
  const argv: string[][] = [];
  const result = await composeModelOf(
    {
      runCompose: (each, options) => {
        argv.push([...each]);
        deepStrictEqual(options.cancellation.aborted, false);
        return Promise.resolve(script.outcome);
      },
      readText: file =>
        file in (script.files ?? {})
          ? Promise.resolve(script.files?.[file] ?? '')
          : Promise.reject(new Error('no such file')),
      logger: createLogger(sink, {minimumLevel: () => 'debug'}),
    },
    {
      files,
      workspaceFolder: '/w',
      cancellation: new AbortController().signal,
    },
  );
  return {read: result, argv, lines: sink.lines.map(line => line.message)};
}

/** A successful run that printed `stdout`. */
function printed(stdout: string): EngineRunOutcome {
  return {kind: 'ran', status: 0, stdout, stderr: ''};
}

describe('the Compose model of a configuration (F-0413, brief-compose §2.1)', () => {
  it('F-0413 AC-1: the model lists the services in the order of the output, with each build and volumes', async () => {
    const {read: result} = await read({
      outcome: printed(
        [
          'name: devcontainer',
          'services:',
          '  app:',
          '    build:',
          '      context: /w',
          '      dockerfile: Dockerfile.dev',
          '    volumes:',
          '      - type: bind',
          '        source: /w',
          '        target: /workspace',
          '  db:',
          '    image: postgres',
          '  tools:',
          '    build: ./tools',
        ].join('\n'),
      ),
    });
    deepStrictEqual(
      result.kind === 'model'
        ? {
            resolvedName: result.model.resolvedName,
            services: [...result.model.services],
          }
        : result,
      {
        resolvedName: 'devcontainer',
        services: [
          [
            'app',
            {
              build: {context: '/w', dockerfile: 'Dockerfile.dev'},
              volumes: [{type: 'bind', source: '/w', target: '/workspace'}],
            },
          ],
          ['db', {build: undefined, volumes: []}],
          [
            'tools',
            {build: {context: './tools', dockerfile: undefined}, volumes: []},
          ],
        ],
      },
    );
  });

  it('F-0413 AC-7: Compose gets the configuration’s files in order, each as -f, from the configuration’s folder', async () => {
    const {argv} = await read({outcome: printed('services:\n  app: {}\n')}, [
      '/w/.devcontainer/a.yml',
      '/w/.devcontainer/b.yml',
    ]);
    deepStrictEqual(argv, [
      [
        '-f',
        '/w/.devcontainer/a.yml',
        '-f',
        '/w/.devcontainer/b.yml',
        'config',
      ],
    ]);
  });

  it('F-0413 AC-66: for "dockerComposeFile": [] Compose is told the workspace folder as its project directory', async () => {
    const {argv} = await read({outcome: printed('services:\n  app: {}\n')}, []);
    deepStrictEqual(argv, [['--project-directory', '/w', 'config']]);
  });

  it('F-0413 AC-41: the declared name is the top-level name: of the last file that has one, and a file that cannot be read declares none', async () => {
    const {read: result} = await read(
      {
        outcome: printed('name: x\nservices:\n  app: {}\n'),
        files: {
          '/w/a.yml': 'name: first\nservices: {}\n',
          '/w/b.yml': 'name: second\n',
          '/w/c.yml': 'services: {}\n',
          '/w/d.yml': '- not a mapping\n',
          '/w/e.yml': 'name: [unclosed\n',
        },
      },
      [
        '/w/a.yml',
        '/w/b.yml',
        '/w/c.yml',
        '/w/d.yml',
        '/w/e.yml',
        '/w/missing.yml',
      ],
    );
    deepStrictEqual(
      result.kind === 'model' ? result.model.declaredName : result,
      'second',
    );
  });

  it('F-0413 AC-41: no file declares a name, so there is none and Compose’s own default is only the resolved one', async () => {
    const {read: result} = await read({
      outcome: printed('services:\n  app: {}\n'),
      files: {'/w/.devcontainer/compose.yml': 'services:\n  app: {}\n'},
    });
    deepStrictEqual(
      result.kind === 'model'
        ? [result.model.declaredName, result.model.resolvedName]
        : result,
      [undefined, undefined],
    );
  });

  it('F-0413 AC-14: a service that is not a mapping, a build with no context or a dockerfile that is not text, and volumes that are not a list, are read with their defaults', async () => {
    const {read: result} = await read({
      outcome: printed(
        'services:\n  odd: null\n  app:\n    build:\n      dockerfile: 5\n    volumes: nope\n',
      ),
    });
    deepStrictEqual(
      result.kind === 'model' ? [...result.model.services] : result,
      [
        ['odd', {build: undefined, volumes: []}],
        ['app', {build: {context: '.', dockerfile: undefined}, volumes: []}],
      ],
    );
  });

  it('F-0413 AC-53: a status other than 0 rejects the model with the first line of Compose’s error, which the lines holds whole', async () => {
    const {read: result, lines} = await read({
      outcome: {
        kind: 'ran',
        status: 1,
        stdout: '',
        stderr: 'yaml: line 3: mapping values are not allowed\nsecond line\n',
      },
    });
    deepStrictEqual(
      [result, lines],
      [
        {
          kind: 'rejected',
          detail: 'yaml: line 3: mapping values are not allowed',
        },
        [
          'Compose config ended with status 1: yaml: line 3: mapping values are not allowed\nsecond line',
        ],
      ],
    );
  });

  it('F-0413 AC-11: a status with no error text is named in the detail', async () => {
    const {read: result} = await read({
      outcome: {kind: 'ran', status: undefined, stdout: '', stderr: ' \n'},
    });
    deepStrictEqual(result, {
      kind: 'rejected',
      detail: 'Compose ended with status undefined',
    });
  });

  it('F-0413 AC-20: a Compose that cannot start rejects the model with the system’s message', async () => {
    const {read: result, lines} = await read({
      outcome: {kind: 'failed', detail: 'spawn docker ENOENT'},
    });
    deepStrictEqual(
      [result, lines],
      [
        {kind: 'rejected', detail: 'spawn docker ENOENT'},
        ['could not run Compose: spawn docker ENOENT'],
      ],
    );
  });

  it('F-0413 AC-13: an output that is not YAML, or has no services mapping, rejects the model', async () => {
    const outputs = ['a: [unclosed', '- just\n- a list\n', 'name: x\n'];
    const reads = [];
    for (const stdout of outputs) {
      reads.push((await read({outcome: printed(stdout)})).read);
    }
    deepStrictEqual(reads, [
      {kind: 'rejected', detail: 'the output of Compose is not YAML'},
      {kind: 'rejected', detail: 'the model has no services'},
      {kind: 'rejected', detail: 'the model has no services'},
    ]);
  });

  it('F-0413 AC-53 (R-26): the model’s text, interpolated values included, reaches the lines in no case', async () => {
    const logs: string[][] = [];
    for (const stdout of [
      `services:\n  app:\n    environment:\n      TOKEN: ${SECRET}\n`,
      `services: [${SECRET}\n`,
      `name: ${SECRET}\n`,
    ]) {
      logs.push((await read({outcome: printed(stdout)})).lines);
    }
    deepStrictEqual(
      logs.flat().filter(line => line.includes(SECRET)),
      [],
    );
  });
});
