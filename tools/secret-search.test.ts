import {deepStrictEqual} from 'node:assert';
import {mkdirSync, symlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {filesHolding} from './secret-search.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('the secret search of the client (card tooling-34)', () => {
  it('finds the files that hold a value at any depth, in text or bytes, follows no link, and takes only what the filter accepts', () => {
    const workspace = new TemporaryWorkspace('secrets');
    try {
      const root = workspace.root;
      mkdirSync(path.join(root, 'place', 'deep', 'deeper'), {recursive: true});
      writeFileSync(path.join(root, 'place', 'settings.json'), '{"a": 1}');
      writeFileSync(
        path.join(root, 'place', 'deep', 'deeper', 'state.vscdb'),
        Buffer.concat([Buffer.from([0, 255]), Buffer.from('Xs3cretX')]),
      );
      writeFileSync(
        path.join(root, 'place', 'deep', 'main.log'),
        'code 123456\n',
      );
      writeFileSync(path.join(root, 'outside.txt'), 's3cret');
      symlinkSync(
        path.join(root, 'outside.txt'),
        path.join(root, 'place', 'link'),
      );
      deepStrictEqual(
        [
          filesHolding(['s3cret', '123456'], path.join(root, 'place')),
          filesHolding(['123456'], path.join(root, 'place'), file =>
            file.endsWith('.vscdb'),
          ),
          filesHolding(['s3cret'], path.join(root, 'outside.txt')),
          filesHolding(['s3cret'], path.join(root, 'missing')),
          filesHolding(['absent'], path.join(root, 'place')),
        ],
        [
          [
            path.join(root, 'place', 'deep', 'deeper', 'state.vscdb'),
            path.join(root, 'place', 'deep', 'main.log'),
          ],
          [],
          [path.join(root, 'outside.txt')],
          [],
          [],
        ],
      );
    } finally {
      workspace.remove();
    }
  });
});
