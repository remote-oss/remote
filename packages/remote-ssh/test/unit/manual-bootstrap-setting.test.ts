import {deepStrictEqual} from 'node:assert';
import {jsonOf} from './manifest.fixture.ts';

describe('remote.SSH.localServerDownload in the manifest (card #2946, F-2406 3.3)', () => {
  it('F-2406 AC-18: the manifest does not declare "manual-bootstrap", so core flags it in settings.json and the Settings editor shows the default', () => {
    const properties = (
      (jsonOf('package.json').contributes as {configuration: unknown})
        .configuration as {properties: Record<string, Record<string, unknown>>}
    ).properties;
    const setting = properties['remote.SSH.localServerDownload'] ?? {};
    deepStrictEqual(
      {values: setting.enum, shown: setting.default},
      {values: ['auto', 'always', 'off'], shown: 'auto'},
    );
  });
});
