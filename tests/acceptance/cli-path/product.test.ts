import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {
  CLI_TEMPLATE_PATH,
  productFileOf,
} from '../../../tools/acceptance-cli-editor.ts';
import {variable} from '../windows/harness.ts';

/** The fields of the `product.json` of the editor whose executable is `executable`. */
function productOf(executable: string): Record<string, unknown> {
  return JSON.parse(readFileSync(productFileOf(executable), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('the CLI-source editor (card tooling-111)', () => {
  it('ADR-0006 decision 8: the copy names a CLI template on the download host, and differs from the editor in nothing else', () => {
    const {cliDownloadUrlTemplate, ...others} = productOf(
      variable('HARNESS_CLI_EDITOR_EXECUTABLE'),
    );
    deepStrictEqual(
      [cliDownloadUrlTemplate, others],
      [
        `${variable('HARNESS_DOWNLOADS_HTTP')}${CLI_TEMPLATE_PATH}`,
        productOf(variable('HARNESS_VSCODIUM_EXECUTABLE')),
      ],
    );
  });
});
