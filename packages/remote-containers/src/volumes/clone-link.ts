/**
 * @fileoverview What an "Open in Dev Containers" link asks of the extension: the path `cloneInVolume` with the
 * repository in its `url` query parameter. Anything else is not ours and is ignored; a link without a repository, or
 * one that can't be read, is refused with the text that names why.
 */

/** The only action a link may name, exactly as written. */
const CLONE_ACTION = '/cloneInVolume';

/** The query parameter that holds the repository, exactly as written. */
const SOURCE_PARAMETER = 'url';

/** An incoming link as the editor hands it over: its scheme, its path, its query as the editor decoded it, and its text. */
export interface IncomingLink {
  scheme: string;
  path: string;
  query: string;
  text: string;
}

/** What the link's text says of itself to a strict reading, which the editor gives. */
export interface LinkReading {
  /** The scheme the editor answers to, which every link it hands over carries. */
  editorScheme: string;
  /** Whether the text is a URI to the editor's strict parser. */
  isUri(text: string): boolean;
}

/** The texts a refusal shows. */
type LinkRefusal = 'S096' | 'S178' | 'S180' | 'S210';

/** What to do with a link: nothing, refuse it with a text, or clone the repository it names. */
export type LinkRequest =
  | {kind: 'ignored'}
  | {kind: 'refused'; text: LinkRefusal}
  | {kind: 'clone'; source: string};

/** The code points below the space, and DEL: characters no URL can hold, which the editor would have escaped. */
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

/** Whether `text` holds a character no URL can hold. */
function holdsControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < FIRST_PRINTABLE || code === DELETE) {
      return true;
    }
  }
  return false;
}

/** The value of the first `url` parameter of `query`; undefined when there is none. */
function sourceParameter(query: string): string | undefined {
  for (const pair of query.split('&')) {
    const separator = pair.indexOf('=');
    const key = separator < 0 ? pair : pair.slice(0, separator);
    if (key === SOURCE_PARAMETER) {
      return separator < 0 ? '' : pair.slice(separator + 1);
    }
  }
  return undefined;
}

/**
 * What `link` asks: a path other than `cloneInVolume` is ignored; a missing or empty `url` is S178; a link the editor's
 * strict parser rejects is S210, one whose scheme isn't the editor's is S180, and a `url` holding a control character
 * is S096; otherwise the first `url` value is the source.
 */
export function linkRequestOf(
  link: IncomingLink,
  reading: LinkReading,
): LinkRequest {
  if (link.path !== CLONE_ACTION) {
    return {kind: 'ignored'};
  }
  const source = sourceParameter(link.query);
  if (source === undefined || source === '') {
    return {kind: 'refused', text: 'S178'};
  }
  if (!reading.isUri(link.text)) {
    return {kind: 'refused', text: 'S210'};
  }
  if (link.scheme.toLowerCase() !== reading.editorScheme.toLowerCase()) {
    return {kind: 'refused', text: 'S180'};
  }
  return holdsControlCharacter(source)
    ? {kind: 'refused', text: 'S096'}
    : {kind: 'clone', source};
}
