/** The name of a window: the last segment of its first workspace folder's path, or `local` for a window without one. */
export function windowNameOf(firstFolderPath: string | undefined): string {
  const segment = firstFolderPath
    ?.split('/')
    .filter(part => part !== '')
    .at(-1);
  return segment ?? 'local';
}
