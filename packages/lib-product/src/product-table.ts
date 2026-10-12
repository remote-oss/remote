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

/** The page of the server licence terms, for an editor whose product.json names none. */
export const SERVER_TERMS_URL = 'https://aka.ms/vscode-server-license';

/** URL prefixes of the built-in MIT sources: a server from these needs no licence acceptance. */
export const MIT_RELEASE_PREFIXES: readonly string[] = [
  'https://github.com/VSCodium/vscodium/releases/',
  'https://github.com/VSCodium/vscodium-insiders/releases/',
];

/**
 * The hosts a download from a source host may be redirected to, keyed by the source host. A source that serves its
 * files from another host (release assets) lists it here; every other final host is refused.
 */
const ALLOWED_REDIRECT_HOSTS: Readonly<Record<string, readonly string[]>> = {
  'github.com': [
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
  ],
};

/** The hosts a download from `sourceHost` may be redirected to, besides `sourceHost` itself. */
export function allowedRedirectHosts(sourceHost: string): readonly string[] {
  return ALLOWED_REDIRECT_HOSTS[sourceHost.toLowerCase()] ?? [];
}

/** The licence rules, by name. */
export type LicenceRuleName = 'clientLicence' | 'sourceBased';

/** The rules in force. `clientLicence` stays in the table, inactive. */
export const ACTIVE_LICENCE_RULES: readonly LicenceRuleName[] = ['sourceBased'];

/**
 * The application names that keep the reference layout: an editor whose `applicationName` is one of these keeps
 * the reference editor's folders and settings, and the others do not (ADR-0006).
 */
export const REFERENCE_LAYOUT_APPLICATION_NAMES: readonly string[] =
  Object.freeze(['code', 'code-insiders']);

/** Whether the editor keeps the reference layout, matched exactly against the table's names. */
export function keepsReferenceLayout(applicationName: string): boolean {
  return REFERENCE_LAYOUT_APPLICATION_NAMES.includes(applicationName);
}

/** The folder the editor's server occupies on the volume mount: the shared one while it keeps the shared layout, a folder of the editor's own otherwise. */
export function volumeServerFolder(applicationName: string): string {
  return keepsReferenceLayout(applicationName)
    ? 'vscode-server'
    : `${applicationName}-server`;
}
