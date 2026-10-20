import {deepStrictEqual} from 'node:assert';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  isTrusted,
  waitFor,
} from '../windows/harness.ts';
import {editorTabs, type Problem, problemsOf} from '../windows/renderer.ts';

const S021 =
  'Absolute file paths are not allowed. Local file path must be indicated relative to the devcontainer.json.';

describe('the Problems panel in an untrusted folder (card containers-95)', function () {
  this.timeout(600_000);
  let window = '';
  afterEach(async () => {
    await closeWindow(window);
  });

  it('F-0414 AC-8 (untrusted): /etc/foo is an Error with STR:S021 and the code referencing-a-feature, with the file not open in an editor and the folder untrusted', async () => {
    const folder = devContainerFolder('c95-ac8', {});
    writeFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      '{\n  "image": "alpine:3.22",\n  "features": {\n    "/etc/foo": {}\n  }\n}\n',
    );
    window = await openFolderWindow(folder);
    let problems: Problem[] = [];
    await waitFor(
      `a problem in window ${window}`,
      async () => {
        problems = await problemsOf(window);
        return problems.length === 1;
      },
      60_000,
    );
    deepStrictEqual(
      [
        await isTrusted(window),
        (await editorTabs(window)).some(
          editor => editor.label === 'devcontainer.json',
        ),
        problems.map(each => [
          each.file,
          each.message,
          each.code,
          each.target,
          each.severity,
        ]),
      ],
      [
        false,
        false,
        [
          [
            '.devcontainer/devcontainer.json',
            S021,
            'referencing-a-feature',
            'https://containers.dev/implementors/features/#referencing-a-feature',
            'error',
          ],
        ],
      ],
    );
  });
});
