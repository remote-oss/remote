/** Whether `code` is a C0 control other than tab and line feed, or a C1 control. */
function isControl(code: number): boolean {
  return (
    (code <= 0x1f && code !== 0x09 && code !== 0x0a) ||
    (code >= 0x80 && code <= 0x9f)
  );
}

/**
 * `text` with every C0 control other than tab and line feed, and every C1 control, written as its code point,
 * `\u{9b}`, so that an untrusted string reaches a log or a terminal without a control a terminal would act on. DEL and
 * every other character stay as they are.
 */
export function escapeControls(text: string): string {
  let escaped = '';
  for (const character of text) {
    const code = character.charCodeAt(0);
    escaped += isControl(code) ? `\\u{${code.toString(16)}}` : character;
  }
  return escaped;
}
