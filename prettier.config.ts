/**
 * @fileoverview Prettier settings copied from gts 7.0.0 (`.prettierrc.json` at commit
 * 4e2a4ec55e2e228815c72a585f80f308897ab4a6). gts is not installed (ADR-0003); its print width is Prettier's
 * default of 80 columns.
 */

import type {Config} from 'prettier';

const prettierSettings: Config = {
  bracketSpacing: false,
  singleQuote: true,
  trailingComma: 'all',
  arrowParens: 'avoid',
};

export default prettierSettings;
