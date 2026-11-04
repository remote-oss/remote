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

/** The change the rows make: the text, trimmed, with an exclamation mark. */
function trimmedBang(current: string): string {
  return `${current.trim()}!`;
}

describe('the attach file writer (card containers-206, brief-attach §5)', () => {
  it('F-0809 (c206-writer-files): the image’s file and the name’s file are written below the storage through the seam, the image’s with its reference encoded', async () => {
    const image = portsOf({});
    const name = portsOf({});
    const results = [
      await writeAttachConfiguration(
        STORAGE,
        {image: 'ghcr.io/o/i:1'},
        trimmedBang,
        image.ports,
      ),
      await writeAttachConfiguration(
        STORAGE,
        {name: 'web'},
        trimmedBang,
        name.ports,
      ),
    ];
    deepStrictEqual(
      [results, image.calls, name.calls],
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
    await writeAttachConfiguration(
      STORAGE,
      {name: 'web'},
      trimmedBang,
      existing.ports,
    );
    await writeAttachConfiguration(
      STORAGE,
      {name: 'web'},
      trimmedBang,
      empty.ports,
    );
    deepStrictEqual(
      [existing.calls[1], empty.calls[1]],
      [
        'write /store/nameConfigs/.u1.tmp "{\\"a\\": 1}!"',
        'write /store/nameConfigs/.u1.tmp "{}!"',
      ],
    );
  });

  it('F-0809 (c206-writer-open): an attach file a editorTab holds is edited in the buffer, not written', async () => {
    const scene = portsOf(
      {'/store/nameConfigs/web.json': '{"a": 1}'},
      {'/store/nameConfigs/web.json': '{"a": 2}'},
    );
    const result = await writeAttachConfiguration(
      STORAGE,
      {name: 'web'},
      trimmedBang,
      scene.ports,
    );
    deepStrictEqual(
      [result, scene.calls],
      [
        {kind: 'inBuffer', durable: false},
        ['edit /store/nameConfigs/web.json "{\\"a\\": 2}!"'],
      ],
    );
  });

  it('F-0809 (c206-writer-bad-name): a name that is empty, a dot, a path, an absolute path or an encoded slash is refused, whichever kind of file, and nothing is written', async () => {
    const refusedNames = [
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
    for (const name of refusedNames) {
      const scene = portsOf({});
      outcomes.push(
        await writeAttachConfiguration(
          STORAGE,
          {name},
          trimmedBang,
          scene.ports,
        ),
      );
      logs.push(...scene.calls);
    }
    const imageScene = portsOf({});
    for (const image of ['', '.', '..', 'x%2fy']) {
      outcomes.push(
        await writeAttachConfiguration(
          STORAGE,
          {image},
          trimmedBang,
          imageScene.ports,
        ),
      );
    }
    deepStrictEqual(
      [outcomes, logs, imageScene.calls],
      [
        Array<unknown>(refusedNames.length + 4).fill({
          kind: 'refused',
          reason: 'badName',
        }),
        [],
        [],
      ],
    );
  });
});
