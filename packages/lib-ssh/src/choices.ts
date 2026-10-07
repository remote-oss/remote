/**
 * @fileoverview The behaviour choices that the specifications leave open, in one place. Each entry is read by
 * the component it names; changing a value changes that behaviour and nothing else.
 */

/** The open behaviour choices of the library. */
export interface BehaviourChoices {
  /** A host-key question in the colon form (`fingerprint is: <hash>`) gets the fingerprint pick, not the masked input. */
  fingerprintPickForColonForm: boolean;
  /** The passphrase placeholder names the key file from the question instead of leaving the slot empty. */
  passphraseNamesKeyFile: boolean;
  /** A reason gets a closing full stop only when it does not already end with sentence-final punctuation. */
  fullStopOnlyWhenMissing: boolean;
  /** The host-block writer keeps the file's other lines, its final newline and its line-ending style. */
  writerKeepsSurroundingText: boolean;
  /** The written `Host` line is indented two spaces less than the copied option indentation. */
  writerIndentsHostLine: boolean;
  /** An IPv6 destination, bracketed or bare, stays whole as the host. */
  commandKeepsIpv6Host: boolean;
  /** `-W` writes nothing and `-P` takes an argument, as ssh reads them. */
  commandReadsJumpAndTagFlagsAsSsh: boolean;
  /** `-c` and `-I` write the current keywords `Ciphers` and `PKCS11Provider`. */
  commandWritesCurrentKeywords: boolean;
  /** Option parsing stops at the destination; later words are the remote command. */
  commandStopsOptionsAtDestination: boolean;
}

/** The choices in effect. */
export const BEHAVIOUR_CHOICES: Readonly<BehaviourChoices> = Object.freeze({
  fingerprintPickForColonForm: false,
  passphraseNamesKeyFile: false,
  fullStopOnlyWhenMissing: true,
  writerKeepsSurroundingText: true,
  writerIndentsHostLine: true,
  commandKeepsIpv6Host: true,
  commandReadsJumpAndTagFlagsAsSsh: true,
  commandWritesCurrentKeywords: true,
  commandStopsOptionsAtDestination: true,
});
