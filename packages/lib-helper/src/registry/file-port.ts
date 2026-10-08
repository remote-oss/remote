/**
 * @fileoverview The file operations the registry needs, so that its decisions run without touching a disk.
 */

/** The registry's access to its folder. */
export interface RegistryFilePort {
  /** Creates the file with `text` unless it exists; one call is atomic. */
  createExclusive(path: string, text: string): Promise<'created' | 'exists'>;
  /** The file's text, or undefined when there is no file. */
  read(path: string): Promise<string | undefined>;
  /** Removes the file; a missing file is not an error. */
  remove(path: string): Promise<void>;
}
