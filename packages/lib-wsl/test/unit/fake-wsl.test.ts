import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {fakeWsl, utf16Output, utf8Output} from '../../src/testing/fake-wsl.ts';

const SPEC = {
  program: 'wsl.exe',
  programArguments: ['--exec', 'sh'],
  environment: {},
};

describe('D4f: the fake wsl.exe', () => {
  it('cw01 fake: encodes a management output as UTF-16LE after a byte-order mark', () => {
    deepStrictEqual(Array.from(utf16Output('A')), [0xff, 0xfe, 0x41, 0x00]);
  });

  it('cw01 fake: encodes a program output as UTF-8', () => {
    deepStrictEqual(Array.from(utf8Output('é')), [0xc3, 0xa9]);
  });

  it('cw01 fake: a start that fails without a code rejects without one', async () => {
    const fake = fakeWsl(() => ({
      kind: 'failsToStart',
      error: {message: 'no code'},
    }));
    const caught: unknown = await fake
      .spawner(SPEC)
      .catch((error: unknown) => error);
    deepStrictEqual(caught instanceof Error && 'code' in caught, false);
  });

  it('cw01 fake: a digest of an input with no prelude covers all of it', async () => {
    const fake = fakeWsl(() => ({kind: 'digestsInput'}));
    const handle = await fake.spawner(SPEC);
    const printed: string[] = [];
    handle.onOutput(chunk => {
      printed.push(Buffer.from(chunk).toString().trim());
    });
    const ended = new Promise<void>(resolve => {
      handle.onExit(() => {
        resolve();
      });
    });
    await handle.write(utf8Output('abc'));
    handle.endInput();
    await ended;
    deepStrictEqual(printed, [
      createHash('sha256').update('abc').digest('hex'),
    ]);
  });

  it('cw01 fake: a file that is not there reads as empty', async () => {
    const fake = fakeWsl(() => ({kind: 'exits', status: 0}));
    const pieces: Uint8Array[] = [];
    for await (const piece of fake.files.read('C:\\nothing')) {
      pieces.push(piece);
    }
    deepStrictEqual(
      pieces.map(piece => piece.length),
      [0],
    );
  });
});
