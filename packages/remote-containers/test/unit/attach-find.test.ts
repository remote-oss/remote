import {deepStrictEqual} from 'node:assert';
import {alpineStep} from '../../src/attach/alpine.ts';
import {
  findAttachedContainer,
  type IdRecord,
  startArguments,
  startAttachedContainer,
} from '../../src/attach/find.ts';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';

const NEVER = new AbortController().signal;
const PAYLOAD = '7b7d';

/** `docker inspect`'s JSON for a container. */
function inspectedJson(name: string, containerId: string, state = 'running') {
  return JSON.stringify([
    {
      // eslint-disable-next-line id-length -- the engine's own member is named Id
      Id: containerId,
      Name: `/${name}`,
      Created: '2026-11-03T10:00:00Z',
      Config: {Image: 'alpine:latest'},
      State: {Status: state},
    },
  ]);
}

function exits(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}

/** An engine that answers each command by the first of `answers` whose key its arguments start with. */
function engineOf(answers: Record<string, EngineRunOutcome>): {
  engine: EngineHost;
  commands: string[];
} {
  const commands: string[] = [];
  return {
    commands,
    engine: {
      // eslint-disable-next-line id-length -- the port's method is named run
      run: argv => {
        const command = argv.join(' ');
        commands.push(command);
        const key = Object.keys(answers).find(each => command.startsWith(each));
        const answer = key === undefined ? undefined : answers[key];
        return Promise.resolve(answer ?? exits(1));
      },
      spawn: () => Promise.reject(new Error('never spawned')),
    },
  };
}

/** A record that holds `recorded` for every payload and remembers what was written. */
function recordOf(recorded?: string): IdRecord & {written: string[]} {
  const written: string[] = [];
  return {
    written,
    read: () => recorded,
    write: (payload, containerId) => {
      written.push(`${payload}=${containerId}`);
      return Promise.resolve();
    },
  };
}

describe('finding the container of an attached payload (card containers-163, steps 1 and 2)', () => {
  it('F-0601 BR-8: the name that resolves wins, with the slash taken off, and the record is not read', async () => {
    const {engine, commands} = engineOf({
      'inspect --type container web': exits(0, inspectedJson('web', 'a1')),
    });
    const found = await findAttachedContainer(
      engine,
      recordOf('old'),
      PAYLOAD,
      '/web',
      NEVER,
    );
    deepStrictEqual(
      [
        found.kind === 'found' && [found.container.id, found.viaRecord],
        commands,
      ],
      [['a1', false], ['inspect --type container web']],
    );
  });

  it('F-0601 AC-61: a name that does not resolve falls back on the recorded id, which finds the renamed container', async () => {
    const {engine, commands} = engineOf({
      'inspect --type container web': exits(1),
      'inspect --type container a1': exits(0, inspectedJson('renamed', 'a1')),
    });
    const found = await findAttachedContainer(
      engine,
      recordOf('a1'),
      PAYLOAD,
      '/web',
      NEVER,
    );
    deepStrictEqual(
      [
        found.kind === 'found' && [found.container.name, found.viaRecord],
        commands,
      ],
      [
        ['renamed', true],
        ['inspect --type container web', 'inspect --type container a1'],
      ],
    );
  });

  it('F-0601 7.E3: a name and a record that both fail, or a name and no record, find nothing', async () => {
    const {engine} = engineOf({});
    deepStrictEqual(
      [
        await findAttachedContainer(
          engine,
          recordOf('a1'),
          PAYLOAD,
          '/web',
          NEVER,
        ),
        await findAttachedContainer(engine, recordOf(), PAYLOAD, '/web', NEVER),
      ],
      [{kind: 'missing'}, {kind: 'missing'}],
    );
  });

  it('F-0601 7.E6: a paused container is unpaused and any other is started, and a failing command says so', async () => {
    const paused = await findAttachedContainer(
      engineOf({inspect: exits(0, inspectedJson('web', 'a1', 'paused'))})
        .engine,
      recordOf(),
      PAYLOAD,
      '/web',
      NEVER,
    );
    const exited = await findAttachedContainer(
      engineOf({inspect: exits(0, inspectedJson('web', 'a1', 'exited'))})
        .engine,
      recordOf(),
      PAYLOAD,
      '/web',
      NEVER,
    );
    if (paused.kind !== 'found' || exited.kind !== 'found') {
      throw new Error('the containers were found');
    }
    const works = engineOf({'unpause a1': exits(0), 'start a1': exits(0)});
    const broken = engineOf({
      'start a1': {kind: 'failed', detail: 'no engine'},
    });
    deepStrictEqual(
      [
        startArguments(paused.container),
        startArguments(exited.container),
        await startAttachedContainer(works.engine, paused.container, NEVER),
        await startAttachedContainer(works.engine, exited.container, NEVER),
        await startAttachedContainer(broken.engine, exited.container, NEVER),
        await startAttachedContainer(
          engineOf({'start a1': exits(1)}).engine,
          exited.container,
          NEVER,
        ),
      ],
      [['unpause', 'a1'], ['start', 'a1'], true, true, false, false],
    );
  });
});

describe('the Alpine step of an attached connect (card containers-163, step 4)', () => {
  const RELEASE =
    'exec --user root c1 grep -Eq ^ID="?alpine"?$ /etc/os-release';
  const INFO = 'exec --user root c1 apk info -e libstdc++';

  it('F-0601 AC-50: a container that is not Alpine, or has no os-release, is left alone with one command', async () => {
    const plain = engineOf({[RELEASE]: exits(1)});
    const absent = engineOf({[RELEASE]: exits(2)});
    deepStrictEqual(
      [
        await alpineStep(plain.engine, 'c1', NEVER),
        plain.commands.length,
        await alpineStep(absent.engine, 'c1', NEVER),
      ],
      ['notAlpine', 1, 'notAlpine'],
    );
  });

  it('F-0601 AC-50: an Alpine container that has libstdc++ gets nothing more', async () => {
    const {engine, commands} = engineOf({
      [RELEASE]: exits(0),
      [INFO]: exits(0),
    });
    deepStrictEqual(
      [await alpineStep(engine, 'c1', NEVER), commands.length],
      ['present', 2],
    );
  });

  it('F-0601 AC-50: an Alpine container without it gets apk update and apk add, as root, in that order', async () => {
    const {engine, commands} = engineOf({
      [RELEASE]: exits(0),
      [INFO]: exits(1),
      'exec --user root c1 apk update': exits(0),
      'exec --user root c1 apk add libstdc++': exits(0),
    });
    deepStrictEqual(
      [await alpineStep(engine, 'c1', NEVER), commands.slice(2)],
      [
        'installed',
        [
          'exec --user root c1 apk update',
          'exec --user root c1 apk add libstdc++',
        ],
      ],
    );
  });

  it('F-0601 AC-52: a failing update or add, and an engine that cannot run a command, fail the step', async () => {
    const base = {[RELEASE]: exits(0), [INFO]: exits(1)};
    deepStrictEqual(
      [
        await alpineStep(
          engineOf({...base, 'exec --user root c1 apk update': exits(1)})
            .engine,
          'c1',
          NEVER,
        ),
        await alpineStep(
          engineOf({
            ...base,
            'exec --user root c1 apk update': exits(0),
            'exec --user root c1 apk add': exits(1),
          }).engine,
          'c1',
          NEVER,
        ),
        await alpineStep(
          engineOf({[RELEASE]: {kind: 'failed', detail: 'down'}}).engine,
          'c1',
          NEVER,
        ),
      ],
      ['failed', 'failed', 'failed'],
    );
  });
});
