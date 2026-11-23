import {deepStrictEqual} from 'node:assert';
import {localBootstrapHint} from '../../src/diagnostics/local-bootstrap-hint.ts';

describe('the hint of a manual bootstrap that could not start (F-2406 BR-9, 7.E1)', () => {
  it('BR-9 (card #2997): LocalBootstrapFailed, STR:S087 as the message, the reason as the details, and the six steps in the order of 7.E1', () => {
    deepStrictEqual(
      localBootstrapHint(
        'Expected tarball at local path /home/me/x.tar.gz',
        text => text,
      ),
      {
        status: 'LocalBootstrapFailed',
        message:
          'Local bootstrap of the VS Code Server failed. This is an advanced feature for use in environments with limited internet acccess.',
        details: {text: 'Expected tarball at local path /home/me/x.tar.gz'},
        mitigations: [
          {
            id: 'S016',
            values: ['remote.SSH.localServerDownload', 'auto'],
          },
          {id: 'S036', values: ['remote.SSH.useExecServer']},
          {id: 'S040', values: []},
          {id: 'S106', values: []},
          {id: 'S051', values: ['scp']},
          {id: 'S124', values: []},
        ],
        resources: [],
      },
    );
  });
});
