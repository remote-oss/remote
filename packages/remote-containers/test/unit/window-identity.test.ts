import {deepStrictEqual} from 'node:assert';
import {workspaceSuffixOf} from '../../src/connect/window-identity.ts';

function suffix(name: string | undefined, context?: string): string {
  return workspaceSuffixOf({name, context}, template => template);
}

describe('the suffix of a dev container window (card containers-08)', () => {
  it('F-0504 AC-1, AC-3: the name, then no name, then an empty name', () => {
    deepStrictEqual(
      [suffix('Proj'), suffix(undefined), suffix('')],
      ['Dev Container: Proj', 'Dev Container', 'Dev Container'],
    );
  });

  it('F-0504 AC-29, AC-30, AC-22: spaces count as a name, and the name is kept as it is', () => {
    deepStrictEqual(
      [suffix('   '), suffix('weird ] name [test'), suffix('{1} {0}')],
      [
        'Dev Container:    ',
        'Dev Container: weird ] name [test',
        'Dev Container: {1} {0}',
      ],
    );
  });

  it('F-0504 AC-31: a context follows the name, or the plain text when there is no name', () => {
    deepStrictEqual(
      [suffix('Ctx Test', 'f0504ctx'), suffix(undefined, 'f0504ctx')],
      ['Dev Container: Ctx Test @ f0504ctx', 'Dev Container @ f0504ctx'],
    );
  });

  it('F-0504 BR-2: before the first connect there is no identity, and the text is plain', () => {
    deepStrictEqual(
      workspaceSuffixOf(undefined, template => template),
      'Dev Container',
    );
  });

  it('F-0504 BR-1: the templates are translated', () => {
    deepStrictEqual(
      workspaceSuffixOf({name: 'P', context: undefined}, template =>
        template.replace('Dev Container', 'Conteneur'),
      ),
      'Conteneur: P',
    );
  });
});
