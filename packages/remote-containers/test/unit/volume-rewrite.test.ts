import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {volumeRewriteOf} from '../../src/volumes/volume-rewrite.ts';

const WORKSPACE = {
  workspaceMount: 'type=volume,source=r-1,target=/workspaces',
  workspaceFolder: '/workspaces/r',
};

describe('the rewrite of a clone in a volume (card containers-151)', () => {
  it('F-0701 section 10: an own workspace is replaced with one log line; none is replaced silently; a broken text gives none', () => {
    const sink = new MemorySink();
    const rewrite = volumeRewriteOf(
      {},
      WORKSPACE,
      createLogger(sink, {minimumLevel: () => 'info'}),
    );
    const texts = [
      rewrite('{"workspaceFolder": "/w"}'),
      rewrite('{"image": "i"}'),
      rewrite('{'),
    ];
    deepStrictEqual(
      [
        texts.map(text =>
          text === undefined ? undefined : (JSON.parse(text) as unknown),
        ),
        sink.lines.map(line => line.message),
      ],
      [
        [WORKSPACE, {image: 'i', ...WORKSPACE}, undefined],
        [
          "the configuration's own workspaceMount and workspaceFolder are ignored: a clone in a volume has the volume's",
        ],
      ],
    );
  });
});
