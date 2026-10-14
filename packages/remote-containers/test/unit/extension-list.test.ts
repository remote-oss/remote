import {deepStrictEqual} from 'node:assert';
import {
  configurationEntries,
  effectiveExtensions,
  settingEntries,
} from '../../src/extensions/extension-list.ts';

/** The merged configuration with these layers of `customizations.vscode`. */
function layersOf(...layers: unknown[]): Record<string, unknown> {
  return {customizations: {vscode: layers}};
}

/** The list for these layers and this setting, as the connector computes it. */
function listOf(layers: unknown[], setting?: unknown): string[] {
  return effectiveExtensions([
    ...configurationEntries(layersOf(...layers)),
    ...settingEntries(setting, undefined),
  ]);
}

describe('the extensions of a new container (card containers-16)', () => {
  it('F-0505 BR-1: the layers in order, then the setting', () => {
    deepStrictEqual(
      listOf([{extensions: ['img.a']}, {extensions: ['cfg.b']}], ['set.c']),
      ['img.a', 'cfg.b', 'set.c'],
    );
  });

  it("F-0505 AC-4: -id removes the image's id", () => {
    deepStrictEqual(
      listOf([{extensions: ['img.a']}, {extensions: ['-img.a']}]),
      [],
    );
  });

  it("F-0505 AC-6: -id in the configuration doesn't remove the setting's later id", () => {
    deepStrictEqual(listOf([{extensions: ['-x.y']}], ['x.y']), ['x.y']);
  });

  it('F-0505 AC-7: -id in the setting removes earlier ones', () => {
    deepStrictEqual(listOf([{extensions: ['x.y']}], ['-x.y']), []);
  });

  it('F-0505 AC-10: the last occurrence wins, with its suffix', () => {
    deepStrictEqual(effectiveExtensions(['x.y@1', 'x.y@2']), ['x.y@2']);
  });

  it('F-0505 AC-17: -X then X@v installs X@v', () => {
    deepStrictEqual(
      listOf([{extensions: ['x.y']}, {extensions: ['-x.y', 'x.y@3']}]),
      ['x.y@3'],
    );
  });

  it('F-0505 AC-24: X@v then -X installs nothing', () => {
    deepStrictEqual(effectiveExtensions(['x.y@1', '-x.y']), []);
  });

  it("F-0505 AC-29: the later source's pin wins, and moves to the end", () => {
    deepStrictEqual(effectiveExtensions(['x.y@4.9.3', 'z.w', 'x.y@3.0.1']), [
      'z.w',
      'x.y@3.0.1',
    ]);
  });

  it("F-0505 AC-25: the CLI's merge puts the top-level entries after the customization's, so the top-level one decides", () => {
    deepStrictEqual(
      [
        listOf([{extensions: ['x.y', '-x.y']}]),
        listOf([{extensions: ['-x.y', 'x.y']}]),
      ],
      [[], ['x.y']],
    );
  });

  it('F-0505 AC-30: removal is case-sensitive', () => {
    deepStrictEqual(
      listOf([
        {extensions: ['dbaeumer.vscode-eslint']},
        {extensions: ['-DBAEUMER.vscode-eslint']},
      ]),
      ['dbaeumer.vscode-eslint'],
    );
  });

  it('F-0505 AC-31: a version on a removal is ignored', () => {
    deepStrictEqual(
      listOf([{extensions: ['d.e']}, {extensions: ['-d.e@3.0.34']}]),
      [],
    );
  });

  it('F-0505 AC-32: other case is another entry', () => {
    deepStrictEqual(listOf([{extensions: ['d.e']}, {extensions: ['D.E@3']}]), [
      'd.e',
      'D.E@3',
    ]);
  });

  it('F-0505 AC-18: a removal of an unlisted id does nothing', () => {
    deepStrictEqual(effectiveExtensions(['-q.r', 'a.b']), ['a.b']);
  });

  it('F-0505 BR-7, AC-11, AC-12: nothing is validated', () => {
    deepStrictEqual(effectiveExtensions(['not-an-id', 'a.b@0.0.1']), [
      'not-an-id',
      'a.b@0.0.1',
    ]);
  });

  it('F-0505 BR-10: no sources give an empty list', () => {
    deepStrictEqual(listOf([]), []);
  });

  it('contracts: anything but string entries and object layers is skipped', () => {
    deepStrictEqual(
      configurationEntries(layersOf(1, {extensions: ['a.b', 2]}, 'x', null)),
      ['a.b'],
    );
  });

  it('contracts: a layer whose extensions is not a list gives nothing', () => {
    deepStrictEqual(
      configurationEntries(layersOf({extensions: 'a.b'}, {other: ['c.d']})),
      [],
    );
  });

  it('contracts: a missing or malformed customizations gives nothing', () => {
    deepStrictEqual(
      [
        configurationEntries(undefined),
        configurationEntries({customizations: []}),
        configurationEntries({customizations: {vscode: {}}}),
        configurationEntries({}),
      ],
      [[], [], [], []],
    );
  });

  it('F-0505 AC-27: the deprecated setting when the new one is unset', () => {
    deepStrictEqual(settingEntries(undefined, ['x.y']), ['x.y']);
  });

  it("F-0505 AC-28: the new setting wins, even when it's []", () => {
    deepStrictEqual(
      [settingEntries([], ['x.y']), settingEntries(['y.z'], ['x.y'])],
      [[], ['y.z']],
    );
  });

  it('contracts: a non-array setting gives nothing, and only its strings count', () => {
    deepStrictEqual(
      [
        settingEntries('x.y', undefined),
        settingEntries(undefined, undefined),
        settingEntries(['a.b', 3, null], undefined),
      ],
      [[], [], ['a.b']],
    );
  });
});
