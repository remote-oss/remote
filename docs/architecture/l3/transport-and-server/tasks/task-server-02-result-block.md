# Task card server-02: V1 `parseResult` (the result block of a bootstrap script run)

Brief: `../brief-lib-server.md`. Contract: `../contracts.md` §5 V1 (`parseResult`, statuses). Depends on card
server-01 (the package). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `src/scripts/result-block.ts`, `src/index.ts` (exports only), test `test/unit/result-block.test.ts`, fixtures
`test/fixtures/result-block/*.txt` (constructed; each with a `source` note in a sibling `.json`). Nothing else.

## 2. Contract

```ts
export const RESULT_BEGIN = 'remote-oss-server-result-begin';   // a whole line, exactly
export const RESULT_END = 'remote-oss-server-result-end';
export type ScriptStatus = 'Ok' | 'LockBusy' | 'NoDownloaderAvailable' | 'UnpackFailed' | 'ServerDownloadFailed'
  | 'CreateInstallDirFailed' | 'UnsupportedArch' | 'UnsupportedPlatform' | 'LinuxPrereqs' | 'NoBash' | 'ServerFailedToStart';
export interface ResultBlock {
  status: ScriptStatus;
  hostFacts: Record<string, string>;     // keys prefixed `host.` in the block, prefix stripped
  serverFacts: Record<string, string>;   // keys prefixed `server.`
  timings: Record<string, number>;       // keys prefixed `timing.`, values integer milliseconds
  unknownStatus?: string;                // set when the status word is not in ScriptStatus; status is then 'ServerFailedToStart'
}
export function parseResult(lines: readonly string[]): { block: ResultBlock } | { failure: 'noResultBlock' };
```

Block format (what V1's scripts print, one `key=value` per line between the two marker lines; `status=` is required;
other keys are `host.*`, `server.*`, `timing.*`; values are raw text to end of line, no quoting): the LAST complete
block in the lines wins (a retried step prints a second block); lines outside blocks are ignored; a block without an
end marker is incomplete and does not count; a line inside a block without `=` is ignored; a duplicate key keeps the
last value; a `timing.*` value that is not a non-negative integer is dropped; trailing `\r` is stripped from every
line.

## 3. Test table

| Given (lines) | Expected |
|---|---|
| `[]` | `{failure:'noResultBlock'}` |
| `['noise']` | `noResultBlock` |
| begin, `status=Ok`, end | `status 'Ok'`, empty facts and timings |
| begin, `status=Ok`, `host.os=linux`, `host.arch=x64`, `server.port=41263`, `timing.download=1532`, end | hostFacts `{os:'linux', arch:'x64'}`, serverFacts `{port:'41263'}`, timings `{download:1532}` |
| begin without end | `noResultBlock` |
| two complete blocks (`status=LockBusy` then `status=Ok`) | `status 'Ok'` (the last wins) |
| a complete block then an incomplete one | the complete block's values |
| begin, `status=Ok`, `garbage line`, end | parsed; the garbage ignored |
| begin, `host.os=linux`, end (no status) | `noResultBlock` |
| `status=Weird` | `status 'ServerFailedToStart'`, `unknownStatus 'Weird'` |
| each of the eleven status words | the matching `status`, `unknownStatus` undefined |
| `timing.unpack=abc` and `timing.start=-5` | both dropped |
| `timing.unpack=07` | `{unpack: 7}` |
| `host.os=linux`, then `host.os=alpine` | `{os:'alpine'}` |
| `server.path=/a/b=c` | serverFacts `{path:'/a/b=c'}` (split on the first `=` only) |
| lines ending in `\r` | identical result to the same lines without `\r` |
| a marker line with trailing spaces `'remote-oss-server-result-begin '` | not a marker (whole-line match); so `noResultBlock` if no exact marker exists |
| `status=Ok` with leading spaces `'  status=Ok'` | ignored (keys are not trimmed); so the block has no status → `noResultBlock` |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: result block parser (card server-02)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

The exact marker words are this card's decision for the whole family (V1's scripts print them); if the reviewer
wants different words, both the parser and the future scripts change together. Report, do not choose differently.
