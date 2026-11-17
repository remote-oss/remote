import {deepStrictEqual} from 'node:assert';
import {localDownloadHint} from '../../src/diagnostics/local-download-hint.ts';

describe('the hint of a download the client cannot make (card #2708)', () => {
  it('F-2602 AC-17: the status as the message and the failure’s own words as the details, with no mitigations and no resources', () => {
    const hint = localDownloadHint('Failed to fetch', template => template);
    deepStrictEqual(
      [
        hint.status,
        hint.message,
        hint.mitigations,
        hint.resources,
        hint.details,
      ],
      [
        'LocalDownloadFailed',
        'Error: LocalDownloadFailed',
        [],
        [],
        {text: 'Failed to download VS Code Server (Failed to fetch)'},
      ],
    );
  });

  it('F-2405 AC-12: the reason of an HTTP error status is the message’s value', () => {
    deepStrictEqual(
      localDownloadHint('Server returned 404', template => template).details,
      {text: 'Failed to download VS Code Server (Server returned 404)'},
    );
  });
});
