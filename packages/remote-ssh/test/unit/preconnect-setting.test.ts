import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const FOLDER = path.join(import.meta.dirname, '..', '..');

/** The JSON file of the package folder. */
function jsonOf(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FOLDER, file), 'utf8')) as Record<
    string,
    unknown
  >;
}

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
