import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildSync} from 'esbuild';

describe('the CLI preload (card containers-04)', () => {
  it('C3: a program started with the preload does not see ELECTRON_RUN_AS_NODE', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'preload-'));
    try {
      const bundled = buildSync({
        entryPoints: [
          path.join(
            import.meta.dirname,
            '..',
            '..',
            'src',
            'programs',
            'cli-preload.ts',
          ),
        ],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
      });
      const preload = path.join(folder, 'cli-preload.js');
      writeFileSync(preload, bundled.outputFiles[0]?.text ?? '');
      const finished = spawnSync(
        process.execPath,
        [
          '--require',
          preload,
          '-e',
          'console.log(process.env.ELECTRON_RUN_AS_NODE ?? "absent")',
        ],
        {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, encoding: 'utf8'},
      );
      deepStrictEqual(finished.stdout.trim(), 'absent');
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
