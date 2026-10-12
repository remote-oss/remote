/**
 * @fileoverview The text of the `wsl.exe` management verbs: found by its bytes to be UTF-16LE or UTF-8, decoded, and
 * made of plain lines, so every parser works on the same text.
 */

const UTF16_MARK = [0xff, 0xfe];
const UTF8_MARK = [0xef, 0xbb, 0xbf];

function startsWith(bytes: Uint8Array, mark: readonly number[]): boolean {
  return mark.every((value, index) => bytes[index] === value);
}

/** Whether unmarked bytes are UTF-16LE: an even length, and zero high bytes in at least half of the units. */
function looksLikeUtf16(bytes: Uint8Array): boolean {
  if (bytes.length < 2 || bytes.length % 2 !== 0) {
    return false;
  }
  let zeroHighBytes = 0;
  for (let index = 1; index < bytes.length; index += 2) {
    if (bytes[index] === 0) {
      zeroHighBytes++;
    }
  }
  return zeroHighBytes * 2 >= bytes.length / 2;
}

/** The text of a management verb's output, with NULs removed and line ends made `\n`. */
export function decodeManagementOutput(bytes: Uint8Array): string {
  let text: string;
  if (startsWith(bytes, UTF16_MARK)) {
    text = decodeUtf16(bytes.subarray(UTF16_MARK.length));
  } else if (startsWith(bytes, UTF8_MARK)) {
    text = new TextDecoder().decode(bytes.subarray(UTF8_MARK.length));
  } else if (looksLikeUtf16(bytes)) {
    text = decodeUtf16(bytes);
  } else {
    text = new TextDecoder().decode(bytes);
  }
  return text.replaceAll('\u0000', '').replaceAll('\r\n', '\n');
}

function decodeUtf16(bytes: Uint8Array): string {
  return new TextDecoder('utf-16le').decode(
    bytes.subarray(0, bytes.length - (bytes.length % 2)),
  );
}
