/**
 * @fileoverview readProfile: the running editor's product.json as the profile every resolver reads its names,
 * folders, URLs and licence fields from.
 */

/** The editor's identity and server facts, read once per session from its product.json. */
export interface ProductProfile {
  readonly applicationName: string;
  readonly version: string;
  readonly commit: string;
  readonly quality: string;
  /** The product's release tag; empty when it has none. */
  readonly release: string;
  readonly serverApplicationName: string;
  /** Absent when product.json has none; the caller applies its own fallback. */
  readonly serverDataFolderName?: string;
  readonly dataFolderName: string;
  readonly tunnelApplicationName: string;
  readonly urlProtocol: string;
  /** The product's own server archive template; empty when it declares none. */
  readonly serverDownloadUrlTemplate: string;
  /** The product's own template for the editor's command-line archive; empty when it names no source. */
  readonly cliDownloadUrlTemplate: string;
  readonly updateUrl: string;
  readonly downloadUrl: string;
  /** The licence lines the server shows; empty when the product's server needs no acceptance. */
  readonly serverLicense: readonly string[];
  readonly serverLicenseUrl: string;
  /** The extension gallery the product names, as product.json writes it; absent when it names none. */
  readonly gallery?: Readonly<Record<string, unknown>>;
}

/** The outcome of reading product.json: the profile, or `unreadable` with the reason. */
export type ProfileReading =
  | {readonly kind: 'profile'; readonly profile: ProductProfile}
  | {readonly kind: 'unreadable'; readonly reason: string};

const STRING_FIELDS = [
  'applicationName',
  'version',
  'commit',
  'quality',
  'release',
  'serverApplicationName',
  'serverDataFolderName',
  'dataFolderName',
  'tunnelApplicationName',
  'urlProtocol',
  'serverDownloadUrlTemplate',
  'cliDownloadUrlTemplate',
  'updateUrl',
  'downloadUrl',
  'serverLicenseUrl',
] as const;

type StringField = (typeof STRING_FIELDS)[number];

function textOf(fields: Record<string, unknown>, field: StringField): string {
  // wrongType checked that every string field present is a string.
  return (fields[field] as string | undefined) ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wrongType(fields: Record<string, unknown>): string | undefined {
  const field = STRING_FIELDS.find(
    name => name in fields && typeof fields[name] !== 'string',
  );
  if (field !== undefined) {
    return `${field} is not a string`;
  }
  const licence = fields.serverLicense;
  if (
    licence !== undefined &&
    !(Array.isArray(licence) && licence.every(line => typeof line === 'string'))
  ) {
    return 'serverLicense is not a list of strings';
  }
  if (
    fields.extensionsGallery !== undefined &&
    !isRecord(fields.extensionsGallery)
  ) {
    return 'extensionsGallery is not an object';
  }
  return undefined;
}

/**
 * Reads the text of product.json. A missing field gives its empty value, `serverDataFolderName` stays absent;
 * text that is not JSON, not an object, or has a field of the wrong type is `unreadable`.
 */
export function readProfile(productJsonText: string): ProfileReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(productJsonText);
  } catch (error) {
    return {
      kind: 'unreadable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!isRecord(parsed)) {
    return {kind: 'unreadable', reason: 'product.json is not an object'};
  }
  const problem = wrongType(parsed);
  if (problem !== undefined) {
    return {kind: 'unreadable', reason: problem};
  }
  const serverDataFolderName = parsed.serverDataFolderName as
    string | undefined;
  const gallery = parsed.extensionsGallery as
    Record<string, unknown> | undefined;
  return {
    kind: 'profile',
    profile: {
      applicationName: textOf(parsed, 'applicationName'),
      version: textOf(parsed, 'version'),
      commit: textOf(parsed, 'commit'),
      quality: textOf(parsed, 'quality'),
      release: textOf(parsed, 'release'),
      serverApplicationName: textOf(parsed, 'serverApplicationName'),
      ...(serverDataFolderName === undefined ? {} : {serverDataFolderName}),
      dataFolderName: textOf(parsed, 'dataFolderName'),
      tunnelApplicationName: textOf(parsed, 'tunnelApplicationName'),
      urlProtocol: textOf(parsed, 'urlProtocol'),
      serverDownloadUrlTemplate: textOf(parsed, 'serverDownloadUrlTemplate'),
      cliDownloadUrlTemplate: textOf(parsed, 'cliDownloadUrlTemplate'),
      updateUrl: textOf(parsed, 'updateUrl'),
      downloadUrl: textOf(parsed, 'downloadUrl'),
      serverLicense: (parsed.serverLicense as string[] | undefined) ?? [],
      serverLicenseUrl: textOf(parsed, 'serverLicenseUrl'),
      ...(gallery === undefined ? {} : {gallery}),
    },
  };
}

/**
 * The name of the folder the server keeps its data in: the one product.json declares, or the product-scoped
 * fallback derived from the application name, so a product that names none never falls back to another
 * product's folder.
 */
export function serverDataFolderNameOrDefault(
  profile: Pick<ProductProfile, 'serverDataFolderName' | 'applicationName'>,
): string {
  const declared = profile.serverDataFolderName;
  return declared !== undefined && declared !== ''
    ? declared
    : `.${profile.applicationName}-server`;
}

/** The profile of a product.json text; throws when the text cannot be read as one. */
export function profileOf(productJsonText: string): ProductProfile {
  const reading = readProfile(productJsonText);
  if (reading.kind === 'unreadable') {
    throw new Error(`product.json cannot be read: ${reading.reason}`);
  }
  return reading.profile;
}
