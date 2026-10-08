/**
 * @fileoverview The product table: the built-in server sources, the licence hosts, the release prefixes of the
 * built-in MIT sources, and the licence rules. It is the only file of the repository's code that names a product or
 * a download host; everything else reads them from here or from the running editor's product.json.
 */

/** A built-in server source for an editor whose product.json names none, matched on its `applicationName`. */
export interface BuiltInSource {
  readonly applicationName: string;
  /** The archive URL template, with the placeholders of `expand`. */
  readonly template: string;
}

/** The built-in sources, matched exactly on `applicationName`. */
export const BUILT_IN_SOURCES: readonly BuiltInSource[] = [
  {
    applicationName: 'codium',
    template:
      'https://github.com/VSCodium/vscodium/releases/download/${version}${release}/vscodium-reh-${os}-${arch}-${version}${release}.tar.gz',
  },
  {
    applicationName: 'codium-insiders',
    template:
      'https://github.com/VSCodium/vscodium-insiders/releases/download/${version}${release}/vscodium-reh-${os}-${arch}-${version}${release}.tar.gz',
  },
];

/** Download hosts whose servers come under the server licence terms, on any editor. */
export const LICENCE_HOSTS: readonly string[] = [
  'update.code.visualstudio.com',
  'vscode.download.prss.microsoft.com',
];

/** URL prefixes of the built-in MIT sources: a server from these needs no licence acceptance. */
export const MIT_RELEASE_PREFIXES: readonly string[] = [
  'https://github.com/VSCodium/vscodium/releases/',
  'https://github.com/VSCodium/vscodium-insiders/releases/',
];

/** The licence rules, by name. */
export type LicenceRuleName = 'clientLicence' | 'sourceBased';

/** The rules in force. `clientLicence` stays in the table, inactive. */
export const ACTIVE_LICENCE_RULES: readonly LicenceRuleName[] = ['sourceBased'];
