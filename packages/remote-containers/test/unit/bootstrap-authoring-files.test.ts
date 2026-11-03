import {deepStrictEqual} from 'node:assert';
import type {
  EngineInput,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {bootstrapAuthoringFiles} from '../../src/volumes/bootstrap-authoring-files.ts';
import {exited, settled} from './engine-script.fixture.ts';

/** What the fake engine was asked: the script (or the argv's tail), its place, and the input. */
interface Asked {
  script: string;
  place: string;
  input: EngineInput;
}

/** Files over an engine that answers each script by `answer`, recording what it was asked. */
function filesOver(
  answer: (script: string, place: string) => EngineRunOutcome,
): {files: ReturnType<typeof bootstrapAuthoringFiles>; asked: Asked[]} {
  const asked: Asked[] = [];
  const files = bootstrapAuthoringFiles(
    {
      engine: {
        // eslint-disable-next-line id-length -- the port's method is named run
        run: (argv, input) => {
          const script = String(argv.at(-2));
          const place = String(argv.at(-1));
          asked.push({script, place, input});
          return Promise.resolve(answer(script, place));
        },
      },
      options: {cancellation: new AbortController().signal},
    },
    'boot1',
  );
  return {files, asked};
}

describe('the authoring files of a clone in a volume (card containers-151)', () => {
  it('F-0701 6.1: the kind of a path is a folder, a file or missing, by the exit status of each test', async () => {
    const {files} = filesOver((script, place) => {
      if (script === '[ -d "$0" ]') {
        return exited(place === '/w/r' ? 0 : 1);
      }
      return exited(place === '/w/r/f' ? 0 : 1);
    });
    deepStrictEqual(
      [
        await files.kindOf('/w/r'),
        await files.kindOf('/w/r/f'),
        await files.kindOf('/w/none'),
        await files.exists('/w/r/f'),
        await files.exists('/w/none'),
      ],
      ['folder', 'file', 'missing', true, false],
    );
  });

  it('BR-16: a listing reads our markers, a NUL after each entry, and a listing that fails is empty', async () => {
    const listing = filesOver(() =>
      exited(0, 'd/sub\0f/a b.txt\0f/.hidden\0o/link\0'),
    );
    const failing = filesOver(() => ({kind: 'failed', detail: 'ENOENT'}));
    deepStrictEqual(
      [await listing.files.list('/w/r'), await failing.files.list('/w/r')],
      [
        [
          {name: 'sub', kind: 'folder'},
          {name: 'a b.txt', kind: 'file'},
          {name: '.hidden', kind: 'file'},
          {name: 'link', kind: 'other'},
        ],
        [],
      ],
    );
  });

  it('a file’s bytes cross as base64 both ways, and a read or a write that fails rejects', async () => {
    const bytes = new Uint8Array([0, 1, 255, 10, 13]);
    const encoded = Buffer.from(bytes).toString('base64');
    const working = filesOver(script =>
      script === 'base64 "$0"' ? exited(0, `${encoded}\n`) : exited(0),
    );
    await working.files.write('/w/r/bin', bytes);
    const read = Array.from(await working.files.read('/w/r/bin'));
    const refusing = filesOver(() => exited(1, '', 'No such file'));
    const unreachable = filesOver(() => ({kind: 'failed', detail: 'ENOENT'}));
    deepStrictEqual(
      [
        read,
        working.asked[0],
        await settled(refusing.files.read('/w/none')),
        await settled(refusing.files.write('/w/r/f', bytes)),
        await settled(unreachable.files.write('/w/r/f', bytes)),
      ],
      [
        [0, 1, 255, 10, 13],
        {
          script: 'base64 -d > "$0"',
          place: '/w/r/bin',
          input: {kind: 'text', text: encoded},
        },
        'rejected: No such file',
        'rejected: /w/r/f could not be written in boot1',
        'rejected: /w/r/f could not be written in boot1',
      ],
    );
  });

  it('folders are made and removed, and files removed, with their path after `--`; a refusal rejects', async () => {
    const working = filesOver(() => exited(0));
    await working.files.makeFolder('/w/r/a/b');
    await working.files.removeFile('/w/r/f');
    await working.files.removeFolder('/w/r/a');
    const refusing = filesOver(() => exited(1, '', 'read-only'));
    deepStrictEqual(
      [
        working.asked.map(each => `${each.script} ${each.place}`),
        await settled(refusing.files.makeFolder('/w/r/a')),
      ],
      [
        [
          'mkdir -p -- "$0" /w/r/a/b',
          'rm -f -- "$0" /w/r/f',
          'rm -rf -- "$0" /w/r/a',
        ],
        'rejected: read-only',
      ],
    );
  });

  it('a folder files can be made in has no problem, and one they can’t gives a reason, and nothing is made', async () => {
    const creatable = filesOver(() => exited(0));
    const blocked = filesOver(() => exited(1));
    deepStrictEqual(
      [
        await creatable.files.creationProblem('/w/r/new'),
        await blocked.files.creationProblem('/w/r/f/below'),
        creatable.asked[0]?.script.includes('mkdir'),
      ],
      [undefined, "/w/r/f/below can't be written in the clone's volume", false],
    );
  });
});
