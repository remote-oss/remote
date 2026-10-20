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

  it('F-0414 3.2, BR-6: the lockfile is written unless the user wrote false, also as text', () => {
    deepStrictEqual(
      [undefined, true, 'true', 0, false, 'false'].map(
        value => featureSettingsOf({}, value).lockfile,
      ),
      [true, true, true, true, false, false],
    );
  });
});
