import {deepStrictEqual} from 'node:assert';
import {writeAttachConfiguration} from '../../src/attach/config-writer.ts';
import {fakePortsOf} from './configuration-edit.fixture.ts';

const STORAGE = '/store';

/** Editor ports whose disk holds `files`, with `tabs` open as documents, recording what is written. */
function portsOf(
  files: Record<string, string>,
  tabs: Record<string, string> = {},
): ReturnType<typeof fakePortsOf> {
  return fakePortsOf({
    files,
    tabs: Object.fromEntries(
      Object.entries(tabs).map(([file, text]) => [file, {text, dirty: false}]),
    ),
  });
}

const SET: (current: string) => string = current => `${current.trim()}!`;

describe('the attach file writer (card containers-206, brief-attach §5)', () => {
  it('F-0809 (c206-writer-files): the image’s file and the name’s file are written below the storage through the seam, the image’s with its reference encoded', async () => {
    const image = portsOf({});
    const name = portsOf({});
    const results = [
      await writeAttachConfiguration(
        STORAGE,
        {image: 'ghcr.io/o/i:1'},
        SET,
        image.ports,
      ),
      await writeAttachConfiguration(STORAGE, {name: 'web'}, SET, name.ports),
    ];
    deepStrictEqual(
      [results, image.log, name.log],
      [
        [
          {kind: 'written', durable: true},
          {kind: 'written', durable: true},
        ],
        [
          'write /store/imageConfigs/.u1.tmp "{}!"',
          'rename /store/imageConfigs/.u1.tmp /store/imageConfigs/ghcr.io%2fo%2fi%3a1.json',
        ],
        [
          'write /store/nameConfigs/.u1.tmp "{}!"',
          'rename /store/nameConfigs/.u1.tmp /store/nameConfigs/web.json',
        ],
      ],
    );
  });

  it('F-0809 (c206-writer-existing): a file that exists is changed from its text, and an empty one starts from {}', async () => {
    const existing = portsOf({'/store/nameConfigs/web.json': '{"a": 1}\n'});
    const empty = portsOf({'/store/nameConfigs/web.json': '  \n'});
    await writeAttachConfiguration(STORAGE, {name: 'web'}, SET, existing.ports);
    await writeAttachConfiguration(STORAGE, {name: 'web'}, SET, empty.ports);
    deepStrictEqual(
      [existing.log[1], empty.log[1]],
      [
        'write /store/nameConfigs/.u1.tmp "{\\"a\\": 1}!"',
        'write /store/nameConfigs/.u1.tmp "{}!"',
      ],
    );
  });

  it('F-0809 (c206-writer-open): an attach file a tab holds is edited in the buffer, not written', async () => {
    const scene = portsOf(
      {'/store/nameConfigs/web.json': '{"a": 1}'},
      {'/store/nameConfigs/web.json': '{"a": 2}'},
    );
    const result = await writeAttachConfiguration(
      STORAGE,
      {name: 'web'},
      SET,
      scene.ports,
    );
    deepStrictEqual(
      [result, scene.log],
      [
        {kind: 'inBuffer', durable: false},
        ['edit /store/nameConfigs/web.json "{\\"a\\": 2}!"'],
      ],
    );
  });

  it('F-0809 (c206-writer-bad-name): a name that is empty, a dot, a path, an absolute path or an encoded slash is refused, whichever kind of file, and nothing is written', async () => {
    const bad = [
      '',
      '.',
      '..',
      '../x',
      'a/b',
      '/etc/passwd',
      'a\\b',
      'x%2fy',
      'x%2Fy',
      'a\0b',
      'a:b',
      'web:stream',
    ];
    const outcomes: unknown[] = [];
    const logs: string[] = [];
    for (const name of bad) {
      const scene = portsOf({});
      outcomes.push(
        await writeAttachConfiguration(STORAGE, {name}, SET, scene.ports),
      );
      logs.push(...scene.log);
    }
    const imageScene = portsOf({});
    for (const image of ['', '.', '..', 'x%2fy']) {
      outcomes.push(
        await writeAttachConfiguration(STORAGE, {image}, SET, imageScene.ports),
      );
    }
    deepStrictEqual(
      [outcomes, logs, imageScene.log],
      [
        Array<unknown>(bad.length + 4).fill({
          kind: 'refused',
          reason: 'badName',
        }),
        [],
        [],
      ],
    );
  });
});
