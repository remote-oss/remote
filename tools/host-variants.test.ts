import {deepStrictEqual, throws} from 'node:assert';
import {
  FETCH_VARIANTS,
  fetchVariantOf,
  HOST_BASE_VARIANTS,
  VARIANT_HOST_BASES,
  hostBaseIs,
  hostBaseOf,
  fetchVariantsToRun,
  SHELL_VARIANTS,
  shellVariantOf,
  shellVariantsToRun,
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

  it('tooling-14: with no shell named the run goes through every login shell', () => {
    deepStrictEqual(shellVariantsToRun({}), SHELL_VARIANTS);
  });

  it('tooling-14: with an empty shell name the run goes through every login shell', () => {
    deepStrictEqual(
      shellVariantsToRun({HARNESS_HOST_SHELL: ''}),
      SHELL_VARIANTS,
    );
  });

  it('tooling-14: a named login shell is the only one the run goes through', () => {
    deepStrictEqual(shellVariantsToRun({HARNESS_HOST_SHELL: '/bin/zsh'}), [
      '/bin/zsh',
    ]);
  });

  it('tooling-14: the named login shell is the shell variant of the process', () => {
    deepStrictEqual(
      shellVariantOf({HARNESS_HOST_SHELL: '/bin/bash'}),
      '/bin/bash',
    );
  });

  it('tooling-14: with no shell named there is no single shell variant', () => {
    deepStrictEqual(shellVariantOf({}), undefined);
  });

  it('tooling-14: a name that is no login shell throws', () => {
    throws(() => shellVariantOf({HARNESS_HOST_SHELL: '/bin/ksh'}), {
      message: 'HARNESS_HOST_SHELL names no login shell: /bin/ksh',
    });
  });

  it('tooling-14: the login shells are the eight of the card, in order', () => {
    deepStrictEqual(SHELL_VARIANTS, [
      '/bin/sh',
      '/bin/bash',
      '/bin/zsh',
      '/usr/bin/dash',
      '/usr/bin/fish',
      '/bin/tcsh',
      '/bin/csh',
      '/bin/mksh',
    ]);
  });

  it('tooling-70: with no host base named, or an empty one, the host is Alpine', () => {
    deepStrictEqual(
      [hostBaseOf({}), hostBaseOf({HARNESS_HOST_BASE: ''})],
      ['alpine', 'alpine'],
    );
  });

  it('tooling-70: a named host base is the base of the process', () => {
    deepStrictEqual(
      hostBaseOf({HARNESS_HOST_BASE: 'ubuntu-26.04'}),
      'ubuntu-26.04',
    );
  });

  it('tooling-70: a name that is no host base throws, as an unknown shell does', () => {
    throws(
      () => hostBaseOf({HARNESS_HOST_BASE: 'debian'}),
      /^Error: HARNESS_HOST_BASE names no host base: debian$/,
    );
  });

  it('tooling-70, tooling-35: the host bases are Alpine, Ubuntu 26.04, Ubuntu 18.04 and Debian 12, in that order, and the variant run takes the host-base rows to Ubuntu 26.04 only', () => {
    deepStrictEqual(
      [HOST_BASE_VARIANTS, VARIANT_HOST_BASES],
      [
        ['alpine', 'ubuntu-26.04', 'ubuntu-18.04', 'debian-12'],
        ['ubuntu-26.04'],
      ],
    );
  });

  it('tooling-75: an unset host base is Alpine, and a named one is that base only', () => {
    deepStrictEqual(
      [
        hostBaseIs('alpine', {}),
        hostBaseIs('ubuntu-26.04', {}),
        hostBaseIs('alpine', {HARNESS_HOST_BASE: 'ubuntu-26.04'}),
        hostBaseIs('ubuntu-26.04', {HARNESS_HOST_BASE: 'ubuntu-26.04'}),
      ],
      [true, false, false, true],
    );
  });
});
