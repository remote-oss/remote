/**
 * @fileoverview What the rows of F-2406 need to turn the run's own server archive into one for another architecture (card
 * #2948): which entry of its listing is the `node` program, whether the archive keeps everything in one top folder, the
 * machine an ELF header must name instead of this one, and the header with that machine. It imports nothing from the
 * harness, so that the tools project can test it.
 */

/** The offset of the two bytes of an ELF header that name its machine. */
export const ELF_MACHINE_OFFSET = 18;

/** The machine of ELF headers for x86-64 and for AArch64, as the two little-endian bytes the header holds. */
const X86_64_MACHINE = Buffer.from([0x3e, 0x00]);
const AARCH64_MACHINE = Buffer.from([0xb7, 0x00]);

/** The machine bytes that name the architecture this machine is not: AArch64 on an x64 machine, else x86-64. */
export function otherMachine(architecture: string): Buffer {
  return architecture === 'x64' ? AARCH64_MACHINE : X86_64_MACHINE;
}

/** `header`, the start of an ELF file, with its machine field set to `machine`; fails naming the reason for a file that is no little-endian ELF. */
export function withElfMachine(header: Buffer, machine: Buffer): Buffer {
  if (
    header.length < ELF_MACHINE_OFFSET + 2 ||
    header.subarray(0, 4).toString('latin1') !== '\u007fELF'
  ) {
    throw new Error('the file does not start with an ELF header');
  }
  if (header[5] !== 1) {
    throw new Error(
      'the ELF file is not little-endian, so its machine field is not these two bytes',
    );
  }
  const patched = Buffer.from(header);
  machine.copy(patched, ELF_MACHINE_OFFSET);
  return patched;
}

/** The entry of a `tar -t` listing that is the file `node`, as it is listed; fails naming how many entries match unless exactly one does. */
export function nodeEntryOf(listing: readonly string[]): string {
  const entries = listing
    .map(line => line.trim())
    .filter(line => line !== '' && !line.endsWith('/'))
    .filter(line => (line.split('/').at(-1) ?? '') === 'node');
  if (entries.length !== 1) {
    throw new Error(
      `the archive lists ${String(entries.length)} entries named node, and the row needs exactly one: ${JSON.stringify(entries)}`,
    );
  }
  return entries[0] ?? '';
}

/** The one top folder every entry of a `tar -t` listing is inside, or none when the entries sit at the archive's root. */
export function topFolderOf(listing: readonly string[]): string | undefined {
  const tops = new Set(
    listing
      .map(line => line.trim().replace(/^\.\//u, ''))
      .filter(line => line !== '' && line !== '.')
      .map(line => (line.includes('/') ? line.split('/')[0] : undefined)),
  );
  const [only] = tops;
  return tops.size === 1 && only !== undefined ? only : undefined;
}
