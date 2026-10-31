import {deepStrictEqual} from 'node:assert';
import {registeredNameOf} from '../../src/explorer/view-name.ts';

/** A reader over the files in `files`. */
function readerOf(files: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    read: (file: string) => {
      asked.push(file);
      return files[file];
    },
  };
}

describe('the name a view was registered with (card containers-109)', () => {
  it('F-0903 AC-29: the name comes from the file of the editor’s language, written in lower case, and the plain file is not read', () => {
    const {read, asked} = readerOf({
      'package.nls.pt-br.json': '{"views.detailsContainers.name": "Detalhes"}',
      'package.nls.json': '{"views.detailsContainers.name": "Details"}',
    });
    deepStrictEqual(
      [registeredNameOf(read, 'pt-BR', 'detailsContainers'), asked],
      ['Detalhes', ['package.nls.pt-br.json']],
    );
  });

  it('F-0903 AC-29: a language with no file, a file with no such string and a file that is no JSON object fall back to the plain file', () => {
    const names = [
      {},
      {'package.nls.de.json': '{"other": "x"}'},
      {'package.nls.de.json': '[1]'},
      {'package.nls.de.json': 'not json'},
      {'package.nls.de.json': '{"views.detailsContainers.name": 3}'},
    ].map(files =>
      registeredNameOf(
        readerOf({
          ...files,
          'package.nls.json':
            '{"views.detailsContainers.name": "Details (Containers)"}',
        }).read,
        'de',
        'detailsContainers',
      ),
    );
    deepStrictEqual(names, Array<string>(5).fill('Details (Containers)'));
  });

  it('F-0903 AC-29: with no file that names the view there is no name', () => {
    deepStrictEqual(
      registeredNameOf(readerOf({}).read, 'en', 'detailsContainers'),
      undefined,
    );
  });
});
