import {deepStrictEqual, throws} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  CLI_EDITOR_FOLDER,
  CLI_TEMPLATE_PATH,
  cliSourceEditorOf,
  productFileOf,
  withCliTemplate,
} from './acceptance-cli-editor.ts';
import {type CommandResult, runCommand} from './command-runner.ts';

const TEMPLATE = `http://downloads:8080${CLI_TEMPLATE_PATH}`;

/** The product of the stand-in editor. */
const PRODUCT = {applicationName: 'codium-insiders', quality: 'insider'};

describe('the CLI-source editor', () => {
  let base = '';
  let executable = '';
  let runFolder = '';

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'cli-editor-'));
    executable = path.join(base, 'editor', 'codium-insiders');
    runFolder = path.join(base, 'run');
    mkdirSync(path.dirname(productFileOf(executable)), {recursive: true});
    mkdirSync(runFolder);
    writeFileSync(executable, 'editor');
    writeFileSync(productFileOf(executable), JSON.stringify(PRODUCT));
  });

  afterEach(() => {
    rmSync(base, {recursive: true, force: true});
  });

  /** The copy's product, the editor's own, and whether the copy's executable is a link to the editor's. */
  function outcomeOf(copy: string): unknown[] {
    return [
      copy,
      JSON.parse(readFileSync(productFileOf(copy), 'utf8')),
      JSON.parse(readFileSync(productFileOf(executable), 'utf8')),
      statSync(copy).ino === statSync(executable).ino,
    ];
  }

  it('tooling-111: the template is the download host’s /cli/ path, with only the os and the arch left', () => {
    deepStrictEqual(
      CLI_TEMPLATE_PATH,
      '/cli/${os}-${arch}/cli-${os}-${arch}.tar.gz',
    );
  });

  it('tooling-111: the product gains the template and keeps every other field, a template it had replaced', () => {
    deepStrictEqual(
      [
        JSON.parse(withCliTemplate(JSON.stringify(PRODUCT), TEMPLATE)),
        JSON.parse(
          withCliTemplate(
            JSON.stringify({...PRODUCT, cliDownloadUrlTemplate: 'old'}),
            TEMPLATE,
          ),
        ),
      ],
      [
        {...PRODUCT, cliDownloadUrlTemplate: TEMPLATE},
        {...PRODUCT, cliDownloadUrlTemplate: TEMPLATE},
      ],
    );
  });

  it('tooling-111: the copy is linked into the run’s folder, and only its product.json, written anew, names the template', () => {
    deepStrictEqual(
      outcomeOf(cliSourceEditorOf(runCommand, executable, runFolder, TEMPLATE)),
      [
        path.join(runFolder, CLI_EDITOR_FOLDER, 'codium-insiders'),
        {...PRODUCT, cliDownloadUrlTemplate: TEMPLATE},
        PRODUCT,
        true,
      ],
    );
  });

  it('tooling-111: where a link can’t be made the folder is copied, and an earlier copy is replaced', () => {
    mkdirSync(path.join(runFolder, CLI_EDITOR_FOLDER, 'stale'), {
      recursive: true,
    });
    const asked: string[] = [];
    function noLinks(
      program: string,
      programArguments: readonly string[],
    ): CommandResult {
      asked.push(programArguments[0] ?? '');
      return programArguments[0] === '-al'
        ? {status: 1, stdout: '', stderr: 'Invalid cross-device link'}
        : runCommand(program, programArguments);
    }
    const copy = cliSourceEditorOf(noLinks, executable, runFolder, TEMPLATE);
    deepStrictEqual(
      [
        ...outcomeOf(copy),
        asked,
        existsSync(path.join(runFolder, CLI_EDITOR_FOLDER, 'stale')),
      ],
      [
        path.join(runFolder, CLI_EDITOR_FOLDER, 'codium-insiders'),
        {...PRODUCT, cliDownloadUrlTemplate: TEMPLATE},
        PRODUCT,
        false,
        ['-al', '-a'],
        false,
      ],
    );
  });

  it('tooling-111: a copy that fails both ways fails the run with the copy’s error', () => {
    function failing(): CommandResult {
      return {status: 1, stdout: '', stderr: 'No space left on device'};
    }
    throws(
      () => cliSourceEditorOf(failing, executable, runFolder, TEMPLATE),
      /cp -a .* failed \(1\): No space left on device/,
    );
  });
});
