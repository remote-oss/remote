# Task card wsl-01: `decodeManagementOutput` (the text of `wsl.exe` management verbs)

Why: `wsl.exe --list`, `--status` and `--version` print UTF-16LE (or UTF-8 when WSL is told to), with CRLF line ends
and sometimes stray NULs; every parser works on the decoded text (contracts.md §1 D1 `manage`, D1a; brief "Decoder").
The encoding is found from the bytes, never from a flag. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-wsl/src/decode.ts` (new), `test/unit/decode.test.ts` (new), `src/index.ts` (one export line). Nothing
else. Depends on card wsl-00 (the package). No `vscode`, no `Buffer`-only API in the signature, no file or process.

## 2. Contract

```ts
export function decodeManagementOutput(bytes: Uint8Array): string;
```

Rules, in order:

1. A leading `FF FE` means UTF-16LE: the two bytes are dropped. A leading `EF BB BF` means UTF-8: the three bytes are
   dropped.
2. Without a mark: the bytes are UTF-16LE when their length is even and at least 2 and the number of zero bytes at
   odd indexes, times 2, is at least the number of 16-bit units (text in ASCII or Latin script has a zero high byte
   in most units). Otherwise they are UTF-8.
3. UTF-16LE decoding drops one trailing odd byte first. UTF-8 decoding is not fatal: an invalid byte becomes U+FFFD.
   (`TextDecoder` may be used.)
4. After decoding, every U+0000 is removed and every `\r\n` becomes `\n`.

## 3. Test table

Bytes are written as text for the encoding named; the test builds them (UTF-16LE through a helper in the test file).

| Citation | Given | Expected |
|---|---|---|
| contracts.md §1 D1 | `FF FE` + UTF-16LE `NAME\r\n` | `NAME\n` |
| contracts.md §1 D1 | UTF-16LE `  NAME   STATE\r\n`, no mark | `  NAME   STATE\n` |
| brief "Decoding" | UTF-16LE `fixture γ\r\n`, no mark (γ is `B3 03`) | `fixture γ\n` |
| contracts.md §1 D1 | UTF-8 `fixture γ\n` (the `WSL_UTF8=1` form) | `fixture γ\n` |
| contracts.md §1 D1 | `EF BB BF` + UTF-8 `abc` | `abc` |
| brief "Decoding" | UTF-16LE `abc` + `00 00`, no mark | `abc` |
| brief "Decoding" | UTF-8 `abc` + `00` | `abc` |
| brief "Decoding" | UTF-8 bytes `61 00 62` (odd length) | `ab` |
| brief "Decoding" | empty `Uint8Array` | `` |
| brief "Decoding" | UTF-8 `a\r\nb\r\n` | `a\nb\n` |
| contracts.md §1 D1 | `41 00` (one UTF-16LE unit, no mark) | `A` |
| contracts.md §1 D1 | `FF FE 41 00 42` (odd length after the mark) | `A` |
| contracts.md §1 D1 | `41 FF` (invalid UTF-8) | `A�` |
| contracts.md §1 D1 | `61 62 00 00` (1 zero at an odd index, 2 units: 1 x 2 >= 2, boundary met) | `\u6261` |
| contracts.md §1 D1 | `61 62 63 64 00 00` (1 zero at an odd index, 3 units: 1 x 2 < 3) | `abcd` (UTF-8, NULs removed) |

## 4. Rule for the worker

As card log-01; names of four characters or more (`now` excepted); no comment beyond what the guide requires; tests
first, then the module; every branch of rules 1 to 4 has a row; coverage 90/85/90 and the ratchet.

## 5. Gates and review

PR title `lib-wsl: decodeManagementOutput (card wsl-01)`; answers R1–R6.

## 6. Open rows (stop and report)

- A lone `\r` (progress output): kept or turned into `\n`? Not tested, not implemented; rule 4 touches `\r\n` only.
- `FE FF` (UTF-16BE mark) and UTF-16LE text with no zero high byte at all (CJK only) and no mark: the spec is
  silent (the specs' F-6101 is a pending draft). Not tested; report if met.
