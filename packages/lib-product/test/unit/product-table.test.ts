import {deepStrictEqual} from 'node:assert';
import {
  REFERENCE_LAYOUT_APPLICATION_NAMES,
  keepsReferenceLayout,
} from '../../src/index.ts';

describe('reference-layout application names (card product-01 table)', () => {
  it('REFERENCE_LAYOUT_APPLICATION_NAMES is the two names, frozen', () => {
    deepStrictEqual(
      [
        REFERENCE_LAYOUT_APPLICATION_NAMES,
        Object.isFrozen(REFERENCE_LAYOUT_APPLICATION_NAMES),
      ],
      [['code', 'code-insiders'], true],
    );
  });

  it("keepsReferenceLayout('code') and ('code-insiders') -> true", () => {
    deepStrictEqual(
      [keepsReferenceLayout('code'), keepsReferenceLayout('code-insiders')],
      [true, true],
    );
  });

  it("keepsReferenceLayout('codium'), ('code-oss'), ('Code') and ('') -> false", () => {
    deepStrictEqual(
      [
        keepsReferenceLayout('codium'),
        keepsReferenceLayout('code-oss'),
        keepsReferenceLayout('Code'),
        keepsReferenceLayout(''),
      ],
      [false, false, false, false],
    );
  });
});
