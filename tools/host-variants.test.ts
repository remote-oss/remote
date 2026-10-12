import {deepStrictEqual, throws} from 'node:assert';
import {
  FETCH_VARIANTS,
  fetchVariantOf,
  fetchVariantsToRun,
} from './host-variants.ts';

describe('the host variants of a run', () => {
  it('tooling-14: with no variant named the run goes through every download tool', () => {
    deepStrictEqual(fetchVariantsToRun({}), FETCH_VARIANTS);
  });

  it('tooling-14: with an empty name the run goes through every download tool', () => {
    deepStrictEqual(
      fetchVariantsToRun({HARNESS_HOST_FETCH: ''}),
      FETCH_VARIANTS,
    );
  });

  it('tooling-14: a named download tool is the only one the run goes through', () => {
    deepStrictEqual(fetchVariantsToRun({HARNESS_HOST_FETCH: 'curl'}), ['curl']);
  });

  it('tooling-14: the named download tool is the variant of the process', () => {
    deepStrictEqual(
      fetchVariantOf({HARNESS_HOST_FETCH: 'gnu-wget'}),
      'gnu-wget',
    );
  });

  it('tooling-14: with no name there is no single variant', () => {
    deepStrictEqual(fetchVariantOf({}), undefined);
  });

  it('tooling-14: a name that is no download tool throws', () => {
    throws(() => fetchVariantOf({HARNESS_HOST_FETCH: 'aria2'}), {
      message: 'HARNESS_HOST_FETCH names no download tool: aria2',
    });
  });

  it('tooling-14: the download tools are the four of the card, in order', () => {
    deepStrictEqual(FETCH_VARIANTS, [
      'busybox-wget',
      'gnu-wget',
      'curl',
      'none',
    ]);
  });
});
