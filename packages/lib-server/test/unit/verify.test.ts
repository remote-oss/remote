import {deepStrictEqual} from 'node:assert';
import type {ClientFilePort, DownloadFacts} from '../../src/index.ts';
import {verifyArchive} from '../../src/transfer/verify.ts';

const FILE = '/client/tmp/server.tar.gz';

const DIGEST = 'ab12cd';

/** A client with one file of this size and digest; the other port operations are not used by the check. */
function files(size: number, digest: string): ClientFilePort {
  return {
    remove: () => Promise.resolve(),
    exists: () => Promise.resolve(true),
    size: () => Promise.resolve(size),
    sha256: () => Promise.resolve(digest),
    rename: () => Promise.resolve({kind: 'renamed'}),
  };
}

function verdictOf(
  facts: DownloadFacts,
  rules: Parameters<typeof verifyArchive>[2],
  size = 100,
  digest = DIGEST,
): ReturnType<typeof verifyArchive> {
  return verifyArchive(FILE, facts, rules, files(size, digest));
}

describe('verifyArchive (the verification rules of the policy record, in order)', () => {
  it('F-6301.BR-6: a digest equal to the announced one is verified', async () => {
    deepStrictEqual(
      await verdictOf({announcedSha256: DIGEST}, ['headerHash']),
      'verified',
    );
  });

  it('F-6301.BR-6: the announced digest is compared in any letter case', async () => {
    deepStrictEqual(
      await verdictOf({announcedSha256: DIGEST.toUpperCase()}, ['headerHash']),
      'verified',
    );
  });

  it('F-6301.BR-6: a different digest is a checksum mismatch', async () => {
    deepStrictEqual(
      await verdictOf({announcedSha256: 'ffff'}, ['headerHash']),
      'checksumMismatch',
    );
  });

  it('F-6301.BR-6: a size equal to the announced length is verified', async () => {
    deepStrictEqual(
      await verdictOf({announcedLength: 100}, ['lengthOnly']),
      'verified',
    );
  });

  it('F-6301.BR-6: a different size is a length mismatch', async () => {
    deepStrictEqual(
      await verdictOf({announcedLength: 101}, ['lengthOnly']),
      'lengthMismatch',
    );
  });

  it('F-6301.BR-6: the first rule whose facts are present decides, and the later ones are not asked', async () => {
    deepStrictEqual(
      await verdictOf({announcedSha256: DIGEST, announcedLength: 5}, [
        'headerHash',
        'lengthOnly',
      ]),
      'verified',
    );
  });

  it('F-6301.BR-12: a rule without its facts is skipped for the next one', async () => {
    deepStrictEqual(
      await verdictOf({announcedLength: 101}, ['headerHash', 'lengthOnly']),
      'lengthMismatch',
    );
  });

  it('V4: the rule none accepts without looking at the facts', async () => {
    deepStrictEqual(
      await verdictOf({announcedSha256: 'ffff', announcedLength: 5}, ['none']),
      'verified',
    );
  });

  it('V4: a rule without facts and no rule after it leaves nothing to check', async () => {
    deepStrictEqual(
      await verdictOf({}, ['headerHash', 'lengthOnly']),
      'verified',
    );
  });

  it('V4: no rule at all leaves nothing to check', async () => {
    deepStrictEqual(await verdictOf({announcedLength: 5}, []), 'verified');
  });
});
