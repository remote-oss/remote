/**
 * @fileoverview What the CLI echoes of the user's environment. The CLI passes the configuration's `containerEnv` to
 * its own `docker run` as `-e NAME=value` and logs the command; C3 passes the lines on and so replaces the value of
 * each variable the configuration references with the `${…}` text that stands for it.
 */

/** The shortest value that is treated as a secret. */
const MINIMUM_LENGTH = 8;

/** One environment value and the `${…}` text that stands for it in the configuration. */
export interface Secret {
  value: string;
  reference: string;
}

/** A reference to an environment variable of the editor, with the name after the first colon. */
const REFERENCE = /\$\{(localEnv|env):([^:}]+)/g;

/**
 * The values of the editor's variables that the configuration text references and that are long enough to be secrets,
 * once per value, longest first.
 */
export function referencedSecrets(
  configText: string,
  editorEnvironment: Readonly<Record<string, string | undefined>>,
): readonly Secret[] {
  const byValue = new Map<string, Secret>();
  for (const [, kind, name] of configText.matchAll(REFERENCE)) {
    const value = editorEnvironment[String(name)];
    if (
      value !== undefined &&
      value.length >= MINIMUM_LENGTH &&
      !byValue.has(value)
    ) {
      byValue.set(value, {
        value,
        reference: `\${${String(kind)}:${String(name)}}`,
      });
    }
  }
  return [...byValue.values()].sort(
    (first, second) => second.value.length - first.value.length,
  );
}

/** The text with each secret's value replaced by the text that stands for it. */
export function scrubbed(text: string, secrets: readonly Secret[]): string {
  return secrets.reduce(
    (result, secret) => result.replaceAll(secret.value, secret.reference),
    text,
  );
}
