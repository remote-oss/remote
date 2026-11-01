import {deepStrictEqual} from 'node:assert';
import {setUserSetting} from '../windows/folder-windows.ts';
import {isTrusted} from '../windows/harness.ts';
import {dialogOf} from '../windows/renderer.ts';
import {
  closeScreen,
  screenOf,
  withWindow,
} from '../windows/authoring-support.ts';

const TRUST_SETTING = 'security.workspace.trust.enabled';

describe('the template screen in Restricted Mode (card coverage-72)', function () {
  this.timeout(600_000);

  afterEach(async () => {
    await setUserSetting(TRUST_SETTING, undefined);
  });

  it('F-0802 AC-21 (c72-trust-list): the template screen and the chooser of a folder with a Dockerfile open with no trust prompt in an untrusted folder, with the same items as in a trusted one', async () => {
    const seen: Array<{
      trusted: boolean | undefined;
      dialog: unknown;
      rows: string[][];
    }> = [];
    async function lookIn(
      name: string,
      contents: Record<string, string>,
    ): Promise<void> {
      await withWindow(name, contents, async window => {
        const rows = (await screenOf(window)).map(each => [
          each.label,
          each.description,
          each.detail,
          each.icons.join(' '),
        ]);
        seen.push({
          trusted: await isTrusted(window),
          dialog: await dialogOf(window),
          rows,
        });
        await closeScreen(window);
      });
    }
    const dockerfile = {Dockerfile: 'FROM alpine\n'};
    await lookIn('c72-restricted', {});
    await lookIn('c72-restricted-chooser', dockerfile);
    // With the setting off, core treats every folder as trusted.
    await setUserSetting(TRUST_SETTING, false);
    await lookIn('c72-trusted', {});
    await lookIn('c72-trusted-chooser', dockerfile);
    deepStrictEqual(
      [
        seen.map(each => [each.trusted, each.dialog]),
        [0, 1].map(
          position =>
            seen[position]?.rows.join('|') ===
            seen[position + 2]?.rows.join('|'),
        ),
        seen[0]?.rows.join('|') === seen[1]?.rows.join('|'),
      ],
      [
        [
          [false, undefined],
          [false, undefined],
          [true, undefined],
          [true, undefined],
        ],
        [true, true],
        false,
      ],
    );
  });
});
