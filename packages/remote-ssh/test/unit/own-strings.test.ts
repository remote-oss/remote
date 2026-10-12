import {deepStrictEqual, throws} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {OWN_TEMPLATES, ownText} from '../../src/surfaces/own-strings.ts';

const BUNDLES = path.join(import.meta.dirname, '..', '..', 'l10n');

function same(template: string): string {
  return template;
}

function german(template: string): string {
  return template === 'SSH: {0}' ? 'SSH-Host: {0}' : template;
}

describe('the strings that are ours alone', () => {
  it('F-2502 BR-2: the label prefix fills the host label', () => {
    deepStrictEqual(
      ownText({id: 'sshLabelPrefix', values: ['dev']}, same),
      'SSH: dev',
    );
  });

  it('F-2206 AC-2: the picker placeholder fills the host', () => {
    deepStrictEqual(
      ownText({id: 'platformPickPlaceholder', values: ['box']}, same),
      'Select the platform of the remote host "box"',
    );
  });

  it('F-3902 rule 8: the template is translated, then filled', () => {
    deepStrictEqual(
      ownText({id: 'sshLabelPrefix', values: ['dev']}, german),
      'SSH-Host: dev',
    );
  });

  it('R-29: an id this table lacks throws naming it', () => {
    throws(
      () => ownText({id: 'nothing', values: []}, same),
      /no template for the string id nothing/,
    );
  });

  it('string tables: every template of the table is a key of the default bundle', () => {
    const bundle = JSON.parse(
      readFileSync(path.join(BUNDLES, 'bundle.l10n.json'), 'utf8'),
    ) as Record<string, string>;
    deepStrictEqual(
      Object.values(OWN_TEMPLATES).every(template =>
        Object.hasOwn(bundle, template),
      ),
      true,
    );
  });
});
