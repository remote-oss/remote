/**
 * The characters an encoded part maps to their percent form without the native encoder, keyed by code point: the
 * reserved set the editor's own encoder carries in a table.
 */
const ENCODED: Record<number, string> = {
  32: '%20',
  33: '%21',
  35: '%23',
  36: '%24',
  38: '%26',
  39: '%27',
  40: '%28',
  41: '%29',
  42: '%2A',
  43: '%2B',
  44: '%2C',
  47: '%2F',
  58: '%3A',
  59: '%3B',
  61: '%3D',
  63: '%3F',
  64: '%40',
  91: '%5B',
  93: '%5D',
};

/** The percent-runs to decode while parsing. */
const ENCODED_AS_HEX = /(%[0-9A-Za-z][0-9A-Za-z])+/g;

/** The characters an authority part may keep as separators: the IPv6 brackets and the port colon. */
const AUTHORITY_SEPARATOR = new Set(['[', ']', ':']);

/** The four parts a value after its scheme splits into. */
interface Parts {
  authority: string;
  path: string;
  query: string;
  fragment: string;
}

/** Whether a code point is unreserved and therefore passes through unescaped. */
function isUnreserved(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 46 ||
    code === 95 ||
    code === 126
  );
}

/** Decode one run that does not decode as a whole, keeping the piece that failed as it was written. */
function decodeGraceful(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.length > 3
      ? `${text.slice(0, 3)}${decodeGraceful(text.slice(3))}`
      : text;
  }
}

/** Decode the percent-runs of a parsed part, keeping a run that does not decode and leaving the rest as typed. */
function percentDecode(value: string): string {
  return value.replace(ENCODED_AS_HEX, decodeGraceful);
}

/**
 * Encode one part the way the editor's own encoder does: unreserved characters pass through, a path keeps its
 * slashes, an authority keeps its IPv6 brackets and port colon; the reserved set takes its fixed percent form and
 * every other character is handed, in its run, to the native encoder.
 */
function encodePart(
  part: string,
  isPath: boolean,
  isAuthority: boolean,
): string {
  let output = '';
  let encoded = false;
  let nativeStart = -1;
  for (let index = 0; index < part.length; index += 1) {
    const code = part.charCodeAt(index);
    if (
      isUnreserved(code) ||
      (isPath && code === 47) ||
      (isAuthority && AUTHORITY_SEPARATOR.has(part.charAt(index)))
    ) {
      if (nativeStart !== -1) {
        output += encodeURIComponent(part.slice(nativeStart, index));
        nativeStart = -1;
      }
      if (encoded) {
        output += part.charAt(index);
      }
    } else {
      if (!encoded) {
        output = part.slice(0, index);
        encoded = true;
      }
      const escaped = ENCODED[code];
      if (escaped !== undefined) {
        if (nativeStart !== -1) {
          output += encodeURIComponent(part.slice(nativeStart, index));
          nativeStart = -1;
        }
        output += escaped;
      } else if (nativeStart === -1) {
        nativeStart = index;
      }
    }
  }
  if (nativeStart !== -1) {
    output += encodeURIComponent(part.slice(nativeStart));
  }
  return encoded ? output : part;
}

/**
 * Encode the path: a drive letter at its start is lower-cased the way the editor's own printer does, then the
 * path is encoded with its slashes kept.
 */
function encodePath(path: string): string {
  if (
    path.length >= 3 &&
    path.charCodeAt(0) === 0x2f &&
    path.charCodeAt(2) === 0x3a &&
    path.charCodeAt(1) >= 0x41 &&
    path.charCodeAt(1) <= 0x5a
  ) {
    path = `/${path.charAt(1).toLowerCase()}:${path.slice(3)}`;
  }
  return encodePart(path, true, false);
}

/**
 * Encode an authority: the optional userinfo is kept in its case ahead of the host, the host is lower-cased, and
 * a port after the host's last colon is kept as typed.
 */
function encodeAuthority(authority: string): string {
  let output = '';
  const atSign = authority.indexOf('@');
  if (atSign !== -1) {
    const userinfo = authority.slice(0, atSign);
    const colon = userinfo.lastIndexOf(':');
    if (colon === -1) {
      output += encodePart(userinfo, false, false);
    } else {
      const before = encodePart(userinfo.slice(0, colon), false, false);
      const after = encodePart(userinfo.slice(colon + 1), false, true);
      output += `${before}:${after}`;
    }
    output += '@';
  }
  const host = atSign === -1 ? authority : authority.slice(atSign + 1);
  const lowered = host.toLowerCase();
  const portColon = lowered.lastIndexOf(':');
  if (portColon === -1) {
    output += encodePart(lowered, false, true);
  } else {
    output +=
      encodePart(lowered.slice(0, portColon), false, true) +
      host.slice(portColon);
  }
  return output;
}

/** Split the text after a scheme into its four parts, in the order a value is written. */
function parseParts(afterScheme: string): Parts {
  const hash = afterScheme.indexOf('#');
  const fragment = percentDecode(
    hash === -1 ? '' : afterScheme.slice(hash + 1),
  );
  const beforeFragment = hash === -1 ? afterScheme : afterScheme.slice(0, hash);
  const question = beforeFragment.indexOf('?');
  const query = percentDecode(
    question === -1 ? '' : beforeFragment.slice(question + 1),
  );
  const beforeQuery =
    question === -1 ? beforeFragment : beforeFragment.slice(0, question);
  if (beforeQuery.startsWith('//')) {
    const slash = beforeQuery.indexOf('/', 2);
    return {
      authority: percentDecode(
        slash === -1 ? beforeQuery.slice(2) : beforeQuery.slice(2, slash),
      ),
      path: percentDecode(slash === -1 ? '' : beforeQuery.slice(slash)),
      query,
      fragment,
    };
  }
  return {authority: '', path: percentDecode(beforeQuery), query, fragment};
}

/** Assemble the scheme and its four parts into the serialized form of a value. */
function serialize(scheme: string, parts: Parts): string {
  let output = `${scheme}:`;
  if (parts.authority !== '') {
    output += `//${encodeAuthority(parts.authority)}`;
  }
  let path = parts.path;
  if (path === '') {
    path = '/';
  } else if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  output += encodePath(path);
  if (parts.query !== '') {
    output += `?${encodePart(parts.query, false, false)}`;
  }
  if (parts.fragment !== '') {
    output += `#${encodePart(parts.fragment, false, false)}`;
  }
  return output;
}

/**
 * The value a setting holds once it is re-serialised for the host: for the `http` and `https` schemes the value
 * is parsed and written back in the canonical form the editor's own uri printer gives; for every other scheme,
 * including an empty value, it is returned exactly as typed.
 */
export function proxyVariableText(configuredValue: string): string {
  const colon = configuredValue.indexOf(':');
  const scheme =
    colon === -1 ? configuredValue : configuredValue.slice(0, colon);
  if (scheme !== 'http' && scheme !== 'https') {
    return configuredValue;
  }
  return serialize(scheme, parseParts(configuredValue.slice(colon + 1)));
}
