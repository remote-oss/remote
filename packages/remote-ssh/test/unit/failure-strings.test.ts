import {deepStrictEqual} from 'node:assert';
import {busyRangeReason} from '../../src/pipeline/port-choice.ts';
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
  it("F-2403: the download failure text is the extension's own", () => {
    deepStrictEqual(
      FAILURE_TEMPLATES.S043,
      'Downloading VS Code Server failed. Please try again later.',
    );
  });

  it("F-2403: the install failure text is the extension's own", () => {
    deepStrictEqual(
      FAILURE_TEMPLATES.S075,
      'Failed to install the VS Code Server',
    );
  });

  it('F-2308 7.E7: the refused trust has its text', () => {
    deepStrictEqual(
      reasonText({id: 'trustRefused'}, text => text),
      'Got bad result from install script',
    );
  });

  it('F-2104 7.E1: the busy preferred range has the tunnel text with the search and the range, two spaces kept', () => {
    deepStrictEqual(
      reasonText(busyRangeReason({first: 41060, last: 41061}), text => text),
      "Error establishing tunnel (Failed to find a free local port: No free ports in specified range '41060-41061'.  Remove or update the 'Preferred Local Port Range' setting and try again.).",
    );
  });

  it('F-2102: the waiting stage text is the one the spec gives', () => {
    deepStrictEqual(
      FAILURE_TEMPLATES.S157,
      'Waiting for other windows to connect',
    );
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
