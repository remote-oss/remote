import {deepStrictEqual} from 'node:assert';
import {featureSettingsOf} from '../../src/connect/feature-settings.ts';

describe('the Feature settings (card containers-93)', () => {
  it('F-0414 3.2: an object of default Features is kept, and anything else is none', () => {
    const features = {'ghcr.io/devcontainers/features/node:1': {version: '20'}};
    deepStrictEqual(
      [features, undefined, null, [1], 'node', 3].map(
        value => featureSettingsOf(value, undefined).defaultFeatures,
      ),
      [features, {}, {}, {}, {}, {}],
    );
  });

  it('F-0414 BR-14: a default whose id equals a key of features ignoring case is dropped, with the same options or other ones, and the rest are kept', () => {
    const same = {'ghcr.io/o/f/a:1': {level: 'high'}};
    const other = {'ghcr.io/o/f/a:1': {level: 'low'}};
    const kept = {'ghcr.io/o/f/b:1': {}};
    deepStrictEqual(
      [
        featureSettingsOf({...same, ...kept}, true, {
          'GHCR.IO/O/F/A:1': same['ghcr.io/o/f/a:1'],
        }).defaultFeatures,
        featureSettingsOf({...other, ...kept}, true, {
          'GHCR.IO/O/F/A:1': {level: 'high'},
        }).defaultFeatures,
        featureSettingsOf(other, true, {'ghcr.io/o/f/a:1': {}}).defaultFeatures,
      ],
      [kept, kept, {}],
    );
  });

  it('F-0414 BR-14: with no features, or features that is not an object, every default is kept', () => {
    const defaults = {'ghcr.io/o/f/a:1': {}};
    deepStrictEqual(
      [undefined, null, [], 'x', {}].map(
        value => featureSettingsOf(defaults, true, value).defaultFeatures,
      ),
      [defaults, defaults, defaults, defaults, defaults],
    );
  });

  it('F-0414 3.2, BR-6: the lockfile is written unless the user wrote false, also as text', () => {
    deepStrictEqual(
      [undefined, true, 'true', 0, false, 'false'].map(
        value => featureSettingsOf({}, value).lockfile,
      ),
      [true, true, true, true, false, false],
    );
  });
});
