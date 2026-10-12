import {deepStrictEqual} from 'node:assert';
import {
  FAILURE_TEMPLATES,
  reasonText,
  SERVER_SOURCE_TEMPLATES,
  textOfId,
  textOfTemplate,
} from '../../src/surfaces/failure-strings.ts';

function marked(template: string): string {
  return `<${template}>`;
}

describe('the texts of the failure dialog and the progress', () => {
  it('F-2304, F-2601: the table holds the ids of the card and of the classifier reasons', () => {
    deepStrictEqual(Object.keys(FAILURE_TEMPLATES), [
      'S014',
      'S015',
      'S022',
      'S027',
      'S029',
      'S030',
      'S031',
      'S032',
      'S041',
      'S044',
      'S067',
      'S073',
      'S079',
      'S082',
      'S084',
      'S089',
      'S092',
      'S094',
      'S095',
      'S097',
      'S107',
      'S111',
      'S117',
      'S119',
      'S120',
      'S121',
      'S122',
      'S129',
      'S130',
      'S137',
      'S140',
      'S142',
      'S158',
    ]);
  });

  it('F-2603 S094: a classifier reason has its text', () => {
    deepStrictEqual(FAILURE_TEMPLATES.S094, 'Network is unreachable');
  });

  it('F-2601: a text is translated before its values are put in', () => {
    deepStrictEqual(
      textOfId('S030', () => 'Verbindung zu "{0}" nicht möglich', ['box']),
      'Verbindung zu "box" nicht möglich',
    );
  });

  it('F-2601: a text without values is the translated template', () => {
    deepStrictEqual(textOfId('S117', marked), '<Retry>');
  });

  it('F-3902 rule 8: a template without an id is translated and filled', () => {
    deepStrictEqual(
      textOfTemplate(
        SERVER_SOURCE_TEMPLATES.invalidServerTemplate,
        template => template,
        ['a', 'b', 'c', 'd'],
      ),
      'The value of b is not a usable server download URL template: d.',
    );
  });

  it('F-2601: a reason that is text gives the text as it is', () => {
    deepStrictEqual(
      reasonText({text: 'Connection refused'}, marked),
      'Connection refused',
    );
  });

  it('F-2601: a reason that is empty text gives nothing', () => {
    deepStrictEqual(reasonText({text: ''}, marked), undefined);
  });

  it('F-2601: a reason that is a known id gives its translated template', () => {
    deepStrictEqual(
      reasonText({id: 'S027'}, marked),
      '<Connecting was canceled>',
    );
  });

  it('F-2601: a reason that is an id without a template gives nothing', () => {
    deepStrictEqual(reasonText({id: 'S999'}, marked), undefined);
  });

  it('F-2205 7.E1: the host beginning failure names the character', () => {
    deepStrictEqual(
      reasonText({id: 'S119', values: ['-']}, template => template),
      'SSH host name cannot begin with -',
    );
  });

  it('F-2205 7.E5, R-93: the host character failure names a control character', () => {
    deepStrictEqual(
      reasonText({id: 'S120', values: ['U+000A']}, template => template),
      'SSH host name cannot include the character U+000A',
    );
  });

  it('F-2601: an id named like a member of Object gives nothing', () => {
    deepStrictEqual(reasonText({id: 'constructor'}, marked), undefined);
  });

  it('F-2104 7.E3 b: a reason string resolves its nested value in turn', () => {
    deepStrictEqual(
      reasonText(
        {id: 'S067', values: [{id: 'S089', values: []}]},
        template => template,
      ),
      'Error establishing tunnel (Max wait time exhausted).',
    );
  });

  it('F-2104 7.E1: the tunnel texts nest three deep, the range given as literals', () => {
    deepStrictEqual(
      reasonText(
        {
          id: 'S067',
          values: [
            {id: 'S073', values: [{id: 'S095', values: ['41060', '41061']}]},
          ],
        },
        template => template,
      ),
      "Error establishing tunnel (Failed to find a free local port: No free ports in specified range '41060-41061'.  Remove or update the 'Preferred Local Port Range' setting and try again.).",
    );
  });

  it('contracts §3.2: a literal value that equals an id is inserted as it is', () => {
    deepStrictEqual(
      reasonText({id: 'S073', values: ['S089']}, template => template),
      'Failed to find a free local port: S089',
    );
  });

  it('contracts §3.2: a nested id without a template gives nothing', () => {
    deepStrictEqual(
      reasonText(
        {id: 'S067', values: [{id: 'S999', values: []}]},
        template => template,
      ),
      undefined,
    );
  });

  it('contracts §3.2: a reason string whose own id has no template gives nothing', () => {
    deepStrictEqual(
      reasonText({id: 'S999', values: []}, template => template),
      undefined,
    );
  });
});
