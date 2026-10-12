/**
 * @fileoverview The payloads of the companion interface: the version envelope, the six plain-data payloads the
 * remote extensions exchange, and the readers and writers that move between their raw and typed forms. Nothing
 * here touches the editor or a process.
 */

/** The version of the companion interface a payload speaks. */
export interface InterfaceVersion {
  readonly major: number;
  readonly minor: number;
}

/** The version this side of the interface speaks. */
export const INTERFACE_VERSION: InterfaceVersion = {major: 1, minor: 0};

/** Why a payload is refused: it does not fit the shape at all, or its major version is not ours. */
export type Refusal = 'foreign' | 'unknownMajor';

/** The result of reading a payload: the typed value, or the refusal. */
export type ReadOutcome<Value> =
  {status: 'valid'; value: Value} | {status: 'refused'; reason: Refusal};

/** The base of every versioned payload: its interface version. */
export interface Versioned {
  readonly interfaceVersion: InterfaceVersion;
}

/** Which remote, if any, the extension is connected to: the host key is present only while connected. */
export interface ActiveRemote extends Versioned {
  readonly connected: boolean;
  readonly hostKey?: string;
}

/** The hostnames a host offers, in the order and spelling the sender gave. */
export interface Hostnames extends Versioned {
  readonly hostnames: string[];
}

/** Whether a history entry names a folder or a workspace file. */
export type PathKind = 'folder' | 'workspace';

/** One entry of the open history: a path and what kind of path it is. */
export interface HistoryEntry {
  readonly path: string;
  readonly kind: PathKind;
}

/** The open history of one host: its key and its entries, in order and with repeats. */
export interface HostHistory {
  readonly hostKey: string;
  readonly entries: HistoryEntry[];
}

/** The open history of every host the extension remembers. */
export interface FoldersHistory extends Versioned {
  readonly hosts: HostHistory[];
}

/** A request to delete one path on a host. */
export interface DeleteRequest extends Versioned {
  readonly hostKey: string;
  readonly path: string;
}

/** The result of a delete request: whether anything changed. */
export interface DeleteResult extends Versioned {
  readonly changed: boolean;
}

/** A request to open a path in a window: the path and its kind are the sender's words. */
export interface OpenRequest extends Versioned {
  readonly hostKey: string;
  readonly path?: string;
  readonly kind?: PathKind;
  readonly window: 'current' | 'new';
}

/** What an active-folders push managed: connect, fail, or change nothing. */
export type PushOutcome = 'connected' | 'failed' | 'none';

/** The result the extension reports after a push of the active folders. */
export interface ActiveFoldersPush extends Versioned {
  readonly outcome: PushOutcome;
  readonly hostKey?: string;
  readonly folders?: string[];
}

/** The raw side of a payload: an object whose fields have not been read yet. */
type RawObject = Record<string, unknown>;

/** Whether a raw value is a plain object: of object type, not null, not an array. */
function isPlainObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a raw value is a non-negative integer: a number, whole, zero or above. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The value of a string field of a raw value, when it is a string. */
function stringField(value: unknown, field: string): string | undefined {
  const rawValue = isPlainObject(value) ? value[field] : undefined;
  return typeof rawValue === 'string' ? rawValue : undefined;
}

/** The raw value of a field of a raw object, or undefined. */
function propertyOf(value: unknown, field: string): unknown {
  return isPlainObject(value) ? value[field] : undefined;
}

/** The members of a raw list that each fit, in order and with repeats; undefined when the value is not a list or a member does not fit. */
function listEntries<Entry>(
  value: unknown,
  fitter: (entry: unknown) => Entry | undefined,
): Entry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries: Entry[] = [];
  for (const entry of value) {
    const fitted = fitter(entry);
    if (fitted === undefined) {
      return undefined;
    }
    entries.push(fitted);
  }
  return entries;
}

/** A list whose members are all strings, in order and with repeats. */
function stringList(value: unknown): string[] | undefined {
  return listEntries(value, entry =>
    typeof entry === 'string' ? entry : undefined,
  );
}

/** The version of a raw version value, when it is a plain object with non-negative integer major and minor. */
function versionOf(value: unknown): InterfaceVersion | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  if (
    !isNonNegativeInteger(value.major) ||
    !isNonNegativeInteger(value.minor)
  ) {
    return undefined;
  }
  return {major: value.major, minor: value.minor};
}

/** The envelope of a raw payload: its version and raw object when it fits, or the refusal. */
function envelopeOf(
  payload: unknown,
): {version: InterfaceVersion; record: RawObject} | {refusal: Refusal} {
  if (!isPlainObject(payload)) {
    return {refusal: 'foreign'};
  }
  const version = versionOf(payload.interfaceVersion);
  if (version === undefined) {
    return {refusal: 'foreign'};
  }
  if (version.major !== 1) {
    return {refusal: 'unknownMajor'};
  }
  return {version, record: payload};
}

/** Read a payload: check the envelope first, then let the body reader turn the record into its value. */
function readPayload<Value>(
  payload: unknown,
  bodyOf: (version: InterfaceVersion, record: RawObject) => Value | undefined,
): ReadOutcome<Value> {
  const envelope = envelopeOf(payload);
  if ('refusal' in envelope) {
    return {status: 'refused', reason: envelope.refusal};
  }
  const value = bodyOf(envelope.version, envelope.record);
  if (value === undefined) {
    return {status: 'refused', reason: 'foreign'};
  }
  return {status: 'valid', value};
}

/** The active remote of a payload, when it fits: the connection, and the host key while connected. */
function activeRemoteOf(
  version: InterfaceVersion,
  record: RawObject,
): ActiveRemote | undefined {
  const connected = record.connected;
  if (typeof connected !== 'boolean') {
    return undefined;
  }
  if (connected) {
    const hostKey = stringField(record, 'hostKey');
    if (hostKey === undefined) {
      return undefined;
    }
    return {interfaceVersion: version, connected: true, hostKey};
  }
  // A host key that is present but does not fit is a malformed field, not an absent one.
  if (record.hostKey !== undefined && typeof record.hostKey !== 'string') {
    return undefined;
  }
  return {interfaceVersion: version, connected: false};
}

/** The hostnames of a payload, when they fit. */
function hostnamesOf(
  version: InterfaceVersion,
  record: RawObject,
): Hostnames | undefined {
  const hostnames = stringList(record.hostnames);
  if (hostnames === undefined) {
    return undefined;
  }
  return {interfaceVersion: version, hostnames};
}

/** The kind of a history entry, when the value names one of the kinds. */
function pathKindOf(value: unknown): PathKind | undefined {
  if (value === 'folder' || value === 'workspace') {
    return value;
  }
  return undefined;
}

/** One history entry, when its path and kind fit. */
function entryOf(value: unknown): HistoryEntry | undefined {
  const path = stringField(value, 'path');
  const kind = pathKindOf(propertyOf(value, 'kind'));
  if (path === undefined || kind === undefined) {
    return undefined;
  }
  return {path, kind};
}

/** One host of the history, when its key and entries fit. */
function hostOf(value: unknown): HostHistory | undefined {
  const hostKey = stringField(value, 'hostKey');
  const entries = listEntries(propertyOf(value, 'entries'), entryOf);
  if (hostKey === undefined || entries === undefined) {
    return undefined;
  }
  return {hostKey, entries};
}

/** The folders history of a payload, when it fits. */
function foldersHistoryOf(
  version: InterfaceVersion,
  record: RawObject,
): FoldersHistory | undefined {
  const hosts = listEntries(record.hosts, hostOf);
  if (hosts === undefined) {
    return undefined;
  }
  return {interfaceVersion: version, hosts};
}

/** A delete request, when its host key and path fit. */
function deleteRequestOf(
  version: InterfaceVersion,
  record: RawObject,
): DeleteRequest | undefined {
  const hostKey = stringField(record, 'hostKey');
  const path = stringField(record, 'path');
  if (hostKey === undefined || path === undefined) {
    return undefined;
  }
  return {interfaceVersion: version, hostKey, path};
}

/** A delete result, when its changed flag fits. */
function deleteResultOf(
  version: InterfaceVersion,
  record: RawObject,
): DeleteResult | undefined {
  const changed = record.changed;
  if (typeof changed !== 'boolean') {
    return undefined;
  }
  return {interfaceVersion: version, changed};
}

/** The window of an open request, when the value names one of the windows. */
function windowOf(value: unknown): 'current' | 'new' | undefined {
  if (value === 'current' || value === 'new') {
    return value;
  }
  return undefined;
}

/** An open request, when its host key and window fit: the path and kind stay as the sender gave them. */
function openRequestOf(
  version: InterfaceVersion,
  record: RawObject,
): OpenRequest | undefined {
  const hostKey = stringField(record, 'hostKey');
  const window = windowOf(record.window);
  if (hostKey === undefined || window === undefined) {
    return undefined;
  }
  const path = stringField(record, 'path');
  if (path === undefined && record.path !== undefined) {
    return undefined;
  }
  const kind = pathKindOf(record.kind);
  if (kind === undefined && record.kind !== undefined) {
    return undefined;
  }
  return {
    interfaceVersion: version,
    hostKey,
    ...(path !== undefined && {path}),
    ...(kind !== undefined && {kind}),
    window,
  };
}

/** The outcome of a push, when the value names one of the outcomes. */
function outcomeOf(value: unknown): PushOutcome | undefined {
  if (value === 'connected' || value === 'failed' || value === 'none') {
    return value;
  }
  return undefined;
}

/** An active-folders push, when its outcome fits: the host key and folders stay as the sender gave them. */
function activeFoldersPushOf(
  version: InterfaceVersion,
  record: RawObject,
): ActiveFoldersPush | undefined {
  const outcome = outcomeOf(record.outcome);
  if (outcome === undefined) {
    return undefined;
  }
  const hostKey = stringField(record, 'hostKey');
  if (hostKey === undefined && record.hostKey !== undefined) {
    return undefined;
  }
  const rawFolders = record.folders;
  const folders = rawFolders === undefined ? undefined : stringList(rawFolders);
  if (rawFolders !== undefined && folders === undefined) {
    return undefined;
  }
  return {
    interfaceVersion: version,
    outcome,
    ...(hostKey !== undefined && {hostKey}),
    ...(folders !== undefined && {folders}),
  };
}

/** Read the envelope of a payload; the envelope is the whole argument of the host-list change signal. */
export function readEnvelope(payload: unknown): ReadOutcome<Versioned> {
  const envelope = envelopeOf(payload);
  if ('refusal' in envelope) {
    return {status: 'refused', reason: envelope.refusal};
  }
  return {status: 'valid', value: {interfaceVersion: envelope.version}};
}

/** Read the active remote. */
export function readActiveRemote(payload: unknown): ReadOutcome<ActiveRemote> {
  return readPayload(payload, activeRemoteOf);
}

/** Read the hostnames. */
export function readHostnames(payload: unknown): ReadOutcome<Hostnames> {
  return readPayload(payload, hostnamesOf);
}

/** Read the folders history. */
export function readFoldersHistory(
  payload: unknown,
): ReadOutcome<FoldersHistory> {
  return readPayload(payload, foldersHistoryOf);
}

/** Read a delete request. */
export function readDeleteRequest(
  payload: unknown,
): ReadOutcome<DeleteRequest> {
  return readPayload(payload, deleteRequestOf);
}

/** Read a delete result. */
export function readDeleteResult(payload: unknown): ReadOutcome<DeleteResult> {
  return readPayload(payload, deleteResultOf);
}

/** Read an open request. */
export function readOpenRequest(payload: unknown): ReadOutcome<OpenRequest> {
  return readPayload(payload, openRequestOf);
}

/** Read an active-folders push. */
export function readActiveFoldersPush(
  payload: unknown,
): ReadOutcome<ActiveFoldersPush> {
  return readPayload(payload, activeFoldersPushOf);
}

/** The envelope as sent: the interface version, alone. */
export function writeEnvelope(): Versioned {
  return {interfaceVersion: INTERFACE_VERSION};
}

/** An active remote as sent: the body's fields, with the interface version first. */
export function writeActiveRemote(
  body: Omit<ActiveRemote, 'interfaceVersion'>,
): ActiveRemote {
  return {
    interfaceVersion: INTERFACE_VERSION,
    connected: body.connected,
    ...(body.hostKey !== undefined && {hostKey: body.hostKey}),
  };
}

/** The hostnames as sent. */
export function writeHostnames(
  body: Omit<Hostnames, 'interfaceVersion'>,
): Hostnames {
  return {interfaceVersion: INTERFACE_VERSION, hostnames: body.hostnames};
}

/** The folders history as sent. */
export function writeFoldersHistory(
  body: Omit<FoldersHistory, 'interfaceVersion'>,
): FoldersHistory {
  return {interfaceVersion: INTERFACE_VERSION, hosts: body.hosts};
}

/** A delete request as sent. */
export function writeDeleteRequest(
  body: Omit<DeleteRequest, 'interfaceVersion'>,
): DeleteRequest {
  return {
    interfaceVersion: INTERFACE_VERSION,
    hostKey: body.hostKey,
    path: body.path,
  };
}

/** A delete result as sent. */
export function writeDeleteResult(
  body: Omit<DeleteResult, 'interfaceVersion'>,
): DeleteResult {
  return {interfaceVersion: INTERFACE_VERSION, changed: body.changed};
}

/** An open request as sent: an absent path or kind stays absent. */
export function writeOpenRequest(
  body: Omit<OpenRequest, 'interfaceVersion'>,
): OpenRequest {
  return {
    interfaceVersion: INTERFACE_VERSION,
    hostKey: body.hostKey,
    ...(body.path !== undefined && {path: body.path}),
    ...(body.kind !== undefined && {kind: body.kind}),
    window: body.window,
  };
}

/** An active-folders push as sent: an absent host key or folders stays absent. */
export function writeActiveFoldersPush(
  body: Omit<ActiveFoldersPush, 'interfaceVersion'>,
): ActiveFoldersPush {
  return {
    interfaceVersion: INTERFACE_VERSION,
    outcome: body.outcome,
    ...(body.hostKey !== undefined && {hostKey: body.hostKey}),
    ...(body.folders !== undefined && {folders: body.folders}),
  };
}
