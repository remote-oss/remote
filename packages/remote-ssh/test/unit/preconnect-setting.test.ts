import {deepStrictEqual} from 'node:assert';
import {jsonOf} from './manifest.fixture.ts';

describe('the manifest of remote.SSH.preconnect (card connect-87)', () => {
  it('F-2108 AC-1: the setting has its type, default, tag, examples and description, with the two spaces', () => {
    const properties = (
      (jsonOf('package.json').contributes as {configuration: unknown})
        .configuration as {properties: Record<string, Record<string, unknown>>}
    ).properties;
    const setting = properties['remote.SSH.preconnect'] ?? {};
    const description = jsonOf('package.nls.json')[
      'setting.Preconnect.description'
    ] as string;
    deepStrictEqual(
      [
        setting.type,
        setting.default,
        setting.additionalProperties,
        setting.tags,
        setting.examples,
        setting.scope,
        setting.markdownDescription,
        description.includes('per-host configuration.  On Windows'),
      ],
      [
        ['string', 'object'],
        '',
        {type: 'string'},
        ['experimental'],
        [
          {
            myhost: '~/preconnect.sh',
            myhost2: 'C:\\Users\\user\\preconnect.ps1',
          },
          '~/preconnect.sh',
        ],
        undefined,
        '%setting.Preconnect.description%',
        true,
      ],
    );
  });
});
