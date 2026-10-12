import {deepStrictEqual} from 'node:assert';
import {parseCliServeError} from '../../src/index.ts';

describe('parseCliServeError (card ssh-08 table)', () => {
  it('a status error with an address and a status is a download failure', () => {
    deepStrictEqual(
      parseCliServeError(
        'StatusError(StatusError { url: "https://x/y.tar.gz", status_code: 404, body: "Not Found" })',
      ),
      {kind: 'download', url: 'https://x/y.tar.gz', status: 404},
    );
  });

  it('a variable that cannot be expanded is a template failure', () => {
    const message =
      'WrappedError(WrappedError { message: "cannot expand ${release} for commit abc in the download url template", original: "..." })';
    deepStrictEqual(parseCliServeError(message), {kind: 'template', message});
  });

  it('a download of another commit is a commit mismatch', () => {
    const message = 'error: the download is not commit abc, it is commit def';
    deepStrictEqual(parseCliServeError(message), {
      kind: 'commitMismatch',
      message,
    });
  });

  it('any other message is kept whole', () => {
    deepStrictEqual(parseCliServeError('something else entirely'), {
      kind: 'other',
      message: 'something else entirely',
    });
  });

  it('an address without a status is not a download failure', () => {
    const message = 'failed: url: "https://x/y.tar.gz" was refused';
    deepStrictEqual(parseCliServeError(message), {kind: 'other', message});
  });

  it('a status without an address is not a download failure', () => {
    const message = 'failed: status_code: 500';
    deepStrictEqual(parseCliServeError(message), {kind: 'other', message});
  });
});
